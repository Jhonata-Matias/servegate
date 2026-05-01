# spike/test_images/

Place i2v reference images here, named to match `input_image` paths in `spike/benchmark_prompts.json`:

- `portrait.jpg` — single-subject portrait, neutral pose
- `landscape.jpg` — outdoor scene with sky and foreground
- `product.jpg` — product on neutral background, studio-style
- `action.jpg` — subject mid-action (motion blur OK)
- `abstract.jpg` — abstract / artistic source

**Sizing guidance.** The handler converts to RGB and the Wan2.2-TI2V-5B-Diffusers pipeline interpolates to the requested output resolution (default 1280×704). Source images at or above 1280×704 produce the cleanest results; smaller images upsample with quality loss. JPEG/PNG accepted; max 12 MB per `MAX_IMAGE_BYTES` in the handler.

**Privacy / licensing.** Files in this directory are gitignored (binary assets stay out of the repo). The smoke runner reads them at submit time, base64-encodes inline, and sends to RunPod. Do not place images you cannot legally upload.

**Selective runs.** If you want to skip i2v entirely until images are ready:

```bash
python3 spike/smoke_run.py --endpoint-id <id> --gpu-label L40S-48GB --mode t2v
```

Missing images cause the corresponding i2v entries to be **skipped** (logged, not errored), so partial setups still produce useful t2v metrics.
