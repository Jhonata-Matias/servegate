import { ValidationError } from './errors.js';
import type { GenerateInput } from './types.js';

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
