# POST /jobs — Image-to-Image (i2i) payload and job contract

This document describes the i2i (image-to-image) payload shape accepted by the gateway `POST /jobs` endpoint, and the structure of the `GET /jobs/{id}` responses for the async submit/poll contract used by Story 3.1.

Summary:
- Route selection: presence of `input_image_b64` in the `POST /jobs` payload triggers the i2i workflow (Qwen-Image-Edit) on the serverless handler. Absence uses text-to-image (T2I).
- Contract: `POST /jobs` returns `202 Accepted` with a `job_id` and `status_url`. Clients poll `GET /jobs/{id}` until completion (200) or failure (4xx/5xx).

POST /jobs (i2i) — Request

Content-Type: `application/json`

Body (example):

{
  "model": "qwen-image-edit-v0",
  "input_image_b64": "data:image/png;base64,iVBORw0KGgoAAAANS...",
  "prompt": "Make the jacket green while keeping the background unchanged",
  "steps": 8,
  "width": 1024,
  "height": 1024,
  "strength": 0.85,
  "seed": 42,
  "options": {
    "autoDownsample": true
  }
}

Required and recommended fields:
- `input_image_b64` (string): data URL or plain base64 of input PNG/JPEG/WebP. Presence selects i2i.
- `prompt` (string): textual edit instruction.
- `steps` (int): inference steps (4–50 recommended).
- `width`, `height` (int): requested output size. Handler will preserve aspect ratio when resizing and may downsample prior to Qwen processing.

Validation rules enforced by the SDK and handler:
- Exact 1:1 (square) inputs are rejected by client-side validation due to Qwen-Image-Edit coherence issues.
- Decoded input payload must be <= 8 MiB. Larger files must be pre-processed by the client.
- Images over 1 megapixel are downsampled unless `autoDownsample` is false; when downsampled, final PNG is resized back to the requested dimensions after inference.
- Allowed mime types: `image/png`, `image/jpeg`, `image/webp`.

POST /jobs — Response (202 Accepted)

{
  "job_id": "abc123",
  "status_url": "https://gateway.example.com/jobs/abc123",
  "message": "job accepted; poll status_url for updates",
  "estimated_wait_seconds": 20
}

GET /jobs/{id} — Polling contract

GET returns one of:
- 202 Accepted: job still queued/running. Headers may include `Retry-After`.
- 200 OK: job completed; body contains `status: \"succeeded\"` and `output` object.
- 4xx/5xx: terminal failure; body contains `status: \"failed\"` and `error` object.

Example success response (200):

{
  "job_id": "abc123",
  "status": "succeeded",
  "output": {
    "image_b64": "data:image/png;base64,iVBORw0KGgoAAAANS...",
    "metadata": {
      "model": "qwen-image-edit-v0",
      "inference_steps": 8,
      "seed": 42,
      "input_width": 1536,
      "input_height": 1024,
      "qwen_output_width": 1024,
      "qwen_output_height": 682,
      "output_width": 1024,
      "output_height": 682,
      "elapsed_ms": 24123
    }
  }
}

Errors
- `ValidationError` (400): input violated client or server validation (includes `field` and `reason`).
- `ProcessingError` (5xx): transient or model error; retry/backoff recommended.

Routing note
- The handler uses simple payload-shape dispatch: send `input_image_b64` to request i2i; omit it to request T2I. Keep this in mind for SDK wrappers that expose both `generate()` and `edit()` APIs.

Security and privacy
- Do not include provider secrets (e.g., `RUNPOD_API_KEY`) in SDKs or public client code. The gateway/handler relies on server-side credentials managed by `@devops`.

Provenance
- Deployments that include self-hosted Qwen artifacts MUST include the `NOTICE.md` artifact with Apache-2.0 at the RunPod network volume (`/runpod-volume/ComfyUI/NOTICE.md`). See `docs/legal/QWEN_IMAGE_EDIT_NOTICE.md` for template.

See also: `docs/stories/3.1.qwen-image-edit-i2i.story.md` (ACs and DoD)
