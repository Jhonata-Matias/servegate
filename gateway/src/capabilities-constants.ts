/**
 * Capabilities response for GET /capabilities (Story 5.2 AC6).
 *
 * estimated_wait_seconds values are derived from gate-i2v-prod-readiness
 * empirical reliability evidence:
 *   - p50 (warm reuse): ~37s wallclock observed (G2-run2)
 *     → conservative 90s rounding for SDK display
 *   - p95 (cold worker): ~165s wallclock observed (G2-run3)
 *     → 200s budget for variance
 *   - first_call_max: 600s = the LTX execution acceptance gate ceiling
 *     (cold-pool spawn observed at 525s once on G1)
 *
 * Evidence: spike/runs/i2v-prod-readiness-20260504T2034Z/reliability.json
 * Architectural anchor: docs/architecture/adr-0005-video-stack-v1.5-amendment.md §"Cost envelope" + §"Cold-start posture"
 *
 * If gate evidence is re-collected (e.g., after workersMin=1 or beta scoping),
 * update these numbers and bump CAPABILITIES_RESPONSE.version accordingly.
 */
export const CAPABILITIES_RESPONSE = {
  version: "alpha-2026-05",
  capabilities: {
    image: { available: true, models: ["flux-schnell", "qwen-edit"], daily_limit: 20 },
    text: { available: true, models: ["gemma-4-e4b"], daily_limit_tokens: 100000 },
    video: {
      available: true,
      models: ["ltx-video-2b-distilled"],
      modes: ["t2v", "i2v"],
      daily_limit: 20,
      estimated_wait_seconds: { p50: 90, p95: 200, first_call_max: 600 },
      default_resolution: { width: 704, height: 512 },
      default_duration_seconds: 5.04,
      supported_image_inputs: ["data:image/jpeg;base64", "data:image/png;base64"],
    },
  },
} as const;

export type CapabilitiesResponse = typeof CAPABILITIES_RESPONSE;
