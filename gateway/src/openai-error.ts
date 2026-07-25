/**
 * OpenAI-compatible error envelope (Story 1.2 FR-6).
 *
 * All /v1/* routes MUST use this format for error responses.
 * The existing /jobs/* routes are NOT affected.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OpenAIErrorBody {
  error: {
    message: string;
    type: OpenAIErrorType;
    code: string;
  };
}

export type OpenAIErrorType =
  | 'invalid_request_error'
  | 'authentication_error'
  | 'rate_limit_error'
  | 'api_error';

// ---------------------------------------------------------------------------
// Error code → HTTP status + type mapping
// ---------------------------------------------------------------------------

interface ErrorMapping {
  status: number;
  type: OpenAIErrorType;
  message: string;
}

const ERROR_MAP: Record<string, ErrorMapping> = {
  missing_messages: {
    status: 400,
    type: 'invalid_request_error',
    message: 'Missing or empty messages array.',
  },
  invalid_request: {
    status: 400,
    type: 'invalid_request_error',
    message: 'Invalid request body.',
  },
  invalid_json: {
    status: 400,
    type: 'invalid_request_error',
    message: 'Invalid JSON in request body.',
  },
  model_not_found: {
    status: 404,
    type: 'invalid_request_error',
    message: 'The requested model is not available.',
  },
  n_gt_1_not_supported: {
    status: 400,
    type: 'invalid_request_error',
    message: 'n > 1 is not supported.',
  },
  invalid_api_key: {
    status: 401,
    type: 'authentication_error',
    message: 'Invalid API key.',
  },
  request_too_large: {
    status: 413,
    type: 'invalid_request_error',
    message: 'Request body too large.',
  },
  rate_limit_exceeded: {
    status: 429,
    type: 'rate_limit_error',
    message: 'Rate limit exceeded. Try again later.',
  },
  upstream_error: {
    status: 502,
    type: 'api_error',
    message: 'Upstream service returned an error.',
  },
  upstream_unavailable: {
    status: 503,
    type: 'api_error',
    message: 'Upstream service is temporarily unavailable.',
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates an OpenAI-formatted error Response.
 *
 * @param code - Error code (e.g., 'missing_messages', 'invalid_api_key')
 * @param extraHeaders - Additional headers to include (e.g., rate-limit headers)
 */
export function openaiErrorResponse(
  code: string,
  extraHeaders: Record<string, string> = {},
): Response {
  const mapping = ERROR_MAP[code];
  if (!mapping) {
    // Fallback for unknown error codes
    return Response.json(
      {
        error: {
          message: 'An unexpected error occurred.',
          type: 'api_error' as OpenAIErrorType,
          code,
        },
      },
      { status: 500, headers: { 'Content-Type': 'application/json', ...extraHeaders } },
    );
  }

  const body: OpenAIErrorBody = {
    error: {
      message: mapping.message,
      type: mapping.type,
      code,
    },
  };

  return Response.json(body, {
    status: mapping.status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

/**
 * Creates an OpenAI-formatted error SSE frame for mid-stream errors.
 * Always followed by `data: [DONE]\n\n`.
 *
 * @param code - Error code
 * @returns SSE-formatted string: `data: {error}\n\ndata: [DONE]\n\n`
 */
export function openaiStreamErrorFrame(code: string): string {
  const mapping = ERROR_MAP[code];
  const body: OpenAIErrorBody = {
    error: {
      message: mapping?.message ?? 'An unexpected error occurred.',
      type: mapping?.type ?? 'api_error',
      code,
    },
  };
  return `data: ${JSON.stringify(body)}\n\ndata: [DONE]\n\n`;
}

/**
 * Returns the HTTP status for a given error code.
 */
export function openaiErrorStatus(code: string): number {
  return ERROR_MAP[code]?.status ?? 500;
}