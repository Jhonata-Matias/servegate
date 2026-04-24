import { ValidationError } from './errors.js';
import type { EditInput, GenerateInput } from './types.js';

export const MAX_EDIT_INPUT_PIXELS = 1_048_576;
export const MAX_EDIT_DECODED_BYTES = 8 * 1024 * 1024;
export const DEFAULT_EDIT_STEPS = 8;
export const DEFAULT_EDIT_STRENGTH = 0.85;

const MIN_EDIT_STEPS = 4;
const MAX_EDIT_STEPS = 50;

export interface NormalizedEditRequest {
  prompt: string;
  input_image_b64: string;
  strength?: number;
  seed?: number;
  steps?: number;
  aspect_ratio?: string;
}

interface ImageMeta {
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
}

interface SharpResizeOptions {
  width: number;
  height: number;
  fit: 'inside';
  withoutEnlargement: boolean;
}

interface SharpInstance {
  resize(options: SharpResizeOptions): SharpInstance;
  png(): SharpInstance;
  toBuffer(): Promise<Uint8Array>;
}

type SharpFactory = (input: Uint8Array) => SharpInstance;
type DynamicImporter = (specifier: string) => Promise<unknown>;

/**
 * Validates GenerateInput strictly — no implicit coercion.
 * Throws ValidationError on first failure with `field` + `reason` for consumer UX.
 */
export function validateGenerateInput(input: unknown): asserts input is GenerateInput {
  if (input === null || typeof input !== 'object') {
    throw new ValidationError({ field: 'input', reason: 'must be an object' });
  }

  const obj = input as Record<string, unknown>;

  if (typeof obj['prompt'] !== 'string') {
    throw new ValidationError({ field: 'prompt', reason: 'must be a string' });
  }
  if (obj['prompt'].length === 0) {
    throw new ValidationError({ field: 'prompt', reason: 'must not be empty' });
  }

  if (typeof obj['steps'] !== 'number' || !Number.isInteger(obj['steps'])) {
    throw new ValidationError({ field: 'steps', reason: 'must be an integer' });
  }
  if (obj['steps'] <= 0) {
    throw new ValidationError({ field: 'steps', reason: 'must be > 0' });
  }

  if (typeof obj['width'] !== 'number' || !Number.isInteger(obj['width'])) {
    throw new ValidationError({ field: 'width', reason: 'must be an integer' });
  }
  if (obj['width'] <= 0) {
    throw new ValidationError({ field: 'width', reason: 'must be > 0' });
  }

  if (typeof obj['height'] !== 'number' || !Number.isInteger(obj['height'])) {
    throw new ValidationError({ field: 'height', reason: 'must be an integer' });
  }
  if (obj['height'] <= 0) {
    throw new ValidationError({ field: 'height', reason: 'must be > 0' });
  }

  if (obj['seed'] !== undefined) {
    if (typeof obj['seed'] !== 'number' || !Number.isInteger(obj['seed'])) {
      throw new ValidationError({ field: 'seed', reason: 'must be an integer when provided' });
    }
  }
}

