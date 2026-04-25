# Gemma Provider / Worker Image Assessment

> **Public stub.** The full provider-and-worker-image comparison (per-GPU per-second pricing, image baseline cost, FlashBoot warm vs cold trade-off, cold-start estimates) is preserved in the private internal mirror per the [public-repo sanitization policy](../qa/security-audit-2026-04-22.md). This page exists so cross-references from ADR-0004 still resolve.

## Headline recommendation (no numbers)

Adopt an **OpenAI-compatible RunPod serverless worker image** that natively supports Gemma weights from a network volume, separate from the existing image-gen FLUX endpoint. Alpha runs the **4B class on L4 24GB flex workers**; premium tier holds the 27B class on A100 80GB. The official `runpod-workers/worker-vllm` and a maintained Ollama-on-RunPod image were both surveyed; per Story 4.2 Tasks 1-2 the project pivoted to the Ollama image after vLLM CUDA / multimodal compatibility issues on the available 4090 hosts (see ADR-0004 v1.2 amendment).

## Trade-offs evaluated (qualitative)

- **GPU SKU selection** at 24GB: L4 (Ada, bf16-native) vs RTX 4090 vs L40S vs A100 — chosen on cost-per-call, cold-start rate, and SECURE-tier availability per region.
- **Worker image**: maintained-by-RunPod vs community Ollama image — chose the Ollama path after vLLM stack failures during provisioning.
- **Network volume reuse** vs per-worker image bake — chose volume reuse to avoid weight re-downloads on every cold start and to keep the image small.
- **Streaming**: native SSE end-to-end via the provider's OpenAI-compatible chat completions route is required.

The full per-second cost numbers, image baseline cost, and per-GPU cold-start-time estimates are not reproduced publicly.

## Where to find the full document

- **Repo:** `Jhonata-Matias/servegate-planning` (private mirror)
- **Path:** `docs/architecture/gemma-provider-assessment.md`
- **Branch:** `feature/4.2-private-mirror`

Granting access to the private mirror is at the repository owner's discretion.
