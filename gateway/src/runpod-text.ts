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
 * `tool_calls` for Qwen3-Coder.
 *
 * Story 7.1.4 — Requests `stream: true` from Ollama and translates the NDJSON
 * stream to OpenAI-shaped SSE chunks in real time. Prior "fake streaming"
 * (buffered + 2 SSE chunks) crashed GitHubCopilotChat/0.58.0 even when the
 * delta shape matched gemma4's exactly. Gemma4:e4b works because Ollama's own
 * OpenAI-compat proxy emits per-token chunks; we now match that behaviour
 * end-to-end through the translation layer.
 *
 * When the client requested `stream: false`, we still stream from Ollama but
 * buffer the accumulated content on our side and return a single JSON
 * completion (spec-compliant behaviour).
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
    // Story 7.1.8 — Copilot Chat sends conversation history that includes
    // assistant messages with `tool_calls[].function.arguments` as a JSON
    // STRING (OpenAI spec). Ollama's chat template for Qwen3-Coder expects
    // that same field as an OBJECT and returns 400 "Value looks like object,
    // but can't find closing '}' symbol" when handed a string. Convert on the
    // way out. Also normalize role:"tool" messages, which some upstream Ollama
    // builds accept as-is but others prefer with the tool name/id merged in.
    messages: normalizeMessagesForOllama(body.messages as unknown[]),
    stream: true,
  };
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
  if (!response.body) {
    throw new TextUpstreamError('ollama returned no body', 'http_5xx');
  }

  const modelId = body.model ?? 'qwen3-coder:30b';
  const clientWantsStream = body.stream !== false;

  if (clientWantsStream) {
    const sseBody = translateOllamaStreamToOpenAISSE(response.body, modelId);
    return new Response(sseBody, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }

  // Client asked for JSON — buffer the Ollama stream, aggregate into a single
  // completion, return as JSON. Preserves the non-streaming API contract for
  // callers that don't set stream:true.
  const buffered = await bufferOllamaStream(response.body, modelId);
  return new Response(JSON.stringify(buffered), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Reads Ollama's NDJSON stream, accumulates content and (any) tool_calls, and
 * returns a single OpenAIChatCompletion shaped like the non-streaming response
 * we used to build via `translateOllamaToOpenAI`.
 */
async function bufferOllamaStream(
  body: ReadableStream<Uint8Array>,
  modelId: string,
): Promise<OpenAIChatCompletion> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = '';
  let accumulatedContent = '';
  let toolCalls: OllamaToolCall[] | undefined;
  let doneReason: string | undefined;
  let promptTokens = 0;
  let completionTokens = 0;
  let createdIso: string | undefined;
  let observedModel: string | undefined;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let chunk: OllamaChatResponse;
        try {
          chunk = JSON.parse(trimmed) as OllamaChatResponse;
        } catch {
          continue;
        }
        observedModel ??= chunk.model;
        createdIso ??= chunk.created_at;
        if (typeof chunk.message?.content === 'string' && chunk.message.content.length > 0) {
          accumulatedContent += chunk.message.content;
        }
        if (chunk.done === true) {
          if (Array.isArray(chunk.message?.tool_calls) && chunk.message.tool_calls.length > 0) {
            toolCalls = chunk.message.tool_calls;
          }
          if (typeof chunk.done_reason === 'string') doneReason = chunk.done_reason;
          if (typeof chunk.prompt_eval_count === 'number') promptTokens = chunk.prompt_eval_count;
          if (typeof chunk.eval_count === 'number') completionTokens = chunk.eval_count;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  const aggregated: OllamaChatResponse = {
    model: observedModel ?? modelId,
    created_at: createdIso ?? new Date().toISOString(),
    message: {
      role: 'assistant',
      content: accumulatedContent,
      ...(toolCalls ? { tool_calls: toolCalls } : {}),
    },
    done: true,
    ...(doneReason ? { done_reason: doneReason } : {}),
    prompt_eval_count: promptTokens,
    eval_count: completionTokens,
  };
  return translateOllamaToOpenAI(aggregated, modelId);
}

/**
 * Translates Ollama's NDJSON `/api/chat` stream into an OpenAI-shaped SSE
 * ReadableStream. One SSE chunk per Ollama NDJSON line for content, plus
 * dedicated chunks for tool_calls (arrive on the `done:true` line for Qwen)
 * and the terminal `finish_reason`. Matches the per-token cadence emitted by
 * Ollama's OpenAI-compat proxy for gemma4:e4b — the shape GitHubCopilotChat
 * consumes successfully end-to-end.
 */
function translateOllamaStreamToOpenAISSE(
  ollamaBody: ReadableStream<Uint8Array>,
  modelId: string,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const id = `chatcmpl-${randomId()}`;
  const created = Math.floor(Date.now() / 1000);

  const base = {
    id,
    object: 'chat.completion.chunk' as const,
    created,
    model: modelId,
    system_fingerprint: 'fp_ollama',
  };

  const contentChunk = (content: string) => ({
    ...base,
    choices: [{
      index: 0,
      delta: { role: 'assistant', content },
      finish_reason: null,
    }],
  });
  const toolCallsChunk = (tcs: OllamaToolCall[]) => ({
    ...base,
    choices: [{
      index: 0,
      delta: {
        role: 'assistant',
        content: '',
        tool_calls: tcs.map((tc, i) => ({
          index: i,
          id: tc.id && tc.id.length > 0 ? tc.id : `call_${i}_${randomId()}`,
          type: 'function' as const,
          function: {
            name: tc.function.name,
            arguments:
              typeof tc.function.arguments === 'string'
                ? tc.function.arguments
                : JSON.stringify(tc.function.arguments),
          },
        })),
      },
      finish_reason: null,
    }],
  });
  const finishChunk = (reason: string) => ({
    ...base,
    choices: [{
      index: 0,
      delta: { role: 'assistant', content: '' },
      finish_reason: reason,
    }],
  });

  // Story 7.1.5 — Usage chunk emitted here (with system_fingerprint) so
  // envelopeStream in generate.ts detects `chunk.usage` and marks its own
  // synthesized frame as suppressed. Prior missing-system_fingerprint on the
  // usage frame broke GitHubCopilotChat/0.58.0 parser (every other chunk had
  // it; the usage frame did not, and the parser dereferenced it on the missing
  // field). Real values come from Ollama's final done:true chunk.
  const usageChunk = (prompt: number, completion: number) => ({
    ...base,
    choices: [],
    usage: {
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: prompt + completion,
    },
  });

  // Story 7.1.9 — Inactivity timeout guardrail. If Ollama stops emitting chunks
  // for >90s we assume the upstream is dead and gracefully terminate the SSE
  // stream (finish + usage + [DONE]) so the client (Copilot Chat) doesn't
  // spin forever waiting for a next chunk that never arrives. 90s is well
  // above normal per-chunk latency (typical 0-50ms, worst case a few seconds
  // during model reload) so this triggers only on genuine upstream failure.
  const INACTIVITY_TIMEOUT_MS = 90_000;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = ollamaBody.getReader();
      let buffer = '';
      let sawAnyContent = false;
      let sawToolCalls = false;
      try {
        while (true) {
          // Race the next chunk against an inactivity deadline. If the deadline
          // fires first, break out and emit a defensive finish.
          const timeoutMarker = Symbol('inactivity_timeout');
          let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
          const timeoutPromise = new Promise<typeof timeoutMarker>((resolve) => {
            timeoutHandle = setTimeout(() => resolve(timeoutMarker), INACTIVITY_TIMEOUT_MS);
          });
          const readResult = await Promise.race([reader.read(), timeoutPromise]);
          if (timeoutHandle) clearTimeout(timeoutHandle);
          if (readResult === timeoutMarker) {
            // Upstream idle > INACTIVITY_TIMEOUT_MS — treat as done and stop
            // reading. `finally` below still releases the reader lock.
            break;
          }
          const { done, value } = readResult as ReadableStreamReadResult<Uint8Array>;
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            let chunk: OllamaChatResponse;
            try {
              chunk = JSON.parse(trimmed) as OllamaChatResponse;
            } catch {
              continue;
            }
            const msg = chunk.message;
            if (typeof msg?.content === 'string' && msg.content.length > 0) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(contentChunk(msg.content))}\n\n`));
              sawAnyContent = true;
            }
            // Story 7.1.6 — Ollama emits structured `tool_calls` in the same
            // chunk as content sometimes, and in intermediate (done:false)
            // chunks when the model decides to call a tool. Prior code only
            // checked on done:true, dropping every tool_call the model made
            // mid-stream — Copilot Chat saw text-only responses even when the
            // model wanted to invoke a tool. Track emissions so we don't repeat
            // (and so deriveFinishReason still fires on done:true).
            if (Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(toolCallsChunk(msg.tool_calls))}\n\n`));
              sawToolCalls = true;
            }
            if (chunk.done === true) {
              const finishReason = sawToolCalls
                ? 'tool_calls'
                : (chunk.done_reason && chunk.done_reason.length > 0 ? chunk.done_reason : 'stop');
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(finishChunk(finishReason))}\n\n`));
              // Story 7.1.5 — Always emit usage chunk WITH system_fingerprint.
              // envelopeStream detects `chunk.usage` and skips its own frame
              // (which would otherwise ship without system_fingerprint).
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(usageChunk(
                chunk.prompt_eval_count ?? 0,
                chunk.eval_count ?? 0,
              ))}\n\n`));
              controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
              controller.close();
              return;
            }
          }
        }
        if (!sawAnyContent) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(contentChunk(''))}\n\n`));
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(finishChunk('stop'))}\n\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(usageChunk(0, 0))}\n\n`));
        controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
        controller.close();
      } catch (err) {
        controller.error(err);
      } finally {
        reader.releaseLock();
      }
    },
  });
}

