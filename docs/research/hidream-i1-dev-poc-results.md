# HiDream-I1 Dev — PoC raw measurements (Story 6.1)

**Story:** [`docs/stories/6.1.hidream-i1-poc-spike.story.md`](../stories/6.1.hidream-i1-poc-spike.story.md)  
**PRD:** [`docs/prd/epic-6-hidream-poc-validation.md`](../prd/epic-6-hidream-poc-validation.md)  
**Spike code:** [`spike/hidream-poc/`](../../spike/hidream-poc/README.md)

> **Execution status:** Scaffold + measurement tooling merged on `spike/hidream-i1-poc`. Empirical numbers below are placeholders until a maintainer completes the RunPod sequence in `spike/hidream-poc/README.md` and copies values from `.aiox/notes/story-6.1/*.json` (gitignored). **Do not** merge real unit-economics figures to a public mirror without @po sanitization.

## Executive Summary

- **AC2–AC5 (pending operator run):** Isolated L40S serverless endpoint, cold P50/P95 (10 samples), warm P50/P95 (50 samples), USD/image (warm + cold-amortized), spend vs $50 cap.
- **Total PoC spend (pending):** _TBD_ from `cost-ledger.json`.
- **Ready for Story 6.2:** After 50 PNGs + `outputs/manifest.json` exist locally and endpoint teardown is verified.

## Infrastructure

| Field | Value |
| --- | --- |
| Endpoint name | `endpoint-hidream-poc-{date}` (_TBD_) |
| Endpoint id | _TBD — set `RUNPOD_HIDREAM_POC_ENDPOINT_ID`_ |
| GPU class | L40S 48GB (preferred) |
| Container image | _TBD digest_ |
| Weights | `HiDream-ai/HiDream-I1-Dev` via `HiDreamImagePipeline` (see handler) |
| Run dates (UTC) | _TBD_ |

## Measurements

| Metric | Value | Source artifact |
| --- | --- | --- |
| Cold start P50 (s) | _TBD_ | `cold-start-*.json` |
| Cold start P95 (s) | _TBD_ | `cold-start-*.json` |
| Warm latency P50 (s) | _TBD_ | `warm-latency-*.json` |
| Warm latency P95 (s) | _TBD_ | `warm-latency-*.json` |
| L40S $/sec (dashboard) | _TBD_ | recorded in `cost-ledger.json` |
| Warm $/image | _TBD_ | `cost-ledger.json` (`warm_per_image_usd`) |
| Cold-amortized $/image (50-draw) | _TBD_ | `cost-ledger.json` (`cold_amortized_per_image_usd`) |

Composite rollup: `measurements-*.json` under `.aiox/notes/story-6.1/` after `measure.py all`.

## Methodology Notes

- **Prompt set:** `spike/hidream-poc/prompts.json` (50 rows, shared with Story 6.2).
- **Seeds:** deterministic schedule `300_000 + i * 9973` for warm index `i` (see `measure.py`).
- **Inference lock-in:** 28 steps, 1024×1024, `guidance_scale` from env (default 0.0 in handler for Dev).
- **Cold definition:** `IDLE_GAP_S` default 35s between cold invocations (> 30s `idle_timeout`), 10 runs.
- **Warm definition:** 50 sequential jobs on the same warm worker window; latency uses handler `metadata.inference_s`, falling back to RunPod `executionTime`.
- **Not measured here:** Blind A/B, model card verdict, FLUX dev reference quality — Story 6.2.

## Open Threads for Story 6.2

- PNG directory: `.aiox/notes/story-6.1/outputs/` (local only).
- Manifest: `.aiox/notes/story-6.1/outputs/manifest.json` after warm run completes.

## NOT INCLUDED HERE

- Blind A/B win rate, confidence intervals, evaluator sheets
- HiDream-I1 model card / compliance audit
- ADR-0006 verdict (owned by Story 6.2 + architect handoff)
