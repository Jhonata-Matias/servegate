import { describe, it, expect, vi } from 'vitest';
import { FluxClient } from '../src/client.js';
import { ValidationError } from '../src/errors.js';
import type { EditInput, GenerateInput, GenerateOutput } from '../src/index.js';

function makeResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function fakePngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

function fakePngBase64(width: number, height: number): string {
  return Buffer.from(fakePngBytes(width, height)).toString('base64');
}

describe('FluxClient — edit happy path', () => {
  it('submits input_image_b64 to /jobs and reuses async polling', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(
        makeResponse(
          202,
          { job_id: 'job-edit', status_url: '/jobs/job-edit', est_wait_seconds: 'unknown' },
          { Location: '/jobs/job-edit', 'Retry-After': '0' },
        ),
      )
      .mockResolvedValueOnce(
        makeResponse(200, {
          output: {
            image_b64: 'EDITED',
            metadata: {
              seed: 42,
              elapsed_ms: 3200,
              qwen_generated_width: 512,
              qwen_generated_height: 512,
              output_width: 640,
              output_height: 360,
            },
          },
        }),
      );
    const client = new FluxClient({
      apiKey: 'k',
      gatewayUrl: 'https://gw.example',
      options: { fetchImpl: fetchSpy as unknown as typeof fetch },
    });

    const result = await client.edit({
      prompt: 'make the jacket green',
      image: fakePngBase64(640, 360),
      strength: 0.7,
      steps: 8,
      seed: 42,
    });

    expect(result.output.image_b64).toBe('EDITED');
    expect(client.isWarm()).toBe(true);
    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      'https://gw.example/jobs',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      'https://gw.example/jobs/job-edit',
      expect.objectContaining({ method: 'GET' }),
    );

    const body = JSON.parse((fetchSpy.mock.calls[0]?.[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body['prompt']).toBe('make the jacket green');
    expect(body['input_image_b64']).toBe(fakePngBase64(640, 360));
    expect(body['strength']).toBe(0.7);
    expect(body['steps']).toBe(8);
    expect(body['seed']).toBe(42);
    expect(body['image']).toBeUndefined();
    expect(body['autoDownsample']).toBeUndefined();
  });

  it('accepts Uint8Array image inputs', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(
        makeResponse(
          202,
          { job_id: 'job-edit', status_url: '/jobs/job-edit', est_wait_seconds: 'unknown' },
          { Location: '/jobs/job-edit', 'Retry-After': '0' },
        ),
      )
      .mockResolvedValueOnce(
        makeResponse(200, { output: { image_b64: 'OK', metadata: { seed: 1, elapsed_ms: 1 } } }),
      );
    const client = new FluxClient({
      apiKey: 'k',
      gatewayUrl: 'https://gw.example',
      options: { fetchImpl: fetchSpy as unknown as typeof fetch },
    });

    await client.edit({ prompt: 'edit', image: fakePngBytes(320, 240) });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('submits optional second image as input_image_b64_2', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(
        makeResponse(
          202,
          { job_id: 'job-edit', status_url: '/jobs/job-edit', est_wait_seconds: 'unknown' },
          { Location: '/jobs/job-edit', 'Retry-After': '0' },
        ),
      )
      .mockResolvedValueOnce(
        makeResponse(200, { output: { image_b64: 'OK', metadata: { seed: 1, elapsed_ms: 1 } } }),
      );
    const client = new FluxClient({
      apiKey: 'k',
      gatewayUrl: 'https://gw.example',
      options: { fetchImpl: fetchSpy as unknown as typeof fetch },
    });

    await client.edit({
      prompt: 'blend image 1 with image 2',
      image: fakePngBase64(640, 360),
      image2: fakePngBase64(720, 480),
    });

    const body = JSON.parse((fetchSpy.mock.calls[0]?.[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body['input_image_b64']).toBe(fakePngBase64(640, 360));
    expect(body['input_image_b64_2']).toBe(fakePngBase64(720, 480));
    expect(body['image']).toBeUndefined();
    expect(body['image2']).toBeUndefined();
  });
});

describe('FluxClient — edit validation', () => {
  it('rejects square input before any network call', async () => {
    const fetchSpy = vi.fn();
    const client = new FluxClient({
      apiKey: 'k',
      gatewayUrl: 'https://gw.example',
      options: { fetchImpl: fetchSpy as unknown as typeof fetch },
    });

    await expect(client.edit({ prompt: 'edit', image: fakePngBase64(512, 512) })).rejects.toThrow(ValidationError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects aspect_ratio 1:1 before any network call', async () => {
    const fetchSpy = vi.fn();
    const client = new FluxClient({
      apiKey: 'k',
      gatewayUrl: 'https://gw.example',
      options: { fetchImpl: fetchSpy as unknown as typeof fetch },
    });

    await expect(
      client.edit({ prompt: 'edit', image: fakePngBase64(640, 360), aspect_ratio: '1:1' }),
    ).rejects.toThrow(ValidationError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects >1MP image unless autoDownsample is enabled', async () => {
    const client = new FluxClient({ apiKey: 'k', gatewayUrl: 'https://gw.example' });
    await expect(client.edit({ prompt: 'edit', image: fakePngBase64(2000, 800) })).rejects.toThrow(
      /must be <= 1 megapixel/,
    );
  });

  it('rejects invalid base64', async () => {
    const client = new FluxClient({ apiKey: 'k', gatewayUrl: 'https://gw.example' });
    await expect(client.edit({ prompt: 'edit', image: 'not@@base64' })).rejects.toThrow(ValidationError);
  });

  it('rejects unsupported MIME by magic bytes', async () => {
    const client = new FluxClient({ apiKey: 'k', gatewayUrl: 'https://gw.example' });
    await expect(client.edit({ prompt: 'edit', image: Buffer.from('hello') })).rejects.toThrow(ValidationError);
  });

  it('rejects decoded payloads over 8MB', async () => {
    const client = new FluxClient({ apiKey: 'k', gatewayUrl: 'https://gw.example' });
    await expect(client.edit({ prompt: 'edit', image: new Uint8Array(8 * 1024 * 1024 + 1) })).rejects.toThrow(
      /8 MB/,
    );
  });

  it('rejects invalid strength and steps ranges', async () => {
    const client = new FluxClient({ apiKey: 'k', gatewayUrl: 'https://gw.example' });
    await expect(client.edit({ prompt: 'edit', image: fakePngBase64(640, 360), strength: 0 })).rejects.toThrow(
      ValidationError,
    );
    await expect(client.edit({ prompt: 'edit', image: fakePngBase64(640, 360), steps: 3 })).rejects.toThrow(
      ValidationError,
    );
  });

  it('rejects invalid base64 in image2 with image2 field', async () => {
    const client = new FluxClient({ apiKey: 'k', gatewayUrl: 'https://gw.example' });
    await expect(client.edit({ prompt: 'edit', image: fakePngBase64(640, 360), image2: 'not@@base64' }))
      .rejects.toMatchObject({ field: 'image2' });
  });

  it('rejects square image2 with image2 field', async () => {
    const client = new FluxClient({ apiKey: 'k', gatewayUrl: 'https://gw.example' });
    await expect(
      client.edit({ prompt: 'edit', image: fakePngBase64(640, 360), image2: fakePngBase64(512, 512) }),
    ).rejects.toMatchObject({ field: 'image2' });
  });

  it('rejects unsupported MIME in image2 with image2 field', async () => {
    const client = new FluxClient({ apiKey: 'k', gatewayUrl: 'https://gw.example' });
    await expect(client.edit({ prompt: 'edit', image: fakePngBase64(640, 360), image2: Buffer.from('hello') }))
      .rejects.toMatchObject({ field: 'image2' });
  });

  it('rejects decoded payloads over 8MB in image2 with image2 field', async () => {
    const client = new FluxClient({ apiKey: 'k', gatewayUrl: 'https://gw.example' });
    await expect(
      client.edit({
        prompt: 'edit',
        image: fakePngBase64(640, 360),
        image2: new Uint8Array(8 * 1024 * 1024 + 1),
      }),
    ).rejects.toMatchObject({ field: 'image2' });
  });
});

describe('SDK type additivity', () => {
  it('keeps existing GenerateInput/GenerateOutput assignable and exposes EditInput', () => {
    const generateInput: GenerateInput = { prompt: 'cat', steps: 4, width: 1024, height: 1024 };
    const generateOutput: GenerateOutput = { output: { image_b64: 'x', metadata: { seed: 1, elapsed_ms: 1 } } };
    const editInput: EditInput = {
      prompt: 'edit',
      image: fakePngBase64(640, 360),
      image2: fakePngBase64(720, 480),
      strength: 0.85,
    };

    expect(generateInput.steps).toBe(4);
    expect(generateOutput.output.metadata.seed).toBe(1);
    expect(editInput.prompt).toBe('edit');
  });
});