/**
 * Story 7.1.8 — Rewrite outbound messages so Ollama's chat template accepts
 * them cleanly. Two cases matter:
 *
 *   1. assistant messages with `tool_calls[].function.arguments` — OpenAI sends
 *      arguments as a JSON string; Ollama expects an object. Parse-if-string.
 *   2. role:"tool" messages — Ollama accepts these but the content must be a
 *      string. Copilot already sends strings, so this is a pass-through with
 *      the shape asserted defensively.
 *
 * Any message that doesn't match either shape passes through unchanged.
 */
function normalizeMessagesForOllama(messages: unknown[]): unknown[] {
  return messages.map((msg) => {
    if (!msg || typeof msg !== 'object') return msg;
    const m = msg as Record<string, unknown>;
    const rewritten: Record<string, unknown> = { ...m };
    // Case 1 — assistant with tool_calls.
    if (Array.isArray(m.tool_calls)) {
      rewritten.tool_calls = m.tool_calls.map((tc) => {
        if (!tc || typeof tc !== 'object') return tc;
        const t = tc as Record<string, unknown>;
        const fn = t.function as Record<string, unknown> | undefined;
        if (!fn) return tc;
        let args = fn.arguments;
        if (typeof args === 'string') {
          try {
            args = JSON.parse(args);
          } catch {
            // Leave malformed strings alone — Ollama will surface its own error.
          }
        }
        return {
          ...t,
          function: { ...fn, arguments: args },
        };
      });
    }
    return rewritten;
  });
}

