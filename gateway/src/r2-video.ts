import type { Env } from './types.js';

export const VIDEO_URL_TTL_SECONDS = 24 * 60 * 60;
export const VIDEO_OBJECT_PREFIX = 'videos';
const DEFAULT_GATEWAY_ORIGIN = 'https://gemma4-gateway.jhonata-matias.workers.dev';

export interface UploadVideoResult {
  videoUrl: string;
  sizeBytes: number;
  ttlSeconds: number;
  objectKey: string;
}

export interface HandlerVideoMetadata {
  duration_seconds?: unknown;
  width?: unknown;
  height?: unknown;
  fps?: unknown;
}

export interface VideoMetadata {
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
}

export interface DecodedVideoToken {
  valid: boolean;
  reason?: 'expired' | 'bad_signature' | 'bad_shape';
}

/**
 * Upload a base64-encoded MP4 to R2 and return a 24h gateway-proxied URL.
 *
 * R2 bindings in the Workers runtime expose put/get/head/list/multipart APIs,
 * but not S3 pre-sign helpers. This gateway therefore stores the MP4 in R2 and
 * returns a short-lived HMAC token URL served by GET /videos/{jobId}.
 */
export async function uploadVideoToR2(
  env: Env,
  jobId: string,
  videoB64: string,
  metadata: { submittedAt: string; apiKeyHash: string },
): Promise<UploadVideoResult> {
  const objectKey = `${VIDEO_OBJECT_PREFIX}/${jobId}.mp4`;
  const bytes = decodeBase64(videoB64);

  // Buffered upload is intentional here: RunPod returns video_b64 inline, so the
  // Worker already receives the full encoded payload before R2 can accept it.
  await env.R2_VIDEOS_BUCKET.put(objectKey, bytes, {
    httpMetadata: {
      contentType: 'video/mp4',
    },
    customMetadata: {
      job_id: jobId,
      submitted_at: metadata.submittedAt,
      api_key_hash: metadata.apiKeyHash,
    },
  });

  const token = await createVideoAccessToken(env, jobId);
  return {
    videoUrl: `${gatewayOrigin(env)}/videos/${encodeURIComponent(jobId)}?t=${encodeURIComponent(token)}`,
    sizeBytes: bytes.byteLength,
    ttlSeconds: VIDEO_URL_TTL_SECONDS,
    objectKey,
  };
}

/**
 * Reads handler-side video metadata instead of parsing MP4 atoms in the Worker.
 * The LTX handler emits these values in RunPod /status output.metadata, which is
 * cheaper and less brittle than adding a partial MP4 parser to the gateway.
 */
export function readVideoMetadata(handlerMeta: HandlerVideoMetadata): VideoMetadata {
  return {
    duration_seconds: finiteNumber(handlerMeta.duration_seconds),
    width: finiteNumber(handlerMeta.width),
    height: finiteNumber(handlerMeta.height),
    fps: finiteNumber(handlerMeta.fps),
  };
}

export async function createVideoAccessToken(
  env: Env,
  jobId: string,
  now: Date = new Date(),
): Promise<string> {
  const expiresAt = Math.floor(now.getTime() / 1000) + VIDEO_URL_TTL_SECONDS;
  const signature = await signVideoToken(env, jobId, expiresAt);
  return base64UrlEncodeString(`${signature}:${expiresAt}:${jobId}`);
}

export async function verifyVideoAccessToken(
  env: Env,
  jobId: string,
  token: string,
  now: Date = new Date(),
): Promise<DecodedVideoToken> {
  const decoded = base64UrlDecodeString(token);
  if (!decoded) return { valid: false, reason: 'bad_shape' };

  const first = decoded.indexOf(':');
  const second = decoded.indexOf(':', first + 1);
  if (first <= 0 || second <= first + 1) return { valid: false, reason: 'bad_shape' };

  const signature = decoded.slice(0, first);
  const expiresRaw = decoded.slice(first + 1, second);
  const tokenJobId = decoded.slice(second + 1);
  const expiresAt = Number.parseInt(expiresRaw, 10);
  if (tokenJobId !== jobId || !Number.isFinite(expiresAt)) {
    return { valid: false, reason: 'bad_shape' };
  }
  if (expiresAt <= Math.floor(now.getTime() / 1000)) {
    return { valid: false, reason: 'expired' };
  }

  const ok = await verifyVideoTokenSignature(env, jobId, expiresAt, signature);
  return ok ? { valid: true } : { valid: false, reason: 'bad_signature' };
}

function gatewayOrigin(env: Env): string {
  const configured = env.CORS_ALLOWED_ORIGIN;
  return configured?.startsWith('http') ? configured.replace(/\/+$/, '') : DEFAULT_GATEWAY_ORIGIN;
}

function decodeBase64(value: string): Uint8Array {
  const base64 = value.includes(',') ? value.slice(value.indexOf(',') + 1) : value;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function signVideoToken(env: Env, jobId: string, expiresAt: number): Promise<string> {
  const key = await importHmacKey(env.GATEWAY_API_KEY);
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${jobId}.${expiresAt}`),
  );
  return base64UrlEncodeBytes(new Uint8Array(signature));
}

async function verifyVideoTokenSignature(
  env: Env,
  jobId: string,
  expiresAt: number,
  signature: string,
): Promise<boolean> {
  const signatureBytes = base64UrlDecodeBytes(signature);
  if (!signatureBytes) return false;
  const key = await importHmacKey(env.GATEWAY_API_KEY);
  return crypto.subtle.verify(
    'HMAC',
    key,
    signatureBytes,
    new TextEncoder().encode(`${jobId}.${expiresAt}`),
  );
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function base64UrlEncodeString(value: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(value));
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecodeString(value: string): string | null {
  const bytes = base64UrlDecodeBytes(value);
  if (!bytes) return null;
  try {
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function base64UrlDecodeBytes(value: string): Uint8Array | null {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(
      Math.ceil(value.length / 4) * 4,
      '=',
    );
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}
