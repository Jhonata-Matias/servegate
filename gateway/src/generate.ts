import { validateAuth } from './auth.js';
import { getClientIp, log } from './log.js';
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

type WaitUntilContext = Pick<ExecutionContext, 'waitUntil'>;

export async function handleGenerate(
  request: Request,
  env: Env,
  ctx?: WaitUntilContext,
): Promise<Response> {
  const start = Date.now();
  const ip = getClientIp(request);

  const authFailure = validateAuth(authCompatibleRequest(request), env.GATEWAY_API_KEY);
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
    return generateError(429, 'rate_limit_exceeded', tokenState, body.model ?? DEFAULT_TEXT_MODEL, env);
  }

  log({
    timestamp: Date.now(),
    event: 'generate_submitted',
    ip,
    status: 202,
    elapsed_ms: Date.now() - start,
  });

  let upstream: Response;
  try {
    upstream = await forwardToTextEndpoint(body, env, request.signal);
  } catch (err) {
    return handleGenerateUpstreamError(err, ip, start, tokenState, body.model ?? DEFAULT_TEXT_MODEL, env);
  }

  if (body.stream !== false) {
    if (!upstream.body) {
      return generateError(502, 'upstream_error', tokenState, body.model ?? DEFAULT_TEXT_MODEL, env);
    }
    recordAsync(ctx, env, approxTokens);
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        ...tokenHeaders(tokenState, body.model ?? DEFAULT_TEXT_MODEL),
        ...corsHeaders(env),
      },
    });
  }

  let payload: GenerateResponse;
  try {
    payload = (await upstream.json()) as GenerateResponse;
  } catch {
    return generateError(502, 'upstream_error', tokenState, body.model ?? DEFAULT_TEXT_MODEL, env);
  }

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
    ...tokenHeaders(tokenState, body.model ?? DEFAULT_TEXT_MODEL),
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

  const maxTokens = value.max_tokens === undefined ? DEFAULT_MAX_TOKENS : value.max_tokens;
  if (typeof maxTokens !== 'number') {
    return { error: 'invalid_request' };
  }
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > MAX_ALPHA_TOKENS) {
    return { error: 'invalid_request' };
  }

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

  const model = typeof value.model === 'string' && value.model.length > 0
    ? value.model
    : DEFAULT_TEXT_MODEL;

  return {
    value: {
      model,
      messages: normalizedMessages,
      max_tokens: maxTokens,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(topP !== undefined ? { top_p: topP } : {}),
      stream,
    },
  };
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
      event: 'generate_upstream_error',
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
  return json(status, { error }, {
    ...tokenHeaders(tokenState, model),
    ...corsHeaders(env),
  });
}

function withGenerateHeaders(response: Response, tokenState: TokenBudgetState, model: string, env: Env): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(tokenHeaders(tokenState, model))) {
    headers.set(key, value);
  }
  for (const [key, value] of Object.entries(corsHeaders(env))) {
    headers.set(key, value);
  }
  return new Response(response.body, { status: response.status, headers });
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
  estimateMaxPossibleTokens,
  normalizeGenerateRequest,
};
