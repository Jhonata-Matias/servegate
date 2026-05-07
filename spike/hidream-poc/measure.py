#!/usr/bin/env python3
"""Story 6.1 measurement runner — RunPod serverless API (isolated HiDream PoC endpoint).

Environment:
  RUNPOD_API_KEY                     — required
  RUNPOD_HIDREAM_POC_ENDPOINT_ID     — PoC endpoint id (NEVER production FLUX id)
  L40S_RATE_USD_PER_SEC             — required for cost + circuit breaker (from RunPod dashboard @ run date)
  BUDGET_CAP_USD                    — default 50
  IDLE_GAP_S                        — sleep between cold samples; default 35 (> 30s idle_timeout)
  NOTES_DIR                         — default ../../.aiox/notes/story-6.1 (relative to cwd)
  HIDREAM_GUIDANCE_SCALE             — forwarded in job input (defaults in handler env at deploy time)

Usage:
  python measure.py smoke
  python measure.py cold
  python measure.py warm
  python measure.py all
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import ssl
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


RUNPOD_V2 = "https://api.runpod.ai/v2"

DEFAULT_GUIDANCE = float(os.environ.get("HIDREAM_GUIDANCE_SCALE", "0.0"))
DEFAULT_STEPS = int(os.environ.get("HIDREAM_STEPS", "28"))
INFER_WIDTH = int(os.environ.get("HIDREAM_WIDTH", "1024"))
INFER_HEIGHT = int(os.environ.get("HIDREAM_HEIGHT", "1024"))


class BudgetExceeded(RuntimeError):
    pass


def _utc_slug() -> str:
    return time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())


def percentile_nearest(xs: List[float], pct: float) -> float:
    if not xs:
        return 0.0
    s = sorted(xs)
    pos = pct * (len(s) - 1) / 100.0
    lo = int(pos)
    hi = min(lo + 1, len(s) - 1)
    frac = pos - lo
    return s[lo] * (1 - frac) + s[hi] * frac


def load_prompts(path: Path) -> List[Dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    prompts = data.get("prompts", data)
    if not isinstance(prompts, list) or len(prompts) != 50:
        raise ValueError("prompts.json must contain exactly 50 entries in 'prompts' array")
    return prompts


def notes_dir_default() -> Path:
    env = os.environ.get("NOTES_DIR")
    if env:
        return Path(env).resolve()
    return (Path(__file__).resolve().parent.parent.parent / ".aiox" / "notes" / "story-6.1").resolve()


def ensure_notes(d: Path) -> None:
    (d / "outputs").mkdir(parents=True, exist_ok=True)


@dataclass
class CostLedger:
    L40S_rate_usd_per_sec: float
    budget_cap_usd: float
    cumulative_billable_s: float = 0.0
    total_poc_spend_usd: float = 0.0
    cap_hit: bool = False
    events: Any = None

    def __post_init__(self) -> None:
        if self.events is None:
            self.events = []

    def add_job_seconds(self, billable_s: float, *, job_kind: str) -> None:
        cost = billable_s * self.L40S_rate_usd_per_sec
        self.cumulative_billable_s += billable_s
        self.total_poc_spend_usd += cost
        self.events.append(
            {"t": _utc_slug(), "kind": job_kind, "billable_s": billable_s, "cost_usd": cost}
        )
        if self.total_poc_spend_usd >= self.budget_cap_usd:
            self.cap_hit = True
            raise BudgetExceeded(
                f"Circuit breaker: spend {self.total_poc_spend_usd:.4f} >= cap {self.budget_cap_usd}"
            )

    def projected_warm_remainder_check(self, warm_latencies: List[float]) -> None:
        """Abort if projecting total spend exceeds cap before finishing 50 warm images."""
        if not warm_latencies:
            return
        mean_w = sum(warm_latencies) / len(warm_latencies)
        done = len(warm_latencies)
        remaining = max(50 - done, 0)
        projected = self.total_poc_spend_usd + remaining * mean_w * self.L40S_rate_usd_per_sec
        if projected > self.budget_cap_usd:
            self.cap_hit = True
            raise BudgetExceeded(
                f"Projected spend {projected:.4f} > cap {self.budget_cap_usd} "
                f"(after {done} warm samples)"
            )


def poll_status(api_key: str, endpoint_id: str, job_id: str, timeout_s: float = 400.0) -> Dict[str, Any]:
    url = f"{RUNPOD_V2}/{endpoint_id}/status/{job_id}"
    headers = {"Authorization": f"Bearer {api_key}"}
    deadline = time.monotonic() + timeout_s

    ctx = ssl.create_default_context()

    last: Dict[str, Any] = {}
    while time.monotonic() < deadline:
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=60, context=ctx) as resp:
                last = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"status HTTP {e.code}: {body}") from e

        st = last.get("status")
        if st in ("COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"):
            return last
        time.sleep(0.35)
    raise TimeoutError(f"job {job_id} not terminal within {timeout_s}s; last={last}")


def submit_job(api_key: str, endpoint_id: str, job_input: Dict[str, Any]) -> str:
    url = f"{RUNPOD_V2}/{endpoint_id}/run"
    body = json.dumps({"input": job_input}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=120, context=ctx) as resp:
            parsed = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"run HTTP {e.code}: {e.read().decode()}") from e

    jid = parsed.get("id")
    if not jid:
        raise RuntimeError(f"unexpected /run body: {parsed}")
    return str(jid)


def billable_seconds_from_status(status_body: Dict[str, Any]) -> float:
    delay = float(status_body.get("delayTime") or 0) / 1000.0
    exe = float(status_body.get("executionTime") or 0) / 1000.0
    return max(delay + exe, 0.0)


def wall_request_to_png_s(t_submit: float, t_first_byte: float) -> float:
    return max(t_first_byte - t_submit, 0.0)


def run_once(
    api_key: str,
    endpoint_id: str,
    job_input: Dict[str, Any],
    ledger: Optional[CostLedger],
    measure_ttfb: bool,
) -> Tuple[Dict[str, Any], Optional[bytes]]:
    t0 = time.perf_counter()
    jid = submit_job(api_key, endpoint_id, job_input)
    t_after_submit = time.perf_counter()

    st = poll_status(api_key, endpoint_id, jid)
    t_done = time.perf_counter()

    if st.get("status") != "COMPLETED":
        raise RuntimeError(f"job failed: {st}")

    out = st.get("output") or {}
    b64 = out.get("image_b64")
    if not b64:
        raise RuntimeError(f"no image_b64 in output: {out}")
    raw = base64.b64decode(b64)

    billable = billable_seconds_from_status(st)
    if ledger is not None:
        ledger.add_job_seconds(billable, job_kind="inference")

    sample: Dict[str, Any] = {
        "runpod_job_id": jid,
        "status_delay_ms": st.get("delayTime"),
        "status_execution_ms": st.get("executionTime"),
        "billable_s": billable,
        "wall_invoke_s": t_done - t0,
        "wall_after_submit_s": t_done - t_after_submit,
        "metadata": out.get("metadata"),
    }
    if measure_ttfb:
        sample["cold_warm_wall_to_png_s"] = wall_request_to_png_s(t0, t_done)

    return sample, raw


def write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2) + "\n", encoding="utf-8")


def cmd_smoke(
    api_key: str,
    endpoint_id: str,
    prompts: List[Dict[str, Any]],
    ledger: Optional[CostLedger],
) -> None:
    p0 = prompts[0]["text"]
    job_input = {
        "prompt": p0,
        "steps": DEFAULT_STEPS,
        "seed": 424242,
        "width": INFER_WIDTH,
        "height": INFER_HEIGHT,
        "guidance_scale": DEFAULT_GUIDANCE,
    }
    sample, raw = run_once(api_key, endpoint_id, job_input, ledger, measure_ttfb=True)
    print(json.dumps({"ok": True, "sample": sample, "png_bytes": len(raw or b"")}, indent=2))


def cmd_cold(
    api_key: str,
    endpoint_id: str,
    prompts: List[Dict[str, Any]],
    idle_gap_s: float,
    notes: Path,
    ledger: CostLedger,
) -> Tuple[Path, Dict[str, Any]]:
    samples: List[Dict[str, Any]] = []
    for i in range(10):
        if i > 0:
            time.sleep(idle_gap_s)
        txt = prompts[i % len(prompts)]["text"]
        pid = prompts[i % len(prompts)].get("id", f"p{i+1:02d}")
        job_input = {
            "prompt": txt,
            "steps": DEFAULT_STEPS,
            "seed": 200_000 + i * 9973,
            "width": INFER_WIDTH,
            "height": INFER_HEIGHT,
            "guidance_scale": DEFAULT_GUIDANCE,
        }
        ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        t0 = time.perf_counter()
        job_id = submit_job(api_key, endpoint_id, job_input)
        st = poll_status(api_key, endpoint_id, job_id)
        t1 = time.perf_counter()
        if st.get("status") != "COMPLETED":
            raise RuntimeError(f"cold #{i+1} failed: {st}")
        billable = billable_seconds_from_status(st)
        ledger.add_job_seconds(billable, job_kind=f"cold_{i+1}")
        wall = t1 - t0
        samples.append(
            {
                "idx": i + 1,
                "prompt_id": pid,
                "invocation_ts_utc": ts,
                "cold_vs_warm": "cold",
                "wall_request_to_done_s": wall,
                "delay_time_ms": st.get("delayTime"),
                "execution_time_ms": st.get("executionTime"),
                "billable_s": billable,
                "runpod_job_id": job_id,
            }
        )
        print(f"cold {i+1}/10 wall_s={wall:.2f} billable_s={billable:.2f}")

    walls = [float(s["wall_request_to_done_s"]) for s in samples]
    out = {
        "cold_start_p50_s": percentile_nearest(walls, 50),
        "cold_start_p95_s": percentile_nearest(walls, 95),
        "samples": samples,
    }
    path = notes / f"cold-start-{_utc_slug()}.json"
    write_json(path, out)
    print(f"wrote {path}")
    return path, out


def cmd_warm(
    api_key: str,
    endpoint_id: str,
    prompts: List[Dict[str, Any]],
    notes: Path,
    ledger: CostLedger,
) -> Tuple[Path, Path, Dict[str, Any]]:
    samples: List[Dict[str, Any]] = []
    manifest: Dict[str, Any] = {}

    for i, entry in enumerate(prompts):
        pid = str(entry.get("id", f"p{i+1:02d}"))
        txt = str(entry["text"])
        seed = 300_000 + i * 9973
        job_input = {
            "prompt": txt,
            "steps": DEFAULT_STEPS,
            "seed": seed,
            "width": INFER_WIDTH,
            "height": INFER_HEIGHT,
            "guidance_scale": DEFAULT_GUIDANCE,
        }
        samp, png = run_once(api_key, endpoint_id, job_input, ledger, measure_ttfb=False)
        if not png:
            raise RuntimeError(f"warm missing png for {pid}")
        fn = f"{pid}-{seed}.png"
        out_path = notes / "outputs" / fn
        out_path.write_bytes(png)
        digest = hashlib.sha256(png).hexdigest()
        meta = samp.get("metadata") or {}
        if meta.get("inference_s") is not None:
            wall_infer = float(meta["inference_s"])
        elif samp.get("status_execution_ms") is not None:
            wall_infer = float(samp["status_execution_ms"]) / 1000.0
        else:
            wall_infer = 0.0

        delay_ms = samp.get("status_delay_ms")
        queue_wait_s = float(delay_ms) / 1000.0 if delay_ms is not None else None

        row = {
            "prompt_id": pid,
            "prompt_text": txt,
            "seed": seed,
            "output_filename": fn,
            "sha256": digest,
            "file_bytes": len(png),
            "inference_wall_s": wall_infer,
            "queue_wait_s": queue_wait_s,
            "runpod_job_id": samp.get("runpod_job_id"),
        }
        manifest[pid] = row
        samples.append(row)
        print(f"warm {i+1}/50 pid={pid} bytes={len(png)}")

        latencies = [float(r["inference_wall_s"]) for r in samples]
        ledger.projected_warm_remainder_check(latencies)

    latency_series = [float(r["inference_wall_s"]) for r in samples]
    warm_body = {
        "warm_latency_p50_s": percentile_nearest(latency_series, 50),
        "warm_latency_p95_s": percentile_nearest(latency_series, 95),
        "samples": samples,
    }
    wpath = notes / f"warm-latency-{_utc_slug()}.json"
    write_json(wpath, warm_body)
    mpath = notes / "outputs" / "manifest.json"
    write_json(mpath, manifest)
    print(f"wrote {wpath}")
    print(f"wrote {mpath}")
    return wpath, mpath, warm_body


def save_cost_ledger(notes: Path, ledger: CostLedger, extras: Dict[str, Any]) -> Path:
    path = notes / "cost-ledger.json"
    body = {
        "L40S_rate_usd_per_sec": ledger.L40S_rate_usd_per_sec,
        "budget_cap_usd": ledger.budget_cap_usd,
        "total_poc_spend_usd": ledger.total_poc_spend_usd,
        "cumulative_billable_s": ledger.cumulative_billable_s,
        "cap_hit": ledger.cap_hit,
        "events": ledger.events,
        **extras,
    }
    write_json(path, body)
    return path


def main() -> None:
    parser = argparse.ArgumentParser(description="Story 6.1 HiDream PoC measurements")
    parser.add_argument("command", choices=["smoke", "cold", "warm", "all"])
    args = parser.parse_args()

    api_key = os.environ.get("RUNPOD_API_KEY")
    endpoint = os.environ.get("RUNPOD_HIDREAM_POC_ENDPOINT_ID")
    rate_s = os.environ.get("L40S_RATE_USD_PER_SEC")
    if not api_key or not endpoint:
        raise SystemExit("RUNPOD_API_KEY and RUNPOD_HIDREAM_POC_ENDPOINT_ID are required")

    cap = float(os.environ.get("BUDGET_CAP_USD", "50"))
    idle_gap = float(os.environ.get("IDLE_GAP_S", "35"))
    prompts_path = Path(__file__).resolve().parent / "prompts.json"
    prompts = load_prompts(prompts_path)
    notes = notes_dir_default()
    ensure_notes(notes)

    ledger_extras: Dict[str, Any] = {
        "rate_source": "manual dashboards read — set L40S_RATE_USD_PER_SEC at run time",
        "timestamp_utc": _utc_slug(),
    }

    rate_f: Optional[float] = float(rate_s) if rate_s else None

    if args.command == "smoke":
        cmd_smoke(api_key, endpoint, prompts, CostLedger(rate_f or 0.0, cap) if rate_f else None)
        return

    if rate_f is None:
        raise SystemExit("L40S_RATE_USD_PER_SEC required for cold/warm/all (dashboard rate at PoC date)")

    ledger = CostLedger(rate_f, cap)

    cold_summary: Optional[Dict[str, Any]] = None
    warm_summary: Optional[Dict[str, Any]] = None
    cold_path_saved: Optional[Path] = None
    warm_path_saved: Optional[Path] = None

    try:
        if args.command == "cold":
            cold_path_saved, cold_summary = cmd_cold(api_key, endpoint, prompts, idle_gap, notes, ledger)
        elif args.command == "warm":
            warm_path_saved, _, warm_summary = cmd_warm(api_key, endpoint, prompts, notes, ledger)
        elif args.command == "all":
            cold_path_saved, cold_summary = cmd_cold(api_key, endpoint, prompts, idle_gap, notes, ledger)
            warm_path_saved, _, warm_summary = cmd_warm(api_key, endpoint, prompts, notes, ledger)
    except BudgetExceeded as e:
        ledger_extras["abort_reason"] = str(e)
        print(f"BUDGET: {e}")
    finally:
        mean_cold = (
            sum(s["wall_request_to_done_s"] for s in cold_summary["samples"]) / len(cold_summary["samples"])
            if cold_summary
            else None
        )
        mean_warm_lat = (
            sum(float(s["inference_wall_s"]) for s in warm_summary["samples"]) / len(warm_summary["samples"])
            if warm_summary
            else None
        )
        rate = ledger.L40S_rate_usd_per_sec
        warm_per_image = mean_warm_lat * rate if mean_warm_lat is not None else None
        cold_amortized = None
        if mean_cold is not None and mean_warm_lat is not None:
            cold_amortized = ((mean_cold + 49 * mean_warm_lat) / 50.0) * rate
        ledger_extras.update(
            {
                "warm_per_image_usd": warm_per_image,
                "cold_amortized_per_image_usd": cold_amortized,
                "mean_cold_wall_s": mean_cold,
                "mean_warm_inference_s": mean_warm_lat,
            }
        )
        save_cost_ledger(notes, ledger, ledger_extras)
        print(f"cost ledger: {notes / 'cost-ledger.json'}")

        if args.command == "all" and cold_summary and warm_summary and not ledger.cap_hit:
            measurements = {
                "endpoint_id": endpoint,
                "gpu_class": os.environ.get("POC_GPU_CLASS", "L40S_48GB"),
                "weights": "HiDream-ai/HiDream-I1-Dev (FP16 spike — see handler HIDREAM_TORCH_DTYPE)",
                "inference_config": {
                    "steps": DEFAULT_STEPS,
                    "resolution": f"{INFER_WIDTH}x{INFER_HEIGHT}",
                    "guidance_scale": DEFAULT_GUIDANCE,
                },
                "cold_start": {
                    "p50_s": cold_summary["cold_start_p50_s"],
                    "p95_s": cold_summary["cold_start_p95_s"],
                    "samples_file": str(cold_path_saved) if cold_path_saved else None,
                },
                "warm_latency": {
                    "p50_s": warm_summary["warm_latency_p50_s"],
                    "p95_s": warm_summary["warm_latency_p95_s"],
                    "samples_file": str(warm_path_saved) if warm_path_saved else None,
                },
                "cost": {
                    "L40S_rate_usd_per_sec": rate,
                    "warm_per_image_usd": warm_per_image,
                    "cold_amortized_per_image_usd": cold_amortized,
                    "total_poc_spend_usd": ledger.total_poc_spend_usd,
                    "budget_cap_usd": cap,
                    "cap_hit": ledger.cap_hit,
                },
                "composite_written_utc": _utc_slug(),
            }
            write_json(notes / f"measurements-{_utc_slug()}.json", measurements)


if __name__ == "__main__":
    main()
