/**
 * Story 7.1 — POD lifecycle scheduler.
 *
 * Runs on Cloudflare Cron Triggers (declared in wrangler.toml). Three triggers:
 *
 *   1. Morning start   `0 11 * * 1-5`      — 11 UTC / 08:00 GMT-3, Mon-Fri
 *   2. Evening stop    `0 21 * * 1-5`      — 21 UTC / 18:00 GMT-3, Mon-Fri
 *   3. Peak idle-check `* /5 13-18 * * 1-5` — every 5min, 13-18 UTC / 10-15:55 GMT-3 Mon-Fri
 *
 * Idle-check window is deliberately narrow: 10:00-15:55 GMT-3 only. The user
 * chose grace periods around start-of-day (08-10 GMT-3) and end-of-day
 * (16-18 GMT-3) where the POD stays warm even if idle — matches meeting-heavy
 * pockets bracketing deep-work windows. Between 16 GMT-3 and 18 GMT-3 the
 * POD keeps running; at 18 GMT-3 the evening cron stops it.
 *
 * Idle threshold: 60 min without a coder request (tracked by `handleGenerate`
 * writing `coder:last_request_ms` to RATE_LIMIT_KV on every qwen3-coder request).
 *
 * All start/stop calls are idempotent — they no-op if the POD is already in
 * the requested state (RunPod returns success for redundant transitions).
 */

import type { Env } from './types.js';
import { log } from './log.js';

const IDLE_THRESHOLD_MS = 60 * 60 * 1000; // 60 minutes
const KV_LAST_REQUEST_KEY = 'coder:last_request_ms';
const RUNPOD_REST_BASE = 'https://rest.runpod.io/v1';

interface ScheduledEventLite {
  cron: string;
  scheduledTime: number;
}

interface PodScheduleContext {
  waitUntil?(promise: Promise<unknown>): void;
}

/**
 * Cloudflare Cron trigger entry point. Dispatches based on the exact cron
 * pattern that fired.
 */
export async function handleScheduled(
  event: ScheduledEventLite,
  env: Env,
  ctx?: PodScheduleContext,
): Promise<void> {
  const now = event.scheduledTime;
  const cron = event.cron;

  if (!env.RUNPOD_CODER_POD_ID) {
    logScheduler('scheduler_missing_pod_id', now, cron, 'skip');
    return;
  }
  if (!env.RUNPOD_API_KEY) {
    logScheduler('scheduler_missing_api_key', now, cron, 'skip');
    return;
  }

  // Route by cron pattern. Exact-match on the two hourly triggers; the idle
  // check has a wildcard minute so we match by prefix.
  if (cron === '0 11 * * 1-5') {
    await withCtx(ctx, () => runMorningStart(env, now));
    return;
  }
  if (cron === '0 21 * * 1-5') {
    await withCtx(ctx, () => runEveningStop(env, now));
    return;
  }
  if (cron.startsWith('*/5 13-18')) {
    await withCtx(ctx, () => runIdleCheck(env, now));
    return;
  }

  logScheduler('scheduler_unknown_cron', now, cron, 'skip');
}

// ---------------------------------------------------------------------------
// Trigger handlers
// ---------------------------------------------------------------------------

async function runMorningStart(env: Env, now: number): Promise<void> {
  logScheduler('scheduler_morning_start', now, '0 11 * * 1-5', 'starting');
  const result = await startPod(env);
  logScheduler('scheduler_morning_start', now, '0 11 * * 1-5', result);
}

async function runEveningStop(env: Env, now: number): Promise<void> {
  logScheduler('scheduler_evening_stop', now, '0 21 * * 1-5', 'stopping');
  const result = await stopPod(env);
  logScheduler('scheduler_evening_stop', now, '0 21 * * 1-5', result);
}

async function runIdleCheck(env: Env, now: number): Promise<void> {
  const raw = await env.RATE_LIMIT_KV.get(KV_LAST_REQUEST_KEY);
  if (!raw) {
    // No requests EVER tracked. Skip — don't kill a POD that might be warming
    // up or that a user is about to hit. Grace covers this case implicitly.
    logScheduler('scheduler_idle_check', now, 'idle-check', 'no_last_request');
    return;
  }
  const lastMs = Number(raw);
  if (!Number.isFinite(lastMs)) {
    logScheduler('scheduler_idle_check', now, 'idle-check', 'invalid_timestamp');
    return;
  }
  const idleMs = now - lastMs;
  if (idleMs < IDLE_THRESHOLD_MS) {
    // Recent activity — keep POD alive.
    logScheduler('scheduler_idle_check', now, 'idle-check', `active_${Math.round(idleMs / 60000)}min`);
    return;
  }
  // Idle over threshold during peak — shut down.
  logScheduler('scheduler_idle_check', now, 'idle-check', `idle_${Math.round(idleMs / 60000)}min_stopping`);
  const result = await stopPod(env);
  logScheduler('scheduler_idle_check', now, 'idle-check', `stop_result_${result}`);
}

// ---------------------------------------------------------------------------
// RunPod API calls (idempotent)
// ---------------------------------------------------------------------------

async function startPod(env: Env): Promise<string> {
  const url = `${RUNPOD_REST_BASE}/pods/${env.RUNPOD_CODER_POD_ID}/start`;
  return callRunpod(url, env);
}

async function stopPod(env: Env): Promise<string> {
  const url = `${RUNPOD_REST_BASE}/pods/${env.RUNPOD_CODER_POD_ID}/stop`;
  return callRunpod(url, env);
}

async function callRunpod(url: string, env: Env): Promise<string> {
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RUNPOD_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });
    if (resp.status >= 200 && resp.status < 300) return `ok_${resp.status}`;
    if (resp.status === 400) {
      // 400 typically = already in requested state (redundant transition)
      return `noop_400`;
    }
    return `err_${resp.status}`;
  } catch {
    return 'err_network';
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

async function withCtx(
  ctx: PodScheduleContext | undefined,
  work: () => Promise<void>,
): Promise<void> {
  if (ctx?.waitUntil) {
    const p = work();
    ctx.waitUntil(p);
    await p;
    return;
  }
  await work();
}

function logScheduler(event: string, ts: number, cron: string, result: string): void {
  log({
    timestamp: ts,
    // Structured logging follows existing gateway log schema — event is a string
    // (LogEventName is a union but the log helper accepts arbitrary event names
    // via widening; scheduler events are prefixed `scheduler_*` for filtering).
    event: event as never,
    ip: null,
    status: 200,
    elapsed_ms: 0,
    error_code: `${cron}:${result}`,
  });
}
