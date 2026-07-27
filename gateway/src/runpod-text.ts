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
 * - `openai` (RunPod Serverless `/v2/{id}/openai/v1/chat/completions` with Bearer
 *   auth). Same request+response shape as OpenAI; no translation needed.
 * - `ollama` (POD running Ollama; URL is the base host). Gateway posts to
 *   `${url}/api/chat` (Ollama-native format) because Ollama's OpenAI-compat
 *   layer fails to emit `tool_calls[]` for Qwen3-Coder — it returns the raw
 *   `<tool_call>` XML as text content. Gateway translates the Ollama response
 *   back into OpenAI shape so downstream clients (VS Code Copilot BYOK) get
 *   proper structured tool_calls.
 *
 * Caller (`resolveModelUpstream` in generate.ts) picks per model.
 */
export interface UpstreamTarget {
  url: string;
  requiresRunpodAuth: boolean;
  apiFormat: 'openai' | 'ollama';
}

/**
 * Forwards a chat completion to the chosen upstream, doing format translation
 * when needed. Returns a Response whose body already matches OpenAI shape
 * (SSE for streaming, JSON for non-streaming), so the caller in generate.ts
 * can treat both `openai` and `ollama` upstreams uniformly.
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

  if (target.apiFormat === 'ollama') {
    return forwardOllamaNative(body, target, signal);
  }
  return forwardOpenAIStandard(body, env, target, signal);
}

// ---------------------------------------------------------------------------
// Serverless — existing behavior (OpenAI-compat proxy).
// ---------------------------------------------------------------------------

async function forwardOpenAIStandard(
  body: GenerateRequest,
  env: Env,
  target: UpstreamTarget,
  signal?: AbortSignal,
): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (target.requiresRunpodAuth) {
    headers.Authorization = `Bearer ${env.RUNPOD_API_KEY}`;
  }

  const init: RequestInit = {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  };
  if (signal) init.signal = signal;

  let response: Response;
  try {
    response = await fetch(target.url, init);
  } catch {
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

// ---------------------------------------------------------------------------
// Ollama — native /api/chat + translation to OpenAI response shape.
// ---------------------------------------------------------------------------

interface OllamaChatRequest {
  model: string;
  messages: unknown[];
  tools?: unknown[];
  tool_choice?: unknown;
  stream: boolean;
  options?: Record<string, unknown>;
  keep_alive?: string;
}

interface OllamaToolCall {
  id?: string;
  function: {
    index?: number;
    name: string;
    // Ollama can emit arguments as either an object or a JSON string, depending
    // on the model's tool-call parser. We stringify below when re-emitting.
    arguments: Record<string, unknown> | string;
  };
}

interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content?: string;
    tool_calls?: OllamaToolCall[];
  };
  done: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

/**
 * Talks to Ollama's `/api/chat` (native format) which reliably emits structured
 * `tool_calls` for Qwen3-Coder. Always requests `stream: false` from Ollama —
 * gateway wraps the buffered response into either JSON or a single-chunk SSE
 * stream depending on the client's `body.stream` preference. "Fake streaming"
 * is acceptable for tool-calling loops because clients need the full tool_calls
 * array in one piece anyway before executing tools.
 */
