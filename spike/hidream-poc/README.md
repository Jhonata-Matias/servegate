# HiDream-I1 Dev — Story 6.1 PoC (isolated)

**Branch:** `spike/hidream-i1-poc`  
**PRD:** `docs/prd/epic-6-hidream-poc-validation.md`  
**Story:** `docs/stories/6.1.hidream-i1-poc-spike.story.md`  
**GPU budget:** **USD 50 hard cap** — circuit breaker in `measure.py` + manual abort if dashboard spend diverges.

This directory is **not** wired to the production gateway, SDK, or capability discovery. Keep `serverless/handler.py`, `gateway/src/`, and `packages/sdk/` untouched (AC8).

## What to run (operator)

1. **Build & push** the Docker image from this directory (your GHCR or RunPod registry). Example:
   - `docker build -t your-registry/hidream-i1-poc:dev .`
   - Push and note the image digest you pin in the RunPod template.

2. **Create a new RunPod Serverless template + endpoint** (REST API pattern matches `serverless/deploy.sh`, but **do not** reuse production template name/endpoint id):
   - GPU: `NVIDIA L40S` 48GB (fallback `A100 80GB` if FP16 OOM — see AC2).
   - **Do not** mount the production FLUX network volume. Use ephemeral disk or a **new** empty volume for Hugging Face cache only.
   - Workers: `min_idle=0`, `max=1`, `idle_timeout=30s`, `execution_timeout=300000` ms, `flashboot=true` when available.
   - Env vars on the worker:
     - `HF_TOKEN` — **required** for gated `meta-llama/Meta-Llama-3.1-8B-Instruct` (HiDream Image pipeline dependency per [diffusers HiDream docs](https://huggingface.co/docs/diffusers/main/en/api/pipelines/hidream)).
     - Optional: `HIDREAM_TORCH_DTYPE=float16` (default) or `bfloat16` if numerics demand it.
     - Optional: `HIDREAM_GUIDANCE_SCALE` — default `0.0` in handler (distilled Dev checkpoint; align with measurement lock-in).

3. **Export** in your local `.env` (never commit):
   - `RUNPOD_API_KEY`
   - `RUNPOD_HIDREAM_POC_ENDPOINT_ID` — id of **this** endpoint only
   - `L40S_RATE_USD_PER_SEC` — **read from the RunPod pricing/dashboard at the PoC date** (do not hardcode in git)
   - Optional: `BUDGET_CAP_USD=50`, `IDLE_GAP_S=35` (must exceed `idle_timeout` for cold samples)

4. **Smoke** (AC2 first cold success path):
   ```bash
   cd spike/hidream-poc
   export RUNPOD_API_KEY=... RUNPOD_HIDREAM_POC_ENDPOINT_ID=...
   python3 measure.py smoke
   ```
   Expect `COMPLETED` and non-empty `png_bytes`.

5. **Cold + warm benchmarks** (AC3–AC6):
   ```bash
   export L40S_RATE_USD_PER_SEC=...   # from dashboard
   python3 measure.py all
   ```
   Artifacts land under `.aiox/notes/story-6.1/` (gitignored): `cold-start-*.json`, `warm-latency-*.json`, `outputs/*.png`, `outputs/manifest.json`, `cost-ledger.json`, `measurements-*.json`.

6. **Teardown** (AC7):
   ```bash
   bash teardown.sh
   ```
   Store the API response (or dashboard screenshot path) as evidence in your local notes directory.

7. **Production regression** (AC8) — from repo root:
   ```bash
   git diff main...HEAD -- serverless/handler.py
   git diff main...HEAD -- gateway/src/
   git diff main...HEAD -- sdk/
   ```
   All must be empty. Then one live `POST /jobs` FLUX smoke; save curl/HAR under `.aiox/notes/story-6.1/regression-smoke-<ts>.md`.

8. **Fill** `docs/research/hidream-i1-dev-poc-results.md` executive summary + tables from the JSON artifacts (sanitized before any public mirror push — @po).

## OOM / fallback (AC2)

If the worker logs show CUDA OOM at 48GB with FP16: **stop** AC3–AC9, document in this README + story Dev Notes, escalate to @architect for FP8 or A100 80GB replan.

## Contract

- **Input** (RunPod `input` JSON): `prompt`, optional `steps` (default 28), `seed`, `width`, `height` (1024² for AC4), `guidance_scale`.
- **Output:** `{ "image_b64": "...", "metadata": { "seed", "elapsed_ms", "inference_s", ... } }` — mirrors production handler envelope for tooling reuse.
