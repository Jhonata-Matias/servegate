# Gemma Model Candidates — Selection Rationale

> **Public stub.** The full candidate-comparison matrix (per-model × per-GPU latency and per-call cost projections) is preserved in the private internal mirror per the [public-repo sanitization policy](../qa/security-audit-2026-04-22.md). This page exists so cross-references from ADR-0004 and Epic 4 still resolve.

## Selection summary (no numbers)

The candidate field at Phase 0.1 covered **Gemma 1B / 3B / 4B / 12B / 27B** across L4 24GB, RTX 4090 24GB, L40S 48GB, A100 80GB, and H100 80GB tiers (all RunPod serverless flex SKUs).

After applying the alpha shape (~100 calls/day, ~500 output tokens average) and the alpha cost ceiling adopted in Phase 0, the **4B class on L4 24GB** emerged as the dominant choice on cost-per-quality. The 27B class on A100 was retained as the **premium tier** for post-alpha when budget headroom allows.

The full per-model × per-GPU comparison matrix (warm cost per call, monthly projection at alpha shape, latency band, quality benchmark scores) is not reproduced publicly.

## Headline conclusions referenced elsewhere

- **Best for alpha:** 4B class on L4 24GB — sweet spot of cost, quality, and 24GB GPU availability.
- **Premium tier:** 27B class on A100 80GB — kept for future scope.
- **Quality benchmarks:** 4B model already surpasses Gemma-2-27B-IT baseline on most tracks per the public Gemma 3 technical report (<https://arxiv.org/abs/2503.19786>).

## Where to find the full document

- **Repo:** `Jhonata-Matias/servegate-planning` (private mirror)
- **Path:** `docs/architecture/gemma-model-candidates.md`
- **Branch:** `feature/4.2-private-mirror`

Granting access to the private mirror is at the repository owner's discretion.
