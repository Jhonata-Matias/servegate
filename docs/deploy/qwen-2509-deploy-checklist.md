# Deploy Checklist — Qwen-Image-Edit 2509 (multi-image i2i)

**PR:** [#15 — feat(i2i): multi-image support via Qwen-Image-Edit 2509](https://github.com/Jhonata-Matias/servegate/pull/15)
**Owner:** @devops
**Pre-flight investigation date:** 2026-04-29
**Estimated total deploy time:** 60-90 min (excludes model download wait)

---

## Pre-flight verifications (already complete)

| Check | Status | Source |
|---|---|---|
| ComfyUI v0.3.62 exposes `TextEncodeQwenImageEditPlus` | ✅ Confirmed | `gh api /repos/comfyanonymous/ComfyUI/contents/comfy_extras/nodes_qwen.py?ref=v0.3.62` shows class registered in `QwenExtension` |
| Model is NOT baked in Docker image | ✅ Confirmed | `serverless/Dockerfile:2` — "Models NOT baked in — mounted at runtime from /runpod-volume" |
| Network volume already exists | ✅ `mqqgzwnfp1` (default in `serverless/deploy.sh:19`) |
| Tests pass on PR | ✅ pytest 52/52, sdk vitest 55/55 |

**Implication:** No `COMFY_REF` bump needed in Dockerfile. Only the model weight needs to land on the network volume + handler.py change forces a Docker rebuild.

---

## Step 1 — Download Qwen 2509 weights to network volume

**Where:** Inside the RunPod pod that has `/runpod-volume` mounted (the same pod used for development; `pod.sh` provides SSH access).

**Goal:** Place `qwen_image_edit_2509_fp8_e4m3fn.safetensors` (~20 GB) alongside the existing v1 weight at `/runpod-volume/ComfyUI/models/diffusion_models/`.

**Keep v1 in place** for instant rollback (revert `QWEN_UNET_NAME` in handler.py + re-bake).

```bash
# From WSL/local
bash pod.sh ssh

# Inside pod:
df -h /runpod-volume                                   # verify ≥ 25 GB free
cd /runpod-volume/ComfyUI/models/diffusion_models      # adjust if path differs
ls -lh qwen_image_edit_*.safetensors                   # confirm v1 already there

huggingface-cli download Comfy-Org/Qwen-Image-Edit_ComfyUI \
  split_files/diffusion_models/qwen_image_edit_2509_fp8_e4m3fn.safetensors \
  --local-dir . --local-dir-use-symlinks False

# Move to top-level if HF places under split_files/
mv split_files/diffusion_models/qwen_image_edit_2509_fp8_e4m3fn.safetensors . 2>/dev/null || true
ls -lh qwen_image_edit_2509_fp8_e4m3fn.safetensors     # ~20 GB expected
```

**Verification:** SHA-256 of downloaded file should match HuggingFace LFS metadata. If checksums mismatch, re-download.

**Time:** 15-40 min depending on pod bandwidth.

---

## Step 2 — Bump Docker image tag

Edit `serverless/deploy.sh:14-15`:

```diff
-IMAGE="${IMAGE:-ghcr.io/jhonata-matias/gemma4-flux-serverless:0.1.0}"
-TEMPLATE_NAME="${TEMPLATE_NAME:-gemma4-flux-serverless-v0_1_0}"
+IMAGE="${IMAGE:-ghcr.io/jhonata-matias/gemma4-flux-serverless:0.2.0}"
+TEMPLATE_NAME="${TEMPLATE_NAME:-gemma4-flux-serverless-v0_2_0}"
```

Rationale: handler.py changed (multi-image dispatch + Qwen 2509 reference) — this is a non-breaking feature addition, semver minor bump. Template name follows the same convention.

---

## Step 3 — Build + push the Docker image

**Pre-requisite:** `docker login ghcr.io` with a PAT having `write:packages` scope.

```bash
cd serverless/
docker build -t ghcr.io/jhonata-matias/gemma4-flux-serverless:0.2.0 .
docker push ghcr.io/jhonata-matias/gemma4-flux-serverless:0.2.0
```

**Verification:**
```bash
docker manifest inspect ghcr.io/jhonata-matias/gemma4-flux-serverless:0.2.0 | jq '.config.digest'
```

**Time:** 5-10 min (image is ~6-8 GB, no model baked).

**Failure modes:**
- `denied: requires write:packages` → re-create PAT with correct scope, `docker login` again
- `network timeout` during push → retry; ghcr is rate-limited, exponential backoff
- `multi-platform push` → if local docker is buildx-enabled, ensure target is `linux/amd64` (RunPod is x86_64 GPU)

---

## Step 4 — Update RunPod template + endpoint

`deploy.sh` is idempotent: if template name is new, it creates; if endpoint already exists, it updates `executionTimeoutMs` and reuses.

```bash
IMAGE=ghcr.io/jhonata-matias/gemma4-flux-serverless:0.2.0 \
TEMPLATE_NAME=gemma4-flux-serverless-v0_2_0 \
bash serverless/deploy.sh
```

**What this does:**
1. Creates new template `gemma4-flux-serverless-v0_2_0` pointing to `:0.2.0` image.
2. Reuses existing endpoint `gemma4-flux-serverless` (default `ENDPOINT_NAME`).
3. **Important caveat:** `deploy.sh` does NOT change the `templateId` of an existing endpoint via PATCH. To switch the endpoint to the new template, manual step required:

```bash
# Get template ID from .env (deploy.sh writes it)
NEW_TID=$(grep ^RUNPOD_SERVERLESS_TEMPLATE_ID .env | cut -d= -f2)
ENDPOINT_ID=$(grep ^RUNPOD_SERVERLESS_ENDPOINT_ID .env | cut -d= -f2)

curl -sS -X PATCH \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"templateId\":\"$NEW_TID\"}" \
  "https://rest.runpod.io/v1/endpoints/$ENDPOINT_ID" | jq .
```

⚠️ **Tech debt note:** `deploy.sh` should learn to PATCH `templateId` automatically — currently a manual step. Worth a follow-up issue.

**Time:** 1-2 min.

---

## Step 5 — Smoke tests

Three smoke tests in sequence: T2I regression, i2i 1-image (backwards compat), i2i 2-image (new path).

### 5a. T2I regression

```bash
bash serverless/tests/smoke.sh
```
Expect: PNG ~1024×1024, FLUX.1-schnell output. Validates that v2509 handler change didn't break T2I.

### 5b. i2i 1-image (backwards compat)

Provided as `serverless/tests/smoke-i2i-1image.sh` in this PR.

```bash
bash serverless/tests/smoke-i2i-1image.sh /path/to/test-image.png
```
Expect: PNG output matching input dimensions. Workflow uses single-image `TextEncodeQwenImageEdit` node (no Plus). Validates that Qwen v1→2509 upgrade preserved single-image behavior.

### 5c. i2i 2-image (new feature)

Provided as `serverless/tests/smoke-i2i-2image.sh` in this PR.

```bash
bash serverless/tests/smoke-i2i-2image.sh /path/to/image1.png /path/to/image2.png
```
Expect: PNG output combining both inputs per prompt. Workflow uses `TextEncodeQwenImageEditPlus` with `image1` + `image2`. Validates the new path end-to-end.

**Test images:** Use any PNG/JPEG ≤ 1 MP, non-square. The repo does not commit binary fixtures — provide your own.

---

## Step 6 — SDK publish (optional, post-deploy)

After the endpoint is verified working with both smoke tests:

```bash
cd sdk/
npm run prepublishOnly  # runs typecheck + test + build
npm run publish:gh      # publishes to GitHub Packages registry
```

Subscribers consume `@jhonata-matias/flux-client@0.4.0` to start using `EditInput.image2`.

---

## Rollback procedure

If smoke 5a fails (T2I regression) or 5b/5c fail with errors blocking production:

```bash
# Switch endpoint back to old template (v0_1_0)
OLD_TID=$(curl -sS -H "Authorization: Bearer $RUNPOD_API_KEY" \
  https://rest.runpod.io/v1/templates | jq -r \
  '.[] | select(.name=="gemma4-flux-serverless-v0_1_0") | .id')

curl -sS -X PATCH \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"templateId\":\"$OLD_TID\"}" \
  "https://rest.runpod.io/v1/endpoints/$ENDPOINT_ID"
```

Old image at `:0.1.0` continues to use Qwen v1 weight (still on network volume per Step 1). No data loss, no SDK rollback needed (v0.4.0 SDK is forward-compat with v0.3.x server: 1-image calls work, 2-image calls fail gracefully with the old `TextEncodeQwenImageEdit` node).

**Rollback time:** ~30 sec (just the PATCH call; new workers spawn with old image on next request).

---

## Post-deploy cleanup (optional)

After 1-2 weeks of stable v0.2.0 in prod:

- [ ] Delete old template `gemma4-flux-serverless-v0_1_0` (RunPod UI or REST API)
- [ ] Remove old image tag `:0.1.0` from ghcr.io (or keep for audit)
- [ ] Consider removing `qwen_image_edit_fp8_e4m3fn.safetensors` (v1) from network volume to reclaim ~20 GB

---

## Open follow-ups (not blocking deploy)

- `deploy.sh` should auto-PATCH endpoint `templateId` when new template is detected (currently manual).
- Smoke tests should land in CI — currently manual scripts. A GitHub Actions workflow (`.github/workflows/`) doesn't yet exist in this repo.
- SDK release tagging (`gh release create v0.4.0 --notes-file sdk/CHANGELOG.md`) should be automated.
- Pre-public audit: `serverless/Dockerfile:2` and `serverless/deploy.sh:19` expose network volume ID `mqqgzwnfp1`. Existing leak (not introduced by this PR), worth a separate sanitization PR.
