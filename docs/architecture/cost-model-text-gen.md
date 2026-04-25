# Cost Model — Gemma Text Generation

> **Public stub.** The full unit-economics workbook (per-GPU per-call projections, scenario tables, break-even calculations) is preserved in the private internal mirror per the [public-repo sanitization policy](../qa/security-audit-2026-04-22.md). This page exists so cross-references from ADR-0004 and Epic 4 still resolve.

## Methodology summary

The text-gen cost model uses RunPod serverless flex pricing (public, per-hour by GPU SKU) combined with the Phase 0 alpha shape (~100 calls/day, ~500 output tokens average) to project monthly cost across three scenarios:

- **Warm-only** — no cold starts amortized.
- **Realistic** — ~10% cold-start ratio (matches early observed traffic).
- **Pessimistic** — ~25% cold-start ratio.

The model also computes break-even vs a dedicated always-on pod to confirm serverless-flex remains the right choice at alpha volume.

## Outputs (referenced elsewhere)

The model concludes that the **alpha tier (Gemma 4 4B effective on L4 24GB flex)** stays comfortably inside the alpha cost ceiling adopted in Phase 0. The premium tier (`gemma-3-27b-it` on A100 80GB) is documented separately and gated to post-alpha. The full numeric tables and break-even analysis are not reproduced publicly.

## Sources

- RunPod serverless flex pricing — see <https://www.runpod.io/pricing>
- Phase 0 alignment — see Epic 4 PRD constraints
- ADR-0004 §6 (cost) — references this model

## Where to find the full document

- **Repo:** `Jhonata-Matias/servegate-planning` (private mirror)
- **Path:** `docs/architecture/cost-model-text-gen.md`
- **Branch:** `feature/4.2-private-mirror`

Granting access to the private mirror is at the repository owner's discretion.