export async function validateAndNormalizeEditInput(input: unknown): Promise<NormalizedEditRequest> {
  if (input === null || typeof input !== 'object') {
    throw new ValidationError({ field: 'input', reason: 'must be an object' });
  }

  const obj = input as Partial<EditInput>;

  if (typeof obj.prompt !== 'string' || obj.prompt.trim().length === 0) {
    throw new ValidationError({ field: 'prompt', reason: 'must be a non-empty string' });
  }

  if (obj.aspect_ratio !== undefined && obj.aspect_ratio.trim() === '1:1') {
    throw new ValidationError({
      field: 'aspect_ratio',
      reason: '1:1 input images are not supported for Qwen-Image-Edit; use a non-square crop',
    });
  }

  validateOptionalNumber(obj.strength, 'strength');
  if (obj.strength !== undefined && (obj.strength <= 0 || obj.strength > 1)) {
    throw new ValidationError({ field: 'strength', reason: 'must be > 0.0 and <= 1.0' });
  }

  validateOptionalInteger(obj.seed, 'seed');
  validateOptionalInteger(obj.steps, 'steps');
  if (obj.steps !== undefined && (obj.steps < MIN_EDIT_STEPS || obj.steps > MAX_EDIT_STEPS)) {
    throw new ValidationError({ field: 'steps', reason: `must be between ${MIN_EDIT_STEPS} and ${MAX_EDIT_STEPS}` });
  }

  let bytes = await normalizeImageToBytes(obj.image);
  let meta = parseImageMeta(bytes);

  if (meta.width === meta.height) {
    throw new ValidationError({
      field: 'image',
      reason: '1:1 input images are not supported for Qwen-Image-Edit; use a non-square crop',
    });
  }

  if (meta.width * meta.height > MAX_EDIT_INPUT_PIXELS) {
    if (!obj.autoDownsample) {
      throw new ValidationError({
        field: 'image',
        reason: 'must be <= 1 megapixel; downsample first or pass autoDownsample: true in a Node.js runtime with sharp installed',
      });
    }
    bytes = await downsampleWithSharp(bytes, meta.width, meta.height);
    meta = parseImageMeta(bytes);
    if (meta.width * meta.height > MAX_EDIT_INPUT_PIXELS) {
      throw new ValidationError({ field: 'image', reason: 'sharp downsample did not reduce image to <= 1 megapixel' });
    }
  }

  const request: NormalizedEditRequest = {
    prompt: obj.prompt.trim(),
    input_image_b64: bytesToBase64(bytes),
  };
  if (obj.strength !== undefined) request.strength = obj.strength;
  if (obj.seed !== undefined) request.seed = obj.seed;
  if (obj.steps !== undefined) request.steps = obj.steps;
  if (obj.aspect_ratio !== undefined) request.aspect_ratio = obj.aspect_ratio;
  return request;
}

function validateOptionalNumber(value: unknown, field: string): void {
  if (value !== undefined && (typeof value !== 'number' || Number.isNaN(value))) {
    throw new ValidationError({ field, reason: 'must be a number when provided' });
  }
}

function validateOptionalInteger(value: unknown, field: string): void {
  if (value !== undefined && (typeof value !== 'number' || !Number.isInteger(value))) {
    throw new ValidationError({ field, reason: 'must be an integer when provided' });
  }
}

async function normalizeImageToBytes(value: unknown): Promise<Uint8Array> {
  if (typeof value === 'string') {
    return base64ToBytes(value);
  }

  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return new Uint8Array(value);
  }

  if (value instanceof Uint8Array) {
    return new Uint8Array(value);
  }

  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return new Uint8Array(await value.arrayBuffer());
  }

  throw new ValidationError({ field: 'image', reason: 'must be Buffer, Uint8Array, Blob, or base64 string' });
}

function stripDataUri(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('data:')) return trimmed;

  const separatorIndex = trimmed.indexOf(',');
  if (separatorIndex === -1 || !trimmed.slice(0, separatorIndex).includes(';base64')) {
    throw new ValidationError({ field: 'image', reason: 'data URI image must be base64 encoded' });
  }
  return trimmed.slice(separatorIndex + 1);
}

function base64ToBytes(value: string): Uint8Array {
  const compact = stripDataUri(value).replace(/\s/g, '');
  if (compact.length === 0 || compact.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    throw new ValidationError({ field: 'image', reason: 'base64 string is invalid' });
  }
  const padded = compact.padEnd(Math.ceil(compact.length / 4) * 4, '=');

  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(padded, 'base64'));
  }

  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (bytes.byteLength > MAX_EDIT_DECODED_BYTES) {
    throw new ValidationError({ field: 'image', reason: 'decoded image payload must be <= 8 MB' });
  }

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }

  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function parseImageMeta(bytes: Uint8Array): ImageMeta {
  if (bytes.byteLength > MAX_EDIT_DECODED_BYTES) {
    throw new ValidationError({ field: 'image', reason: 'decoded image payload must be <= 8 MB' });
  }
  if (isPng(bytes)) return parsePngMeta(bytes);
  if (isJpeg(bytes)) return parseJpegMeta(bytes);
  if (isWebp(bytes)) return parseWebpMeta(bytes);
  throw new ValidationError({ field: 'image', reason: 'must be PNG, JPEG, or WebP based on magic bytes' });
}

