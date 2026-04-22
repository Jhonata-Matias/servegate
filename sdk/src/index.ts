/**
 * @jhonata-matias/flux-client
 *
 * TypeScript SDK for the servegate FLUX image-generation gateway (formerly gemma4).
 * Encapsulates cold-start handling (~130s ADR-0001 Path A), retry-with-backoff,
 * and exposes typed errors for differentiated UX flows.
 *
 * @example
 * ```ts
 * import { FluxClient, ColdStartError, RateLimitError } from '@jhonata-matias/flux-client';
 *
 * const client = new FluxClient({
 *   apiKey: process.env.GATEWAY_API_KEY!,
 *   gatewayUrl: 'https://gemma4-gateway.jhonata-matias.workers.dev',
 * });
 *
 * await client.warmup(); // pre-warm on app init
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
 *   if (e instanceof ColdStartError) console.error('Server taking longer than expected');
 *   else if (e instanceof RateLimitError) console.error(`Retry in ${e.retry_after_seconds}s`);
 *   else throw e;
 * }
 * ```
 */

export { FluxClient } from './client.js';
export {
  AuthError,
  ColdStartError,
  NetworkError,
  RateLimitError,
  ValidationError,
} from './errors.js';
export {
  DEFAULT_RETRY_CONFIG,
  DEFAULT_WARM_THRESHOLD_MS,
} from './types.js';
export type {
  ClientConstructorArgs,
  ClientOptions,
  GenerateInput,
  GenerateMetadata,
  GenerateOutput,
  RetryConfig,
  WarmupResult,
} from './types.js';
