import type { Env, GenerateRequest } from './types.js';

export class TextUpstreamError extends Error {
  constructor(
    message: string,
    readonly kind: 'network' | 'http_4xx' | 'http_5xx',
    readonly upstreamStatus?: number,
  ) {
    super(message);
    this.name = 'TextUpstreamError';
  }
}

/**
 * Story 7.1 — Upstream target for a text-gen model. Two flavors:
 *
 * - Serverless (RunPod /v2/{id}/openai/v1/chat/completions with Bearer auth)
 * - POD (Ollama proxy URL; anonymous auth via URL secrecy)
 *
 * Caller (`resolveModelUpstream` in generate.ts) picks per model.
 */
export interface UpstreamTarget {
  url: string;
  requiresRunpodAuth: boolean;
}

/**
 * Forwards a chat completion request to the chosen upstream. Story 7.1 changed
 * the signature: previously took an endpointId (serverless-only) and built the
 * URL here. Now takes a fully-resolved target so it can transparently proxy
 * either serverless (Bearer-auth) or POD (URL-only) upstreams.
 */
export async function forwardToTextEndpoint(
  body: GenerateRequest,
  env: Env,
  target: UpstreamTarget,
  signal?: AbortSignal,
): Promise<Response> {
  if (!target.url) {
    throw new TextUpstreamError('text endpoint url missing', 'network');
  }
  if (target.requiresRunpodAuth && !env.RUNPOD_API_KEY) {
    throw new TextUpstreamError('text API key missing', 'network');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (target.requiresRunpodAuth) {
    headers.Authorization = `Bearer ${env.RUNPOD_API_KEY}`;
  }

  const init: RequestInit = {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  };
  if (signal) {
    init.signal = signal;
  }

  let response: Response;
  try {
    response = await fetch(target.url, init);
  } catch (err) {
    if (signal?.aborted) {
      throw new TextUpstreamError('text generation aborted', 'network');
    }
    throw new TextUpstreamError('text endpoint unavailable', 'network');
  }

  if (response.status >= 500) {
    throw new TextUpstreamError('text endpoint returned 5xx', 'http_5xx', response.status);
  }

  if (response.status >= 400) {
    throw new TextUpstreamError('text endpoint returned 4xx', 'http_4xx', response.status);
  }

  return response;
}
