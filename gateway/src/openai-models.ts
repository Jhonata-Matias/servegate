/**
 * OpenAI-compatible /v1/models endpoint (Story 1.1 FR-2).
 *
 * Exposes the text model catalog in the format expected by IDE clients
 * (Copilot BYOK, Continue, Cline). The model list is static — only
 * gemma4:e4b is served as a chat model.
 *
 * DP-1: Structure is array-ready for future multi-model support.
 */

import { collectApiKeys, dualAuthResponse, validateAuthDual } from './auth.js';
import { openaiErrorResponse } from './openai-error.js';
import type { Env } from './types.js';

// ---------------------------------------------------------------------------
// Model catalog
// ---------------------------------------------------------------------------

interface OpenAIModel {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
}

interface ModelsListResponse {
  object: 'list';
  data: OpenAIModel[];
}

const MODEL_CATALOG: OpenAIModel[] = [
  {
    id: 'gemma4:e4b',
    object: 'model',
    created: 1700000000,
    owned_by: 'servegate',
  },
  // Story 7.1 — Qwen3-Coder-30B agentic coding endpoint.
  // Visible in /v1/models regardless of whether RUNPOD_CODER_ENDPOINT_ID is set;
  // generate.ts::resolveModelEndpoint() converts an unset secret into a
  // client-visible 404 model_not_found at the actual completion request.
  {
    id: 'qwen3-coder:30b',
    object: 'model',
    created: 1784937600, // 2026-07-25 (deploy target date)
    owned_by: 'servegate',
  },
];

const MODELS_RESPONSE: ModelsListResponse = {
  object: 'list',
  data: MODEL_CATALOG,
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Handles GET /v1/models and GET /v1/models/{id}.
 *
 * - GET /v1/models → 200 with full model list
 * - GET /v1/models/{id} → 200 with single model, or 404
 * - Requires authentication (dual auth: Bearer or X-API-Key)
 * - Does NOT consume quota (FR-2)
 */
export async function handleModels(
  request: Request,
  env: Env,
  modelId?: string,
): Promise<Response> {
  // Auth check (FR-2: requires authentication)
  const keys = collectApiKeys(env);
  const authResult = validateAuthDual(request, keys);
  if (!authResult.ok) {
    return dualAuthResponse(authResult);
  }

  // GET /v1/models/{id}
  if (modelId !== undefined) {
    const model = MODEL_CATALOG.find((m) => m.id === modelId);
    if (!model) {
      return openaiErrorResponse('model_not_found');
    }
    return new Response(JSON.stringify(model), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60',
      },
    });
  }

  // GET /v1/models
  return new Response(JSON.stringify(MODELS_RESPONSE), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60',
    },
  });
}