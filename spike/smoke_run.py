"""Smoke runner for ADR-0005 empirical validation of Wan2.2-TI2V-5B on RunPod.

Submits a deterministic sequence of prompts to a RunPod Serverless endpoint
running spike/handler.py, captures cold/warm metrics from both the RunPod
platform (delayTime, executionTime) and the handler (model_load_ms,
inference_ms, VRAM peak), and produces aggregate stats for per-GPU
comparison (e.g. L40S 48GB vs L4 24GB).

Stdlib-only (urllib + json) — no pip install needed on the client side.

Usage:
    export RUNPOD_API_KEY=<key>
    python3 spike/smoke_run.py \
        --endpoint-id <runpod-endpoint-id> \
        --gpu-label L40S-48GB \
        --prompts spike/benchmark_prompts.json

Outputs (under spike/runs/<timestamp>-<gpu-label>/):
    summary.md          human-readable metrics table + cost projection
    summary.json        machine-readable raw metrics
    prompts/<label>/
        video.mp4       generated clip (or skipped marker on i2v if image missing)
        metadata.json   handler metadata + RunPod platform metrics
        error.txt       present if the prompt failed; contains error message
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib import error as urlerror
from urllib import request as urlrequest

RUNPOD_BASE = "https://api.runpod.ai/v2"
DEFAULT_POLL_INTERVAL_S = 2.0
DEFAULT_TIMEOUT_S = 600.0
SUBMIT_RETRIES = 2


def utc_now_ms() -> int:
    return int(time.time() * 1000)


def utc_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def read_image_b64(path: Path) -> str:
    with path.open("rb") as fh:
        return base64.b64encode(fh.read()).decode("ascii")


def http_post(url: str, body: dict[str, Any], headers: dict[str, str], timeout: float = 30.0) -> dict[str, Any]:
    payload = json.dumps(body).encode("utf-8")
    req = urlrequest.Request(url, data=payload, headers=headers, method="POST")
    with urlrequest.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def http_get(url: str, headers: dict[str, str], timeout: float = 30.0) -> dict[str, Any]:
    req = urlrequest.Request(url, headers=headers, method="GET")
    with urlrequest.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def submit_with_retry(endpoint_id: str, payload: dict[str, Any], headers: dict[str, str]) -> str:
    url = f"{RUNPOD_BASE}/{endpoint_id}/run"
    last_err: Exception | None = None
    for attempt in range(SUBMIT_RETRIES + 1):
        try:
            response = http_post(url, {"input": payload}, headers)
            job_id = response.get("id")
            if not job_id:
                raise RuntimeError(f"submit response missing id: {response}")
            return str(job_id)
        except (urlerror.URLError, urlerror.HTTPError, RuntimeError) as exc:
            last_err = exc
            if attempt < SUBMIT_RETRIES:
                time.sleep(2.0 * (attempt + 1))
    assert last_err is not None
    raise last_err


def poll_until_done(
    endpoint_id: str,
    job_id: str,
    headers: dict[str, str],
    poll_interval_s: float,
    timeout_s: float,
) -> dict[str, Any]:
    url = f"{RUNPOD_BASE}/{endpoint_id}/status/{job_id}"
    deadline = time.time() + timeout_s
    last_status: str | None = None
    while time.time() < deadline:
        try:
            payload = http_get(url, headers)
        except (urlerror.URLError, urlerror.HTTPError) as exc:
            print(f"  poll http error (will retry): {exc}", flush=True)
            time.sleep(poll_interval_s)
            continue

        status = str(payload.get("status", "UNKNOWN"))
        if status != last_status:
            print(f"  status: {status}", flush=True)
            last_status = status

        if status == "COMPLETED":
            return payload
        if status in {"FAILED", "CANCELLED", "TIMED_OUT"}:
            return payload
        time.sleep(poll_interval_s)

    raise TimeoutError(f"job {job_id} did not complete in {timeout_s}s (last status: {last_status})")


def median_p95(values: list[float]) -> tuple[float | None, float | None]:
    if not values:
        return None, None
    sorted_vals = sorted(values)
    median = statistics.median(sorted_vals)
    if len(sorted_vals) == 1:
        return median, sorted_vals[0]
    p95_idx = max(0, int(round(0.95 * (len(sorted_vals) - 1))))
    return median, sorted_vals[p95_idx]


def fmt_ms(value: int | float | None) -> str:
    if value is None:
        return "—"
    if value < 1000:
        return f"{value:.0f} ms"
    return f"{value / 1000:.1f} s"


def fmt_usd(value: float | None) -> str:
    if value is None:
        return "—"
    return f"${value:.6f}"


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def write_json(path: Path, content: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(content, indent=2, sort_keys=True), encoding="utf-8")


def write_bytes(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)


def build_payload(entry: dict[str, Any], spike_root: Path) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "prompt": entry["prompt"],
        "benchmark_label": entry["label"],
        "return_video_b64": True,
    }
    for key in ("negative_prompt", "seed", "num_frames", "width", "height", "num_inference_steps", "guidance_scale", "fps"):
        if key in entry:
            payload[key] = entry[key]
    if entry.get("mode") == "i2v":
        image_rel = entry.get("input_image")
        if not image_rel:
            raise FileNotFoundError(f"{entry['label']}: i2v entry missing input_image path")
        image_path = (spike_root / image_rel).resolve()
        if not image_path.exists():
            raise FileNotFoundError(f"{entry['label']}: input_image not found at {image_path}")
        payload["input_image_b64"] = read_image_b64(image_path)
    return payload


def run_one(
    entry: dict[str, Any],
    payload: dict[str, Any],
    endpoint_id: str,
    headers: dict[str, str],
    poll_interval_s: float,
    timeout_s: float,
    out_dir: Path,
) -> dict[str, Any]:
    label = entry["label"]
    prompt_dir = out_dir / "prompts" / label

    submitted_at = utc_now_ms()
    job_id = submit_with_retry(endpoint_id, payload, headers)
    print(f"  submitted job_id={job_id}", flush=True)

    final = poll_until_done(endpoint_id, job_id, headers, poll_interval_s, timeout_s)
    finished_at = utc_now_ms()

    record: dict[str, Any] = {
        "label": label,
        "mode": entry.get("mode", "t2v"),
        "job_id": job_id,
        "runpod_status": final.get("status"),
        "runpod_delay_time_ms": final.get("delayTime"),
        "runpod_execution_time_ms": final.get("executionTime"),
        "client_wallclock_ms": finished_at - submitted_at,
        "submitted_at_utc": datetime.fromtimestamp(submitted_at / 1000, tz=timezone.utc).isoformat(),
        "finished_at_utc": datetime.fromtimestamp(finished_at / 1000, tz=timezone.utc).isoformat(),
    }

    output = final.get("output")
    if final.get("status") != "COMPLETED" or not isinstance(output, dict):
        record["error"] = "non_completed_status"
        record["raw"] = final
        write_text(prompt_dir / "error.txt", json.dumps(final, indent=2))
        write_json(prompt_dir / "metadata.json", record)
        return record

    if isinstance(output.get("error"), str):
        record["error"] = output.get("error")
        record["error_message"] = output.get("message")
        record["handler_code"] = output.get("code")
        write_text(prompt_dir / "error.txt", json.dumps(output, indent=2))
        write_json(prompt_dir / "metadata.json", record)
        return record

    metadata = output.get("metadata", {})
    record["handler_metadata"] = metadata
    record["handler_code"] = output.get("code")

    video_b64 = output.get("video_b64")
    if isinstance(video_b64, str) and video_b64:
        try:
            video_bytes = base64.b64decode(video_b64, validate=True)
            write_bytes(prompt_dir / "video.mp4", video_bytes)
            record["video_bytes_saved"] = len(video_bytes)
        except Exception as exc:
            record["video_decode_error"] = str(exc)
    else:
        record["video_bytes_saved"] = 0

    write_json(prompt_dir / "metadata.json", record)
    return record


def render_summary_md(records: list[dict[str, Any]], context: dict[str, Any]) -> str:
    lines: list[str] = []
    lines.append(f"# ADR-0005 Smoke Run — {context['gpu_label']}")
    lines.append("")
    lines.append(f"- Run ID: `{context['run_id']}`")
    lines.append(f"- Started: {context['started_utc']}")
    lines.append(f"- Endpoint: `{context['endpoint_id']}`")
    lines.append(f"- Prompts file: `{context['prompts_file']}`")
    lines.append(f"- GPU label: **{context['gpu_label']}**")
    if context.get("gpu_price_per_hour_usd"):
        lines.append(f"- GPU price (USD/hour): ${context['gpu_price_per_hour_usd']}")
    lines.append("")

    lines.append("## Per-prompt results")
    lines.append("")
    lines.append("| Label | Mode | Status | RunPod delay | RunPod exec | Handler total | Model load | Inference | Peak VRAM | First in process |")
    lines.append("|---|---|---|---|---|---|---|---|---|---|")
    for r in records:
        meta = r.get("handler_metadata") or {}
        first = meta.get("first_job_in_process")
        first_str = "**cold**" if first is True else ("warm" if first is False else "—")
        status = r.get("runpod_status") or "—"
        if r.get("error"):
            status = f"FAIL ({r.get('error')})"
        peak_vram = meta.get("max_memory_allocated_gb")
        lines.append(
            "| `{label}` | {mode} | {status} | {delay} | {exec_} | {total} | {load} | {infer} | {vram} | {first} |".format(
                label=r["label"],
                mode=r.get("mode", "t2v"),
                status=status,
                delay=fmt_ms(r.get("runpod_delay_time_ms")),
                exec_=fmt_ms(r.get("runpod_execution_time_ms")),
                total=fmt_ms(meta.get("handler_total_ms")),
                load=fmt_ms(meta.get("model_load_ms")) if meta.get("model_was_loaded") else "—",
                infer=fmt_ms(meta.get("inference_ms")),
                vram=f"{peak_vram} GB" if peak_vram is not None else "—",
                first=first_str,
            )
        )
    lines.append("")

    completed = [r for r in records if not r.get("error")]
    inference_ms = [r["handler_metadata"].get("inference_ms") for r in completed if r.get("handler_metadata")]
    inference_ms = [v for v in inference_ms if isinstance(v, (int, float))]
    cold_load_ms = [
        r["handler_metadata"].get("model_load_ms")
        for r in completed
        if r.get("handler_metadata") and r["handler_metadata"].get("model_was_loaded")
    ]
    cold_load_ms = [v for v in cold_load_ms if isinstance(v, (int, float))]
    delay_ms = [r.get("runpod_delay_time_ms") for r in completed]
    delay_ms = [v for v in delay_ms if isinstance(v, (int, float))]

    median_inf, p95_inf = median_p95([float(v) for v in inference_ms])
    median_load, p95_load = median_p95([float(v) for v in cold_load_ms])
    median_delay, p95_delay = median_p95([float(v) for v in delay_ms])

    lines.append("## Aggregate stats")
    lines.append("")
    lines.append("| Metric | Median | p95 | Samples |")
    lines.append("|---|---|---|---|")
    lines.append(f"| Inference (warm + cold) | {fmt_ms(median_inf)} | {fmt_ms(p95_inf)} | {len(inference_ms)} |")
    lines.append(f"| Model load (cold only) | {fmt_ms(median_load)} | {fmt_ms(p95_load)} | {len(cold_load_ms)} |")
    lines.append(f"| RunPod queue delay | {fmt_ms(median_delay)} | {fmt_ms(p95_delay)} | {len(delay_ms)} |")
    lines.append("")

    cost_estimates = [
        r["handler_metadata"].get("estimated_compute_cost_usd")
        for r in completed
        if r.get("handler_metadata")
    ]
    cost_estimates = [v for v in cost_estimates if isinstance(v, (int, float))]
    if cost_estimates:
        total = sum(cost_estimates)
        median_cost = statistics.median(cost_estimates)
        lines.append("## Cost (estimate from handler — handler-time × GPU_PRICE_PER_HOUR_USD)")
        lines.append("")
        lines.append(f"- Total across {len(cost_estimates)} successful prompts: **{fmt_usd(total)}**")
        lines.append(f"- Median per call: **{fmt_usd(median_cost)}**")
        lines.append(f"- Projected at 20 calls/day (alpha cap): **{fmt_usd(median_cost * 20)}/day**")
        lines.append(f"- Projected at 20 calls/day × 30 days: **{fmt_usd(median_cost * 20 * 30)}/month**")
        lines.append("")
        lines.append("> RunPod billing dashboard remains source of truth; this is an estimate.")
        lines.append("")

    failed = [r for r in records if r.get("error")]
    if failed:
        lines.append("## Failures")
        lines.append("")
        for r in failed:
            lines.append(f"- `{r['label']}` ({r.get('mode', 't2v')}): {r.get('error')} — {r.get('error_message', '')}")
        lines.append("")

    lines.append("## Decision input for ADR-0005 v1.x")
    lines.append("")
    lines.append("Compare these numbers against the ADR-0005 Pivot Criteria targets:")
    lines.append("")
    lines.append("- Cold-start budget: ≤ 180s (p95 model load + queue delay).")
    lines.append("- Warm inference: ≤ 60s (p95 inference for non-first job).")
    lines.append(f"- Per-call cost: median × 20 calls/day × 30 days ≤ alpha cost ceiling (current run: {fmt_usd(median_cost * 20 * 30) if cost_estimates else '—'}).")
    lines.append("")
    lines.append("If all three pass, ADR-0005 Status flips Proposed → Accepted in v1.2.")
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Smoke runner for Wan2.2-TI2V-5B RunPod spike (ADR-0005).")
    parser.add_argument("--endpoint-id", required=True, help="RunPod Serverless endpoint ID")
    parser.add_argument("--prompts", default=str(Path(__file__).parent / "benchmark_prompts.json"), help="Path to benchmark prompts JSON")
    parser.add_argument("--gpu-label", default="unknown-gpu", help="Label for the run (e.g. L40S-48GB)")
    parser.add_argument("--out-root", default=str(Path(__file__).parent / "runs"), help="Root directory for run outputs")
    parser.add_argument("--mode", choices=["all", "t2v", "i2v"], default="all", help="Restrict to one mode")
    parser.add_argument("--include", action="append", default=[], help="Only run prompts whose label is in this list (repeatable)")
    parser.add_argument("--exclude", action="append", default=[], help="Skip prompts whose label is in this list (repeatable)")
    parser.add_argument("--poll-interval", type=float, default=DEFAULT_POLL_INTERVAL_S, help="Polling interval in seconds")
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT_S, help="Per-job timeout in seconds")
    parser.add_argument("--dry-run", action="store_true", help="Validate config and payloads but do not submit")
    args = parser.parse_args(argv)

    api_key = os.environ.get("RUNPOD_API_KEY")
    if not api_key and not args.dry_run:
        print("error: RUNPOD_API_KEY env var is required (or use --dry-run)", file=sys.stderr)
        return 2

    spike_root = Path(__file__).parent.resolve()
    prompts_file = Path(args.prompts).resolve()
    if not prompts_file.exists():
        print(f"error: prompts file not found at {prompts_file}", file=sys.stderr)
        return 2

    with prompts_file.open("r", encoding="utf-8") as fh:
        prompts_data = json.load(fh)
    entries = prompts_data.get("prompts", [])
    if not entries:
        print("error: no prompts in file", file=sys.stderr)
        return 2

    include = set(args.include)
    exclude = set(args.exclude)
    selected: list[dict[str, Any]] = []
    for entry in entries:
        label = entry.get("label")
        if not label:
            continue
        if args.mode != "all" and entry.get("mode", "t2v") != args.mode:
            continue
        if include and label not in include:
            continue
        if label in exclude:
            continue
        selected.append(entry)

    if not selected:
        print("error: no prompts selected after filters", file=sys.stderr)
        return 2

    selected.sort(key=lambda e: 0 if e.get("mode", "t2v") == "t2v" else 1)
    print(f"selected {len(selected)} prompts (t2v batched before i2v)", flush=True)

    run_id = f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{args.gpu_label}"
    out_dir = Path(args.out_root) / run_id
    if not args.dry_run:
        out_dir.mkdir(parents=True, exist_ok=True)
        print(f"writing results to {out_dir}", flush=True)
    else:
        print(f"dry-run: would write results to {out_dir}", flush=True)

    headers = {
        "Authorization": f"Bearer {api_key}" if api_key else "",
        "Content-Type": "application/json",
    }

    records: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []

    for entry in selected:
        label = entry["label"]
        print(f"\n=== {label} ({entry.get('mode', 't2v')}) ===", flush=True)
        try:
            payload = build_payload(entry, spike_root)
        except FileNotFoundError as exc:
            print(f"  SKIP: {exc}", flush=True)
            skipped.append({"label": label, "reason": str(exc)})
            continue

        if args.dry_run:
            payload_size = len(json.dumps(payload))
            print(f"  dry-run: payload built ({payload_size} bytes)", flush=True)
            continue

        try:
            record = run_one(
                entry=entry,
                payload=payload,
                endpoint_id=args.endpoint_id,
                headers=headers,
                poll_interval_s=args.poll_interval,
                timeout_s=args.timeout,
                out_dir=out_dir,
            )
            records.append(record)
            print(f"  OK status={record.get('runpod_status')} client_wallclock={fmt_ms(record.get('client_wallclock_ms'))}", flush=True)
        except (TimeoutError, urlerror.URLError, urlerror.HTTPError, RuntimeError) as exc:
            err_record = {
                "label": label,
                "mode": entry.get("mode", "t2v"),
                "error": "runner_exception",
                "error_message": str(exc),
            }
            records.append(err_record)
            write_json(out_dir / "prompts" / label / "metadata.json", err_record)
            write_text(out_dir / "prompts" / label / "error.txt", str(exc))
            print(f"  FAIL: {exc}", flush=True)

    context = {
        "run_id": run_id,
        "started_utc": utc_iso(),
        "endpoint_id": args.endpoint_id,
        "prompts_file": str(prompts_file),
        "gpu_label": args.gpu_label,
        "gpu_price_per_hour_usd": os.environ.get("GPU_PRICE_PER_HOUR_USD"),
        "skipped": skipped,
    }

    if args.dry_run:
        print(f"\ndry-run complete; {len(skipped)} skipped, {len(selected) - len(skipped)} would be submitted", flush=True)
        return 0

    summary_md = render_summary_md(records, context)
    write_text(out_dir / "summary.md", summary_md)
    write_json(out_dir / "summary.json", {"context": context, "records": records})
    print(f"\nwrote {out_dir / 'summary.md'}", flush=True)
    print(f"wrote {out_dir / 'summary.json'}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