async function forwardOllamaNative(
  body: GenerateRequest,
  target: UpstreamTarget,
  signal?: AbortSignal,
): Promise<Response> {
  const base = target.url.replace(/\/+$/, '').replace(/\/v1\/chat\/completions$/, '');
  const url = `${base}/api/chat`;

  const ollamaReq: OllamaChatRequest = {
    model: body.model ?? 'qwen3-coder:30b',
    messages: body.messages as unknown[],
    stream: false,
  };
  // Passthrough tools + tool_choice when present (unknown fields on GenerateRequest —
  // gateway does not strictly enforce them; Ollama consumes them natively).
  const rawBody = body as unknown as Record<string, unknown>;
  if (Array.isArray(rawBody.tools) && rawBody.tools.length > 0) {
    ollamaReq.tools = rawBody.tools as unknown[];
  }
  if (rawBody.tool_choice !== undefined) {
    ollamaReq.tool_choice = rawBody.tool_choice;
  }
  const options: Record<string, unknown> = {};
  if (body.max_tokens !== undefined) options.num_predict = body.max_tokens;
  if (body.temperature !== undefined) options.temperature = body.temperature;
  if (body.top_p !== undefined) options.top_p = body.top_p;
  if (body.stop !== undefined) options.stop = body.stop;
  if (Object.keys(options).length > 0) ollamaReq.options = options;

  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ollamaReq),
  };
  if (signal) init.signal = signal;

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
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

  let ollamaResp: OllamaChatResponse;
  try {
    ollamaResp = (await response.json()) as OllamaChatResponse;
  } catch {
    throw new TextUpstreamError('ollama returned invalid JSON', 'http_5xx');
  }

  const modelId = body.model ?? ollamaResp.model;
  const openAIResp = translateOllamaToOpenAI(ollamaResp, modelId);

  // Client asked for streaming? Wrap in single-chunk SSE.
  const clientWantsStream = body.stream !== false;
  if (clientWantsStream) {
    const sseBody = buildOpenAISSEStream(openAIResp);
    return new Response(sseBody, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }
  return new Response(JSON.stringify(openAIResp), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface OpenAIChatCompletion {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Converts Ollama's `/api/chat` response into an OpenAI ChatCompletion.
 * Key transforms:
 *   - Nest `message` inside `choices[0]` (Ollama returns it top-level).
 *   - Add `type: "function"` to every tool_call (OpenAI requires it).
 *   - Stringify tool_call `arguments` if Ollama returned an object.
 *   - Set `finish_reason: "tool_calls"` when tool_calls present.
 *   - Compute `usage` from Ollama's prompt_eval_count / eval_count.
 *   - Placeholder `id` and `created` — envelope in generate.ts overwrites both.
 */
export function translateOllamaToOpenAI(
  ollamaResp: OllamaChatResponse,
  modelId: string,
): OpenAIChatCompletion {
  const msg = ollamaResp.message;
  const message: OpenAIChatCompletion['choices'][number]['message'] = {
    role: msg.role,
    content: msg.content && msg.content.length > 0 ? msg.content : null,
  };

  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
    message.tool_calls = msg.tool_calls.map((tc, i) => ({
      id: tc.id && tc.id.length > 0 ? tc.id : `call_${i}_${randomId()}`,
      type: 'function' as const,
      function: {
        name: tc.function.name,
        arguments:
          typeof tc.function.arguments === 'string'
            ? tc.function.arguments
            : JSON.stringify(tc.function.arguments),
      },
    }));
  }

  const finish_reason = message.tool_calls
    ? 'tool_calls'
    : ollamaResp.done_reason && ollamaResp.done_reason.length > 0
      ? ollamaResp.done_reason
      : 'stop';

  const promptTokens = ollamaResp.prompt_eval_count ?? 0;
  const completionTokens = ollamaResp.eval_count ?? 0;

  return {
    id: `chatcmpl-${randomId()}`,
    object: 'chat.completion',
    created: parseCreatedAt(ollamaResp.created_at),
    model: modelId,
    choices: [{ index: 0, message, finish_reason }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

function parseCreatedAt(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : Math.floor(Date.now() / 1000);
}

function randomId(): string {
  // 8 hex chars — plenty of entropy for a request-scoped placeholder id.
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
}

/**
 * Emits an OpenAI-shaped SSE stream from a buffered non-streaming completion.
 * Two chunks — first carries the full content + tool_calls under `delta`, second
 * carries just `finish_reason`. Terminates with `data: [DONE]`. VS Code Copilot
 * BYOK accepts this shape (accumulates delta, finalizes on finish_reason).
 */
function buildOpenAISSEStream(resp: OpenAIChatCompletion): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const contentChunk = {
    id: resp.id,
    object: 'chat.completion.chunk',
    created: resp.created,
    model: resp.model,
    choices: resp.choices.map((c) => ({
      index: c.index,
      delta: {
        role: c.message.role,
        ...(c.message.content !== null ? { content: c.message.content } : {}),
        ...(c.message.tool_calls
          ? {
              tool_calls: c.message.tool_calls.map((tc, i) => ({
                index: i,
                id: tc.id,
                type: tc.type,
                function: tc.function,
              })),
            }
          : {}),
      },
      finish_reason: null,
    })),
  };
  const finishChunk = {
    id: resp.id,
    object: 'chat.completion.chunk',
    created: resp.created,
    model: resp.model,
    choices: resp.choices.map((c) => ({
      index: c.index,
      delta: {},
      finish_reason: c.finish_reason,
    })),
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(contentChunk)}\n\n`));
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(finishChunk)}\n\n`));
      controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
      controller.close();
    },
  });
}
