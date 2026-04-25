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

export async function forwardToTextEndpoint(
  body: GenerateRequest,
  env: Env,
  signal?: AbortSignal,
): Promise<Response> {
  if (!env.RUNPOD_TEXT_ENDPOINT_ID) {
    throw new TextUpstreamError('text endpoint id missing', 'network');
  }
  if (!env.RUNPOD_API_KEY) {
    throw new TextUpstreamError('text API key missing', 'network');
  }

  const url = `https://api.runpod.ai/v2/${env.RUNPOD_TEXT_ENDPOINT_ID}/openai/v1/chat/completions`;
  const init: RequestInit = {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RUNPOD_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  };
  if (signal) {
    init.signal = signal;
  }

  let response: Response;
  try {
    response = await fetch(url, init);
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
