import { collectApiKeys, validateAuth } from './auth.js';
import { getClientIp, log } from './log.js';
import { openaiErrorResponse, type OpenAIErrorBody } from './openai-error.js';
import {
  checkTokenBudget,
  recordTokenUsage,
  TOKEN_DAILY_LIMIT,
} from './rate-limit.js';
import { forwardToTextEndpoint, TextUpstreamError } from './runpod-text.js';
import type { Env, GenerateMessage, GenerateRequest, GenerateResponse, TokenBudgetState } from './types.js';

const DEFAULT_TEXT_MODEL = 'gemma4:e4b';
const DEFAULT_MAX_TOKENS = 512;
const MAX_ALPHA_TOKENS = 2048;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

// Story 7.1 — Supported models catalog. Extend this list AND `resolveModelEndpoint`
// AND `openai-models.ts::MODEL_CATALOG` together (single source of truth intentionally
// avoided to keep the /v1/models endpoint independently mockable in tests). The
// `SUPPORTED_MODELS invariant` test in tests/model-routing.test.ts catches drift.
const SUPPORTED_MODELS = ['gemma4:e4b', 'qwen3-coder:30b'] as const;

/**
 * Story 7.1 — Resolves a model id to its RunPod Serverless endpoint id.
 * Returns null when the model is known but its endpoint secret is unset
 * (e.g. qwen3-coder:30b during a rollback where RUNPOD_CODER_ENDPOINT_ID
 * was deleted but the code branch remains). Caller converts null into a
 * 404 `model_not_found` response via `openaiErrorResponse('model_not_found')`
 * (see ERROR_MAP in openai-error.ts — code → status).
 */
export function resolveModelEndpoint(model: string, env: Env): string | null {
  switch (model) {
    case 'gemma4:e4b':
      return env.RUNPOD_TEXT_ENDPOINT_ID ?? null;
    case 'qwen3-coder:30b':
      return env.RUNPOD_CODER_ENDPOINT_ID ?? null;
    default:
      return null;
  }
}

type WaitUntilContext = Pick<ExecutionContext, 'waitUntil'>;

// ===========================================================================
// Story 1.1 FR-3 — Envelope normalization helpers
// ===========================================================================

/** Generates a chatcmpl-{uuid} ID, constant for all frames of one response. */
function generateChatCompletionId(): string {
  return `chatcmpl-${crypto.randomUUID()}`;
}

/** Returns current epoch in seconds (not ms). */
function getEpochSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Transforms an upstream SSE stream, injecting `id` and `created` into every
 * `data:` frame. Non-data lines (comments, empty lines) pass through unchanged.
 * `data: [DONE]` is passed through as-is.
 */
