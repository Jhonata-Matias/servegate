/**
 * @jhonata-matias/flux-client
 *
 * TypeScript SDK for the servegate FLUX image-generation gateway (formerly gemma4).
 * Encapsulates async submit/poll handling for the servegate gateway and exposes
 * typed errors for differentiated UX flows.
 *
 * @example
 * ```ts
 * import { FluxClient, TimeoutError, RateLimitError } from '@jhonata-matias/flux-client';
 *
 * const client = new FluxClient({
 *   apiKey: process.env.GATEWAY_API_KEY!,
 *   gatewayUrl: 'https://gemma4-gateway.jhonata-matias.workers.dev',
 * });
 *
 * await client.warmup(); // submits a minimal async job to pre-warm the stack
 *
 * try {
 *   const result = await client.generate({
 *     prompt: 'a cat on a sofa',
 *     steps: 4,
 *     width: 1024,
 *     height: 1024,
 *   });
 *   console.log(result.output.image_b64);
 * } catch (e) {
 *   if (e instanceof TimeoutError) console.error(`Generation timed out (${e.cause})`);
 *   else if (e instanceof RateLimitError) console.error(`Retry in ${e.retry_after_seconds}s`);
 *   else throw e;
 * }
 * ```
 */

export { FluxClient } from './client.js';
export {
  AuthError,
  NetworkError,
  RateLimitError,
  type TimeoutCause,
  TimeoutError,
  ValidationError,
} from './errors.js';
export {
  DEFAULT_POLL_TIMEOUT_MS,
  DEFAULT_RETRY_CONFIG,
  DEFAULT_WARM_THRESHOLD_MS,
} from './types.js';
export type {
  ClientConstructorArgs,
  ClientOptions,
  GenerateInput,
  GenerateMetadata,
  GenerateOutput,
  PollPendingResponse,
  RetryConfig,
  SubmitJobResponse,
  WarmupResult,
} from './types.js';