function isPng(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 24
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a;
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isWebp(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 30
    && ascii(bytes, 0, 4) === 'RIFF'
    && ascii(bytes, 8, 4) === 'WEBP';
}

function parsePngMeta(bytes: Uint8Array): ImageMeta {
  const view = dataView(bytes);
  return ensurePositiveDimensions({
    mime: 'image/png',
    width: view.getUint32(16, false),
    height: view.getUint32(20, false),
  });
}

function parseJpegMeta(bytes: Uint8Array): ImageMeta {
  const view = dataView(bytes);
  let offset = 2;
  while (offset + 3 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === undefined) break;
    offset += 2;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      continue;
    }
    if (offset + 2 > bytes.byteLength) break;
    const segmentLength = view.getUint16(offset, false);
    if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) break;
    if (isStartOfFrame(marker) && offset + 7 <= bytes.byteLength) {
      return ensurePositiveDimensions({
        mime: 'image/jpeg',
        height: view.getUint16(offset + 3, false),
        width: view.getUint16(offset + 5, false),
      });
    }
    offset += segmentLength;
  }
  throw new ValidationError({ field: 'image', reason: 'JPEG dimensions could not be read' });
}

function parseWebpMeta(bytes: Uint8Array): ImageMeta {
  const view = dataView(bytes);
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const chunk = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const dataOffset = offset + 8;
    if (dataOffset + size > bytes.byteLength) break;

    if (chunk === 'VP8X' && size >= 10) {
      return ensurePositiveDimensions({
        mime: 'image/webp',
        width: 1 + readUint24LE(bytes, dataOffset + 4),
        height: 1 + readUint24LE(bytes, dataOffset + 7),
      });
    }
    if (chunk === 'VP8 ' && size >= 10) {
      return ensurePositiveDimensions({
        mime: 'image/webp',
        width: view.getUint16(dataOffset + 6, true) & 0x3fff,
        height: view.getUint16(dataOffset + 8, true) & 0x3fff,
      });
    }
    if (chunk === 'VP8L' && size >= 5) {
      const b0 = requireByte(bytes, dataOffset + 1);
      const b1 = requireByte(bytes, dataOffset + 2);
      const b2 = requireByte(bytes, dataOffset + 3);
      const b3 = requireByte(bytes, dataOffset + 4);
      return ensurePositiveDimensions({
        mime: 'image/webp',
        width: 1 + (((b1 & 0x3f) << 8) | b0),
        height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
      });
    }

    offset = dataOffset + size + (size % 2);
  }
  throw new ValidationError({ field: 'image', reason: 'WebP dimensions could not be read' });
}

function ensurePositiveDimensions(meta: ImageMeta): ImageMeta {
  if (meta.width <= 0 || meta.height <= 0) {
    throw new ValidationError({ field: 'image', reason: 'image dimensions must be positive' });
  }
  return meta;
}

function isStartOfFrame(marker: number): boolean {
  return [
    0xc0, 0xc1, 0xc2, 0xc3,
    0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb,
    0xcd, 0xce, 0xcf,
  ].includes(marker);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (offset + length > bytes.byteLength) return '';
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return requireByte(bytes, offset)
    | (requireByte(bytes, offset + 1) << 8)
    | (requireByte(bytes, offset + 2) << 16);
}

function requireByte(bytes: Uint8Array, offset: number): number {
  const value = bytes[offset];
  if (value === undefined) {
    throw new ValidationError({ field: 'image', reason: 'image metadata is truncated' });
  }
  return value;
}

function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

async function downsampleWithSharp(bytes: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  let sharp: SharpFactory | undefined;
  try {
    const dynamicImport = new Function('specifier', 'return import(specifier)') as DynamicImporter;
    const mod = await dynamicImport('sharp');
    sharp = typeof mod === 'function'
      ? mod as SharpFactory
      : (mod as { default?: SharpFactory }).default;
  } catch (e) {
    throw new ValidationError({
      field: 'image',
      reason: `autoDownsample requires optional dependency sharp in Node.js (${e instanceof Error ? e.message : 'load failed'})`,
    });
  }

  if (!sharp) {
    throw new ValidationError({ field: 'image', reason: 'autoDownsample could not load sharp' });
  }

  const scale = Math.sqrt(MAX_EDIT_INPUT_PIXELS / (width * height));
  const targetWidth = Math.max(1, Math.floor(width * scale));
  const targetHeight = Math.max(1, Math.floor(height * scale));
  const output = await sharp(bytes)
    .resize({ width: targetWidth, height: targetHeight, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();
  return new Uint8Array(output);
}