function envelopeStream(
  upstreamBody: ReadableStream<Uint8Array>,
  id: string,
  created: number,
  model: string,
  includeUsage: boolean,
  usageObj?: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number },
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  return new ReadableStream({
    async start(controller) {
      const reader = upstreamBody.getReader();
      let buffer = '';
      let emittedUsage = false;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          // Keep the last (potentially incomplete) line in the buffer
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trimEnd();

            // Pass through empty lines and comments
            if (trimmed === '' || trimmed.startsWith(':')) {
              controller.enqueue(encoder.encode(line + '\n'));
              continue;
            }

            // Pass through [DONE] but ensure usage frame is emitted before it
            if (trimmed === 'data: [DONE]') {
              if (includeUsage && !emittedUsage) {
                const usageFrame: any = {
                  id,
                  created,
                  object: 'chat.completion',
                  model,
                  choices: [],
                };
                if (usageObj) usageFrame.usage = usageObj;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(usageFrame)}\n`));
                emittedUsage = true;
              }
              controller.enqueue(encoder.encode(line + '\n'));
              continue;
            }

            // Parse data: {...} and inject id/created
            if (trimmed.startsWith('data: ')) {
              const jsonStr = trimmed.slice(6);
              try {
                const chunk = JSON.parse(jsonStr);
                chunk.id = id;
                chunk.created = created;
                if (!chunk.model) chunk.model = model;
                // If this frame contains a usage object, mark emittedUsage
                if (chunk.usage) emittedUsage = true;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n`));
              } catch {
                // Malformed JSON — pass through as-is
                controller.enqueue(encoder.encode(line + '\n'));
              }
            } else {
              // Non-data line — pass through
              controller.enqueue(encoder.encode(line + '\n'));
            }
          }
        }

        // Flush remaining buffer
        if (buffer.length > 0) {
          controller.enqueue(encoder.encode(buffer));
        }

        // If the stream ended without an explicit [DONE], ensure usage/done ordering
        if (includeUsage && !emittedUsage) {
          const usageFrame: any = {
            id,
            created,
            object: 'chat.completion',
            model,
            choices: [],
          };
          if (usageObj) usageFrame.usage = usageObj;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(usageFrame)}\n`));
        }

        // Success path — close the stream cleanly
        controller.close();
      } catch (err) {
        controller.error(err);
      } finally {
        reader.releaseLock();
      }
    },
  });
}

export async function handleGenerate(
  request: Request,
  env: Env,
  ctx?: WaitUntilContext,
): Promise<Response> {
  const start = Date.now();
  const ip = getClientIp(request);

  // Story 1.1 FR-3: generate id and created once per request
  const completionId = generateChatCompletionId();
  const created = getEpochSeconds();

  const authFailure = validateAuth(authCompatibleRequest(request), collectApiKeys(env));
  if (authFailure) {
    return withGenerateHeaders(authFailure, defaultTokenState(), DEFAULT_TEXT_MODEL, env);
  }

  const contentLength = Number.parseInt(request.headers.get('Content-Length') ?? '0', 10);
  if (contentLength > MAX_BODY_BYTES) {
    return generateError(413, 'request_too_large', defaultTokenState(), DEFAULT_TEXT_MODEL, env);
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return generateError(400, 'invalid_request', defaultTokenState(), DEFAULT_TEXT_MODEL, env);
  }

  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return generateError(413, 'request_too_large', defaultTokenState(), DEFAULT_TEXT_MODEL, env);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    logGenerateInvalid(ip, start, 'invalid_json');
    return generateError(400, 'invalid_json', defaultTokenState(), DEFAULT_TEXT_MODEL, env);
  }

  const validation = normalizeGenerateRequest(parsed);
  if ('error' in validation) {
    logGenerateInvalid(ip, start, validation.error);
    return generateError(400, validation.error, defaultTokenState(), DEFAULT_TEXT_MODEL, env);
  }

  const body = validation.value;
  const model = body.model ?? DEFAULT_TEXT_MODEL;
  const approxTokens = estimateMaxPossibleTokens(rawBody, body.max_tokens ?? DEFAULT_MAX_TOKENS);
  const { state: tokenState, allowed } = await checkTokenBudget(env.RATE_LIMIT_KV, approxTokens);
  if (!allowed) {
    log({
      timestamp: Date.now(),
      event: 'generate_rate_limited',
      ip,
      status: 429,
      elapsed_ms: Date.now() - start,
      error_code: 'rate_limit_exceeded',
    });
    return generateError(429, 'rate_limit_exceeded', tokenState, model, env);
  }

  log({
    timestamp: Date.now(),
    event: 'generate_submitted',
    ip,
    status: 202,
    elapsed_ms: Date.now() - start,
  });

  // Story 7.1: resolve model→endpoint. If unresolvable (secret missing during
  // a partial rollback, or transitional deploy), return model_not_found instead
  // of a 502 upstream error — the model IS defined in SUPPORTED_MODELS but its
  // infra isn't provisioned, which is a client-visible config problem.
  const endpointId = resolveModelEndpoint(model, env);
  if (!endpointId) {
    return generateError(404, 'model_not_found', tokenState, model, env);
  }

  let upstream: Response;
  try {
    upstream = await forwardToTextEndpoint(body, env, endpointId, request.signal);
  } catch (err) {
    return handleGenerateUpstreamError(err, ip, start, tokenState, model, env);
  }

  if (body.stream !== false) {
    if (!upstream.body) {
      return generateError(502, 'upstream_error', tokenState, model, env);
    }
    recordAsync(ctx, env, approxTokens);

    // Story 1.1 FR-3: wrap upstream stream with envelope normalization
    const includeUsage = !!(body.stream_options && (body.stream_options as Record<string, unknown>).include_usage);
    const usageObj = includeUsage ? { total_tokens: approxTokens } : undefined;
    const enveloped = envelopeStream(upstream.body, completionId, created, model, includeUsage, usageObj);

    return new Response(enveloped, {
      status: upstream.status,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        ...tokenHeaders(tokenState, model),
        ...corsHeaders(env),
      },
    });
  }

  let payload: GenerateResponse;
  try {
    payload = (await upstream.json()) as GenerateResponse;
  } catch {
    return generateError(502, 'upstream_error', tokenState, model, env);
  }

  // Story 1.1 FR-3: inject id and created into non-streaming response
  payload.id = completionId;
  payload.created = created;

  const actualTokens = payload.usage?.total_tokens ?? approxTokens;
  recordAsync(ctx, env, actualTokens);

  log({
    timestamp: Date.now(),
    event: 'generate_completed',
    ip,
    status: 200,
    elapsed_ms: Date.now() - start,
  });

  return json(200, payload, {
    ...tokenHeaders(tokenState, model),
    ...corsHeaders(env),
  });
}

export function handleCorsPreflight(env: Env): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(env),
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
      'Access-Control-Max-Age': '86400',
    },
  });
}

function authCompatibleRequest(request: Request): Request {
  if (request.headers.has('X-API-Key')) {
    return request;
  }
  const authorization = request.headers.get('Authorization');
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) {
    return request;
  }
  const headers = new Headers(request.headers);
  headers.set('X-API-Key', match[1]);
  return new Request(request.url, { method: request.method, headers });
}

function normalizeGenerateRequest(value: unknown): { value: GenerateRequest } | { error: string } {
  if (!isRecord(value)) {
    return { error: 'invalid_request' };
  }

  // Story 1.2 FR-5: n > 1 is explicitly rejected
  if (value.n !== undefined) {
    const n = value.n;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) {
      return { error: 'invalid_request' };
    }
    if (n > 1) {
      return { error: 'n_gt_1_not_supported' };
    }
  }

  const messages = value.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return { error: 'missing_messages' };
  }

  const normalizedMessages: GenerateMessage[] = [];
  for (const message of messages) {
    if (!isRecord(message)) {
      return { error: 'invalid_request' };
    }
    if (message.role !== 'system' && message.role !== 'user' && message.role !== 'assistant') {
      return { error: 'invalid_request' };
    }
    if (typeof message.content !== 'string' || message.content.length === 0) {
      return { error: 'invalid_request' };
    }
    normalizedMessages.push({ role: message.role, content: message.content });
  }

  // Story 1.2 FR-5: max_completion_tokens takes precedence over max_tokens
  const maxTokens = normalizeMaxTokens(value);

  // Story 1.2 FR-5: temperature, top_p — validate if present, pass through
  const temperature = value.temperature;
  if (temperature !== undefined && (!isNumber(temperature) || temperature < 0 || temperature > 2)) {
    return { error: 'invalid_request' };
  }

  const topP = value.top_p;
  if (topP !== undefined && (!isNumber(topP) || topP < 0 || topP > 1)) {
    return { error: 'invalid_request' };
  }

  const stream = value.stream ?? true;
  if (typeof stream !== 'boolean') {
    return { error: 'invalid_request' };
  }

  // Story 1.2 FR-5 + Story 7.1: validate model against catalog (multi-model support).
  const model = typeof value.model === 'string' && value.model.length > 0
    ? value.model
    : DEFAULT_TEXT_MODEL;

  if (!(SUPPORTED_MODELS as readonly string[]).includes(model)) {
    return { error: 'model_not_found' };
  }

  // Story 1.2 FR-8: accept stream_options
  const streamOptions = value.stream_options;
  if (streamOptions !== undefined && !isRecord(streamOptions)) {
    return { error: 'invalid_request' };
  }

  // Story 1.2 FR-5: stop — pass through if present and valid
  const stop = normalizeStop(value);

  return {
    value: {
      model,
      messages: normalizedMessages,
      max_tokens: maxTokens,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(topP !== undefined ? { top_p: topP } : {}),
      ...(stop !== undefined ? { stop } : {}),
      ...(streamOptions !== undefined ? { stream_options: streamOptions } : {}),
      stream,
    },
  };
}

/** Story 1.2 FR-5: max_completion_tokens takes precedence over max_tokens. */
function normalizeMaxTokens(value: Record<string, unknown>): number {
  const maxCompletionTokens = value.max_completion_tokens;
  const maxTokens = value.max_tokens;

  // max_completion_tokens has precedence
  const effective = maxCompletionTokens !== undefined ? maxCompletionTokens : maxTokens;

  if (effective === undefined) return DEFAULT_MAX_TOKENS;

  if (typeof effective !== 'number' || !Number.isInteger(effective) || effective < 1 || effective > MAX_ALPHA_TOKENS) {
    return DEFAULT_MAX_TOKENS; // Story 1.2 FR-5: silently clamp invalid values
  }

  return effective;
}

/** Story 1.2 FR-5: validate stop parameter — string or string[] only. */
function normalizeStop(value: Record<string, unknown>): string | string[] | undefined {
  const stop = value.stop;
  if (stop === undefined || stop === null) return undefined;
  if (typeof stop === 'string') return stop;
  if (Array.isArray(stop) && stop.every((s): s is string => typeof s === 'string')) return stop;
  return undefined; // silently ignore invalid stop values
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function estimateMaxPossibleTokens(rawBody: string, maxTokens: number): number {
  return Math.ceil(rawBody.length / 4) + maxTokens;
}

function handleGenerateUpstreamError(
  err: unknown,
  ip: string | null,
  start: number,
  tokenState: TokenBudgetState,
  model: string,
  env: Env,
): Response {
  let status = 503;
  let error = 'upstream_unavailable';

  if (err instanceof TextUpstreamError) {
    if (err.kind === 'http_5xx') {
      status = 502;
      error = 'upstream_error';
    } else if (err.kind === 'http_4xx') {
      status = 502;
      error = 'upstream_error';
    }
  }

  log({
    timestamp: Date.now(),
    event: 'generate_upstream_error',
    ip,
    status,
    elapsed_ms: Date.now() - start,
    error_code: error,
  });

  return generateError(status, error, tokenState, model, env);
}

function logGenerateInvalid(ip: string | null, start: number, errorCode: string): void {
  log({
    timestamp: Date.now(),
    event: 'generate_invalid_input',
    ip,
    status: 400,
    elapsed_ms: Date.now() - start,
    error_code: errorCode,
  });
}

function recordAsync(ctx: WaitUntilContext | undefined, env: Env, tokens: number): void {
  const work = recordTokenUsage(env.RATE_LIMIT_KV, tokens);
  if (ctx) {
    ctx.waitUntil(work);
    return;
  }
  // Fallback for test harness or unusual runtimes lacking ExecutionContext.
  // Production CF Worker fetch handler always supplies ctx, so this path
  // should never run live — log if it ever does so the failure isn't silent.
  work.catch(() => {
    log({
      timestamp: Date.now(),
      event: 'generate_token_record_error',
      ip: null,
      status: 500,
      elapsed_ms: 0,
      error_code: 'token_record_async_failed',
    });
  });
}

function generateError(
  status: number,
  error: string,
  tokenState: TokenBudgetState,
  model: string,
  env: Env,
): Response {
  // Story 1.2 FR-6: use OpenAI error envelope
  return openaiErrorResponse(error, {
    ...tokenHeaders(tokenState, model),
    ...corsHeaders(env),
  });
}

function withGenerateHeaders(response: Response, tokenState: TokenBudgetState, model: string, env: Env): Response {
  // Story 1.2 FR-6: auth errors from validateAuth use old format — wrap in OpenAI envelope
  const headers = new Headers();
  for (const [key, value] of Object.entries(tokenHeaders(tokenState, model))) {
    headers.set(key, value);
  }
  for (const [key, value] of Object.entries(corsHeaders(env))) {
    headers.set(key, value);
  }
  // Map old auth error to OpenAI envelope
  const body: OpenAIErrorBody = {
    error: {
      message: 'Invalid API key.',
      type: 'authentication_error',
      code: 'invalid_api_key',
    },
  };
  return new Response(JSON.stringify(body), {
    status: 401,
    headers: { 'Content-Type': 'application/json', ...Object.fromEntries(headers) },
  });
}

function tokenHeaders(state: TokenBudgetState, model: string): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(TOKEN_DAILY_LIMIT),
    'X-RateLimit-Remaining': String(state.remaining),
    'X-RateLimit-Reset': state.resetAt,
    'X-Gateway-Model': model,
  };
}

function corsHeaders(env: Env): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': env.CORS_ALLOWED_ORIGIN || 'https://gemma4.dev',
  };
}

function defaultTokenState(): TokenBudgetState {
  return {
    used: 0,
    remaining: TOKEN_DAILY_LIMIT,
    resetAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    secondsUntilReset: 24 * 60 * 60,
  };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return Response.json(body, {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

export const generateInternals = {
  DEFAULT_TEXT_MODEL,
  SUPPORTED_MODELS,
  estimateMaxPossibleTokens,
  normalizeGenerateRequest,
  resolveModelEndpoint,
};
