# spike/wan-ti2v-runpod — empirical validation for ADR-0005

Purpose: collect the numbers ADR-0005 (Status: **Proposed**) needs to flip to **Accepted**.

The ADR commits to `Wan-AI/Wan2.2-TI2V-5B-Diffusers` on RunPod Serverless (L40S 48GB preferred, L4 24GB fallback) for unified T2V + I2V at alpha. This directory is the spike that measures whether that commitment is correct.

## What's in this directory

| File | Purpose |
|---|---|
| `handler.py` | RunPod Serverless handler. Loads the diffusers pipeline lazily, validates inputs, returns `video_b64` + `metadata` (model_load_ms, inference_ms, VRAM peak, cost estimate). |
| `Dockerfile` | Container image. Runpod/pytorch base + diffusers from GitHub source (Wan2.2 support cadence newer than PyPI stable). Weights NOT baked in; cached at runtime in `/runpod-volume/hf-cache`. |
| `benchmark_prompts.json` | 10 prompts (5 T2V + 5 I2V) covering motion patterns, subjects, and styles. Edit before final run with prompts representative of YOUR product domain. |
| `smoke_run.py` | CLI runner. Submits prompts sequentially, polls until done, saves MP4 + metadata, aggregates summary. Stdlib-only (no pip install). |
| `test_images/` | Folder for i2v reference images (gitignored). Filenames listed in `test_images/README.md`. |
| `runs/` | Output directory created per smoke run (gitignored). |

## Required environment

- A RunPod Serverless endpoint built from this `Dockerfile`. Endpoint ID required.
- `RUNPOD_API_KEY` — RunPod API key (Bearer auth).
- *Optional but recommended:* `GPU_PRICE_PER_HOUR_USD` set on the **endpoint**'s env (not the runner), so handler reports cost estimates in metadata. Cross-reference with RunPod billing dashboard.
- *Optional:* a network volume mounted at `/runpod-volume` and pre-warmed (`HF_HUB_ENABLE_HF_TRANSFER=1 hf download Wan-AI/Wan2.2-TI2V-5B-Diffusers --cache-dir /runpod-volume/hf-cache`). Use `--cache-dir`, NOT `--local-dir`: the handler calls `from_pretrained(cache_dir=MODEL_CACHE_DIR)` which expects the Hugging Face cache layout `<cache_dir>/models--<org>--<name>/snapshots/<commit>/`. Without pre-warm the first cold-start pays full download time (~10 GB).

## Build & deploy (one-time per GPU tier you want to compare)

```bash
# build
docker build -t wan-ti2v-spike -f spike/Dockerfile spike/

# tag + push to your registry
docker tag wan-ti2v-spike <registry>/wan-ti2v-spike:0.1.0-spike
docker push <registry>/wan-ti2v-spike:0.1.0-spike

# create RunPod Serverless endpoint pointing to that image
#   - GPU: L40S 48GB (recommended) or L4 24GB (cost-sensitive fallback)
#   - workers: min_idle 0, max 1 for spike (don't pay for parallel cold starts)
#   - idle timeout: 60s
#   - network volume: 30 GB at /runpod-volume
#   - flashboot: on
#   - env vars: see ADR-0005 §Implementation Notes
```

## Run the smoke suite

```bash
export RUNPOD_API_KEY=<your-key>

# full suite (5 t2v + 5 i2v if all images present)
python3 spike/smoke_run.py \
    --endpoint-id <runpod-endpoint-id> \
    --gpu-label L40S-48GB

# t2v only (faster validation; skips i2v even if images present)
python3 spike/smoke_run.py \
    --endpoint-id <runpod-endpoint-id> \
    --gpu-label L40S-48GB \
    --mode t2v

# single prompt by label (debug a failure)
python3 spike/smoke_run.py \
    --endpoint-id <runpod-endpoint-id> \
    --gpu-label L40S-48GB \
    --include t2v-03-dynamic-action

# dry-run (validate config, do not submit)
python3 spike/smoke_run.py --endpoint-id any --gpu-label any --dry-run
```

The runner sorts t2v before i2v automatically (the handler unloads its pipeline on mode switch, so batching avoids paying that cost more than once per run).

## Output structure

A run produces:

```
spike/runs/<UTC-timestamp>-<gpu-label>/
├── summary.md          # human-readable: per-prompt table + aggregate stats + cost projection
├── summary.json        # machine-readable: same data plus full handler metadata
└── prompts/
    └── <label>/
        ├── video.mp4       # generated clip (visual review)
        ├── metadata.json   # handler metadata + RunPod platform metrics for this prompt
        └── error.txt       # only if the prompt failed
```

`summary.md` ends with a "Decision input for ADR-0005" block that compares your numbers against the three pivot criteria from the ADR.

## How to interpret the numbers

| Metric | Source | Meaning |
|---|---|---|
| `runpod_delay_time_ms` | RunPod platform | Time from submit to worker pickup. Cold-start surfaces here when no worker is warm. |
| `runpod_execution_time_ms` | RunPod platform | Total time inside the worker, including handler boot + model load + inference. |
| `handler_total_ms` | handler | Wall-clock of one job inside the handler (input→output). |
| `model_load_ms` | handler | Diffusers pipeline load time. Reported only when `model_was_loaded=True`. **Cold metric.** |
| `inference_ms` | handler | Pure pipeline call; excludes model load and MP4 export. **Warm metric.** |
| `first_job_in_process` | handler | True for the first job a worker processes after boot. Use to bucket cold vs warm samples. |
| `max_memory_allocated_gb` | handler | Peak VRAM observed for this generation. Compare against GPU tier (24/48/80 GB). |
| `estimated_compute_cost_usd` | handler | `handler_total_ms × GPU_PRICE_PER_HOUR_USD / 3600`. Estimate only; reconcile with RunPod billing. |

## ADR-0005 acceptance gate

The ADR flips Proposed → Accepted in v1.2 if all three thresholds hold across the smoke run:

1. **Cold-start budget:** p95 `(runpod_delay_time_ms + model_load_ms)` ≤ 180s.
2. **Warm inference budget:** p95 `inference_ms` (excluding first-job samples) ≤ 60s.
3. **Cost budget:** median per-call cost × 20 calls/day × 30 days ≤ alpha cost ceiling.

If any fails, document the gap in a v1.x amendment and pick a remediation:

- High cold-start → enable always-on min_idle=1 OR switch to baked-image variant OR move pre-warm to a cron.
- High inference → drop to L40S, increase steps cap on lower-quality presets, or evaluate LTX-Video 2B as Plan B.
- High cost → lower the alpha rate-limit cap below 20 calls/day, or move to L4 24GB if VRAM allows.

## Comparing two GPU tiers

Run twice with different `--gpu-label` and `--endpoint-id` and diff the two `summary.json` files:

```bash
# L40S endpoint
python3 spike/smoke_run.py --endpoint-id <l40s-id> --gpu-label L40S-48GB

# L4 endpoint
python3 spike/smoke_run.py --endpoint-id <l4-id> --gpu-label L4-24GB

# eyeball the two summary.md files side-by-side; or
diff <(jq -S '.records' spike/runs/*L40S-48GB/summary.json) \
     <(jq -S '.records' spike/runs/*L4-24GB/summary.json)
```

The ADR-0005 §Decision currently prefers L40S; if the L4 numbers are close enough on cost AND meet the 60s warm threshold, the ADR can amend the GPU tier downward.
