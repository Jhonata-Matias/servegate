/**
 * Auth middleware — validates X-API-Key header against GATEWAY_API_KEY secret.
 * Uses constant-time comparison to mitigate timing attacks.
 */

/**
 * Constant-time string comparison.
 * Returns true if both strings are equal AND of equal length.
 * Implementation: XOR each char-code, accumulate; result is 0 iff identical.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still execute a dummy comparison loop to avoid length-leak via timing,
    // but result is guaranteed false.
    let dummy = 0;
    for (let i = 0; i < a.length; i++) {
      dummy |= a.charCodeAt(i) ^ a.charCodeAt(i);
    }
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Validates the request's X-API-Key header against the configured secret.
 * Returns null on success, or a 401 Response on failure.
 */
export function validateAuth(request: Request, expectedKey: string): Response | null {
  const provided = request.headers.get('X-API-Key');
  if (!provided) {
    return Response.json(
      { error: 'invalid_api_key', reason: 'missing_header' },
      { status: 401 },
    );
  }
  if (!constantTimeEqual(provided, expectedKey)) {
    return Response.json(
      { error: 'invalid_api_key', reason: 'mismatch' },
      { status: 401 },
    );
  }
  return null;
}
