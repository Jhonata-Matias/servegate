/**
 * JOBS_KV storage wrapper (INC-2026-04-23-gateway-504 FR-3).
 *
 * Persists the mapping job_id → runpod_request_id + status metadata.
 *
 * TTL semantics (aligned with RunPod async retention, research RT-2):
 *   - On initial write (submit):  6h from submit (TTL_ON_SUBMIT_SEC)
 *   - On completion update:       30min from completion (TTL_AFTER_COMPLETION_SEC)
 *     → matches RunPod async result retention; beyond 30min RunPod has dropped the result
 *       and /status would return nothing meaningful anyway.
 *
 * Eventual-consistency mitigation (ASM-1 + research RT-1):
 *   - GET /jobs/{id} reads pass a low `cacheTtl` to Cloudflare KV to narrow the
 *     propagation staleness window from the default 60s.
 *   - Residual races are absorbed by SDK retry-with-backoff on 404 (EC-7).
 */

import type { JobMapping, JobStatus } from './types.js';

export const TTL_ON_SUBMIT_SEC = 6 * 60 * 60;          // 6h — submit-to-completion budget
export const TTL_AFTER_COMPLETION_SEC = 30 * 60;        // 30min — matches RunPod retention
export const DEFAULT_READ_CACHE_TTL_SEC = 5;            // narrow staleness window per RT-1

/**
 * Writes an initial JobMapping with submit TTL.
 * Called on successful POST /jobs after RunPod /run returns.
 */
export async function putMapping(
  kv: KVNamespace,
  mapping: JobMapping,
  options: { expirationTtl?: number } = {},
): Promise<void> {
  const ttl = options.expirationTtl ?? TTL_ON_SUBMIT_SEC;
  await kv.put(mapping.job_id, JSON.stringify(mapping), { expirationTtl: ttl });
}

/**
 * Reads a JobMapping by job_id. Returns null if not found OR expired.
 *
 * Uses `cacheTtl` to shorten the edge cache lifetime vs the 60s default.
 * Lower values increase origin hits but reduce staleness; we default to 5s which
 * matches our suggested polling cadence (Retry-After: 5) — so each poll naturally
 * picks up recent writes.
 */
export async function getMapping(
  kv: KVNamespace,
  jobId: string,
  options: { cacheTtl?: number } = {},
): Promise<JobMapping | null> {
  const cacheTtl = options.cacheTtl ?? DEFAULT_READ_CACHE_TTL_SEC;
  const raw = await kv.get(jobId, { cacheTtl });
  if (!raw) return null;
  try {
    return JSON.parse(raw) as JobMapping;
  } catch {
    // Corrupted KV entry — treat as not-found. Caller returns 404 per EC-2 unified handling.
    return null;
  }
}

/**
 * Updates the status (and timestamps) of an existing JobMapping.
 *
 * On terminal status (completed/failed/cancelled/timeout) re-writes with
 * TTL_AFTER_COMPLETION_SEC so the entry lives only 30min past completion — aligned
 * with RunPod result retention per research RT-2.
 *
 * On non-terminal updates (e.g., queued → running) the original TTL is preserved
 * (KV put resets TTL on every write — but we use the remaining budget heuristic by
 * recomputing from created_at below).
 *
 * Returns the updated mapping for caller logging; returns null if the key did not
 * exist (caller should treat as race/expired and respond 404).
 */
export async function updateStatus(
  kv: KVNamespace,
  jobId: string,
  newStatus: JobStatus,
  extras: { error_code?: string } = {},
): Promise<JobMapping | null> {
  const existing = await getMapping(kv, jobId, { cacheTtl: 0 });
  if (!existing) return null;

  const now = Date.now();
  const isTerminal =
    newStatus === 'completed' ||
    newStatus === 'failed' ||
    newStatus === 'cancelled' ||
    newStatus === 'timeout';

  const updated: JobMapping = {
    ...existing,
    status: newStatus,
  };
  const terminalTimestamp = isTerminal ? now : existing.completed_at;
  if (terminalTimestamp !== undefined) updated.completed_at = terminalTimestamp;
  const finalErrorCode = extras.error_code ?? existing.error_code;
  if (finalErrorCode !== undefined) updated.error_code = finalErrorCode;

  const ttl = isTerminal
    ? TTL_AFTER_COMPLETION_SEC
    : // Not terminal: preserve remaining lifetime approximately. Take the max of
      // (original 6h budget minus elapsed since created_at) and a 5min floor so
      // mid-generation races never resurrect an entry for longer than sensible.
      Math.max(5 * 60, TTL_ON_SUBMIT_SEC - Math.floor((now - existing.created_at) / 1000));

  await kv.put(jobId, JSON.stringify(updated), { expirationTtl: ttl });
  return updated;
}
