import { describe, it, expect } from 'vitest';
import { validateGenerateInput } from '../src/validate.js';
import { ValidationError } from '../src/errors.js';

describe('validateGenerateInput', () => {
  it('accepts valid input with required fields', () => {
    expect(() =>
      validateGenerateInput({ prompt: 'a cat', steps: 4, width: 1024, height: 1024 }),
    ).not.toThrow();
  });

  it('accepts valid input with optional seed', () => {
    expect(() =>
      validateGenerateInput({ prompt: 'a cat', steps: 4, width: 1024, height: 1024, seed: 42 }),
    ).not.toThrow();
  });

  it('rejects null input', () => {
    expect(() => validateGenerateInput(null)).toThrow(ValidationError);
  });

  it('rejects non-object input', () => {
    expect(() => validateGenerateInput('string')).toThrow(ValidationError);
    expect(() => validateGenerateInput(42)).toThrow(ValidationError);
  });

  it('rejects missing prompt', () => {
    expect(() => validateGenerateInput({ steps: 4, width: 1024, height: 1024 })).toThrow(ValidationError);
  });

  it('rejects empty prompt', () => {
    expect(() => validateGenerateInput({ prompt: '', steps: 4, width: 1024, height: 1024 })).toThrow(
      ValidationError,
    );
  });

  it('rejects non-string prompt', () => {
    expect(() => validateGenerateInput({ prompt: 123, steps: 4, width: 1024, height: 1024 })).toThrow(
      ValidationError,
    );
  });

  it('rejects steps as string (no implicit coercion)', () => {
    try {
      validateGenerateInput({ prompt: 'cat', steps: '4', width: 1024, height: 1024 });
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).field).toBe('steps');
    }
  });

  it('rejects steps = 0', () => {
    try {
      validateGenerateInput({ prompt: 'cat', steps: 0, width: 1024, height: 1024 });
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).field).toBe('steps');
      expect((e as ValidationError).reason).toContain('> 0');
    }
  });

  it('rejects steps as float', () => {
    expect(() =>
      validateGenerateInput({ prompt: 'cat', steps: 4.5, width: 1024, height: 1024 }),
    ).toThrow(ValidationError);
  });

  it('rejects width = 0', () => {
    try {
      validateGenerateInput({ prompt: 'cat', steps: 4, width: 0, height: 1024 });
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as ValidationError).field).toBe('width');
    }
  });

  it('rejects height = 0', () => {
    try {
      validateGenerateInput({ prompt: 'cat', steps: 4, width: 1024, height: 0 });
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as ValidationError).field).toBe('height');
    }
  });

  it('rejects negative width', () => {
    expect(() =>
      validateGenerateInput({ prompt: 'cat', steps: 4, width: -1, height: 1024 }),
    ).toThrow(ValidationError);
  });

  it('rejects seed as string when provided', () => {
    try {
      validateGenerateInput({ prompt: 'cat', steps: 4, width: 1024, height: 1024, seed: '42' });
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as ValidationError).field).toBe('seed');
    }
  });
});
