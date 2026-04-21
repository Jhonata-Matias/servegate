#!/usr/bin/env python3
"""Latency benchmark for the RunPod Serverless FLUX endpoint.

Runs N warm invocations sequentially with varied seeds (no caching),
plus optional cold-spawn measurements (forces idle wait between requests).

Usage:
    python3 latency_bench.py                  # 100 warm
    python3 latency_bench.py --warm 100 --cold 5
    python3 latency_bench.py --cold-only

Reads RUNPOD_API_KEY and RUNPOD_SERVERLESS_ENDPOINT_ID from project .env.
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
import urllib.request
from pathlib import Path
from typing import Iterable

PROJECT_ROOT = Path(__file__).resolve().parents[2]
ENV_PATH = PROJECT_ROOT / ".env"


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, _, v = line.partition("=")
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def percentile(values: list[float], p: float) -> float:
    if not values:
        return float("nan")
    return statistics.quantiles(values, n=100, method="inclusive")[int(p) - 1] if len(values) >= 2 else values[0]


def submit_async(endpoint_id: str, api_key: str, seed: int, prompt: str) -> str:
    payload = json.dumps({"input": {"prompt": prompt, "seed": seed}}).encode()
    req = urllib.request.Request(
        f"https://api.runpod.ai/v2/{endpoint_id}/run",
        data=payload,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode())
                if "id" in data:
                    return data["id"]
                raise RuntimeError(f"no id in submit response: {data}")
        except (urllib.error.HTTPError, urllib.error.URLError) as e:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)
    raise RuntimeError("unreachable")


def poll_status(endpoint_id: str, api_key: str, job_id: str, max_wait_s: int = 300) -> dict:
    deadline = time.time() + max_wait_s
    while time.time() < deadline:
        try:
            req = urllib.request.Request(
                f"https://api.runpod.ai/v2/{endpoint_id}/status/{job_id}",
                headers={"Authorization": f"Bearer {api_key}"},
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode())
            status = data.get("status")
            if status in ("COMPLETED", "FAILED", "CANCELLED"):
                return data
        except (urllib.error.HTTPError, urllib.error.URLError):
            pass  # transient; keep polling
        time.sleep(1.5)
    return {"status": "POLL_TIMEOUT", "id": job_id}


def run_invocation(endpoint_id: str, api_key: str, seed: int, prompt: str, timeout: int = 300) -> dict:
    t0 = time.time()
    try:
        job_id = submit_async(endpoint_id, api_key, seed, prompt)
        data = poll_status(endpoint_id, api_key, job_id, max_wait_s=timeout)
    except Exception as e:
        return {"ok": False, "wall_s": time.time() - t0, "error": f"{type(e).__name__}: {e}"}
    elapsed = time.time() - t0
    out = data.get("output") or {}
    if data.get("status") == "COMPLETED" and isinstance(out, dict) and "image_b64" in out:
        return {
            "ok": True,
            "wall_s": elapsed,
            "server_ms": out.get("metadata", {}).get("elapsed_ms"),
            "status": data.get("status"),
            "delay_time": data.get("delayTime"),
            "execution_time": data.get("executionTime"),
        }
    return {"ok": False, "wall_s": elapsed, "error": data.get("error") or data}


def bench(label: str, count: int, endpoint_id: str, api_key: str, sleep_between: float = 0.0) -> list[dict]:
    print(f"\n=== {label} (n={count}, sleep={sleep_between}s) ===")
    results = []
    for i in range(count):
        seed = 1000 + i  # varied seeds
        r = run_invocation(endpoint_id, api_key, seed, prompt=f"benchmark scene {i}: cyberpunk city #{i}")
        results.append(r)
        marker = "✓" if r["ok"] else "✗"
        srv = f"server={r['server_ms']}ms" if r.get("server_ms") else ""
        et = f"exec={r['execution_time']}" if r.get("execution_time") else ""
        print(f"  [{i+1:3d}/{count}] {marker} wall={r['wall_s']*1000:.0f}ms {srv} {et} {'' if r['ok'] else r.get('error')}")
        if sleep_between > 0 and i < count - 1:
            time.sleep(sleep_between)
    return results


def report(label: str, results: Iterable[dict]) -> None:
    okay = [r["wall_s"] * 1000 for r in results if r["ok"]]
    fails = [r for r in results if not r["ok"]]
    print(f"\n--- {label} report ---")
    print(f"  Successful: {len(okay)}/{len(okay)+len(fails)}")
    if okay:
        okay_sorted = sorted(okay)
        print(f"  Wall latency (ms):")
        print(f"    p50  = {okay_sorted[len(okay_sorted)//2]:.0f}")
        print(f"    p95  = {okay_sorted[max(0,int(len(okay_sorted)*0.95)-1)]:.0f}")
        print(f"    p99  = {okay_sorted[max(0,int(len(okay_sorted)*0.99)-1)]:.0f}")
        print(f"    min  = {okay_sorted[0]:.0f}")
        print(f"    max  = {okay_sorted[-1]:.0f}")
        print(f"    mean = {statistics.mean(okay_sorted):.0f}")
    if fails:
        print(f"  Failures ({len(fails)}):")
        for f in fails[:5]:
            print(f"    {f.get('error')}")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--warm", type=int, default=100, help="warm invocations count")
    p.add_argument("--cold", type=int, default=0, help="cold-spawn invocations count (forces idle wait between)")
    p.add_argument("--cold-only", action="store_true", help="skip warm, run only cold")
    p.add_argument("--cold-wait", type=int, default=60, help="seconds to wait between cold invocations")
    args = p.parse_args()

    env = load_env()
    endpoint_id = env.get("RUNPOD_SERVERLESS_ENDPOINT_ID") or os.environ.get("RUNPOD_SERVERLESS_ENDPOINT_ID")
    api_key = env.get("RUNPOD_API_KEY") or os.environ.get("RUNPOD_API_KEY")
    if not endpoint_id or not api_key:
        print("❌ RUNPOD_SERVERLESS_ENDPOINT_ID and RUNPOD_API_KEY required (in .env or env)", file=sys.stderr)
        return 1

    print(f"Endpoint: {endpoint_id}")

    out: dict[str, list[dict]] = {}
    if not args.cold_only and args.warm > 0:
        out["warm"] = bench("WARM", args.warm, endpoint_id, api_key, sleep_between=0.0)
        report("WARM", out["warm"])
    if args.cold > 0:
        out["cold"] = bench(
            "COLD", args.cold, endpoint_id, api_key, sleep_between=args.cold_wait
        )
        report("COLD", out["cold"])

    # Persist raw results
    out_path = Path(__file__).parent / f"bench-results-{int(time.time())}.json"
    out_path.write_text(json.dumps(out, indent=2))
    print(f"\nRaw results: {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