function deriveFinishReason(
  toolCalls: OllamaToolCall[] | undefined,
  doneReason: string | undefined,
): string {
  if (Array.isArray(toolCalls) && toolCalls.length > 0) return 'tool_calls';
  if (doneReason && doneReason.length > 0) return doneReason;
  return 'stop';
}

interface OpenAIChatCompletion {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  // Story 7.1 — VS Code Copilot BYOK client crashes on missing `system_fingerprint`
  // in the parsed chunks (Ollama's own OpenAI-compat layer includes it; the
  // gemma4:e4b path inherits it end-to-end). Emit a stable placeholder here
  // so the translated Qwen path matches the shape.
  system_fingerprint: string;
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
    system_fingerprint: 'fp_ollama',
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
 *
 * Story 7.1.3 — Matches the exact chunk shape that Ollama's OpenAI-compat
 * proxy emits for gemma4:e4b (which we know works end-to-end with
 * GitHubCopilotChat/0.58.0). Prior attempts (2-chunk merged, then 3-chunk
 * split) both crashed the Copilot Chat parser with
 * `Cannot read properties of undefined (reading 'headerRequestId')` because
 * their `delta` shape omitted fields the parser dereferences unconditionally.
 *
 * Observed working shape (captured via curl on gemma4:e4b path):
 *   data: {"choices":[{"delta":{"content":"Hello","role":"assistant"},"finish_reason":null,"index":0}], ...}
 *   ... one chunk per token, ALL with both `role` AND `content` (string) ...
 *   data: {"choices":[{"delta":{"content":"","role":"assistant"},"finish_reason":"stop","index":0}], ...}
 *   data: [DONE]
 *
 * Key invariants Copilot Chat requires:
 *   - EVERY delta carries both `role: "assistant"` AND `content: "..."` (string, may be empty)
 *   - Finish chunk uses `content: ""` (empty string), NOT an empty delta
 *   - For tool_calls, add `tool_calls: [...]` alongside role+content (content="" here)
 *
 * We still fake-stream (one payload chunk, then finish) because Ollama's
 * native /api/chat is buffered. Real per-token streaming would require moving
 * to Ollama /api/chat with `stream: true` + NDJSON parsing — deferred.
 */
function buildOpenAISSEStream(resp: OpenAIChatCompletion): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const choice = resp.choices[0];
  if (!choice) {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
        controller.close();
      },
    });
  }

  const baseChunk = {
    id: resp.id,
    object: 'chat.completion.chunk' as const,
    created: resp.created,
    model: resp.model,
    system_fingerprint: resp.system_fingerprint,
  };

  // Payload chunk — always carries role + content (string). Add tool_calls
  // alongside when present. Content stays as an empty string in the tool_calls
  // case so the delta shape stays uniform across chunks.
  const contentString = choice.message.content ?? '';
  const payloadDelta: Record<string, unknown> = {
    role: choice.message.role,
    content: contentString,
  };
  if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
    payloadDelta.tool_calls = choice.message.tool_calls.map((tc, i) => ({
      index: i,
      id: tc.id,
      type: tc.type,
      function: tc.function,
    }));
  }
  const payloadChunk = {
    ...baseChunk,
    choices: [{ index: choice.index, delta: payloadDelta, finish_reason: null }],
  };

  // Finish chunk — role + empty content string (mirrors the working gemma4
  // shape). NOT an empty delta.
  const finishChunk = {
    ...baseChunk,
    choices: [{
      index: choice.index,
      delta: { role: choice.message.role, content: '' },
      finish_reason: choice.finish_reason,
    }],
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(payloadChunk)}\n\n`));
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(finishChunk)}\n\n`));
      controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
      controller.close();
    },
  });
}
