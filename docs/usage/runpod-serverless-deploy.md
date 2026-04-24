# RunPod Serverless Deploy — FLUX.1-schnell endpoint

Como buildar, deployar, invocar e operar o endpoint Serverless empacotado em `serverless/` (Story 2.1, Epic 2).

## Visão geral

| Componente | Detalhe |
|---|---|
| Imagem | `ghcr.io/jhonata-matias/gemma4-flux-serverless:0.1.0` |
| Modelos | Network volume `<NETWORK_VOLUME_ID>` (`<RUNPOD_DATACENTER_ID>`) montado em `/runpod-volume` |
| GPU | NVIDIA GeForce RTX 4090 (24GB) |
| Datacenter | `<RUNPOD_DATACENTER_ID>` (constraint do volume) |
| Cold start alvo | <30s |
| Warm latency alvo | <10s p95 |
| Cost alvo | `<$0.01/img warm` |

## i2i Model Artifacts

Story 3.1 adds Qwen-Image-Edit as an image-to-image branch in the existing handler. `@devops` owns artifact upload and license verification before deployment.

Expected network-volume layout:

| Path | Artifact | License note |
|---|---|---|
| `/runpod-volume/ComfyUI/models/unet/qwen_image_edit_fp8_e4m3fn.safetensors` | Qwen-Image-Edit UNet fp8 | Apache 2.0 per ADR-0003 |
| `/runpod-volume/ComfyUI/models/vae/qwen_image_vae.safetensors` | Qwen VAE | Apache 2.0 per ADR-0003 |
| `/runpod-volume/ComfyUI/models/clip/qwen_2.5_vl_7b_fp8_scaled.safetensors` | Qwen2.5-VL encoder | Apache 2.0 per ADR-0003 |
| `/runpod-volume/ComfyUI/models/loras/qwen_image_lightning_8steps_lora.safetensors` | Lightning 8-step LoRA | Verify source license before upload; fallback is 50-step path |
| `/runpod-volume/ComfyUI/NOTICE.md` | License provenance notice | Use `docs/legal/QWEN_IMAGE_EDIT_NOTICE.md` as the source template and fill LoRA source after verification |

Operational checks before serverless deploy:

- run the Qwen-Image-Edit workflow once on a Pod with the same volume
- verify `LoadImageBase64` or equivalent custom node is installed
- verify no prompt, input image bytes, or output image bytes appear in worker logs
- keep the existing FLUX.1-schnell artifacts unchanged

## 1. Buildar a imagem

Pré-requisitos: Docker Desktop com WSL integration ativa em Ubuntu, `gh` CLI autenticado.

```bash
cd /home/jhonata/projetos/gemma4

# Login ghcr.io (token vem do gh)
gh auth token | sg docker -c 'docker login ghcr.io -u Jhonata-Matias --password-stdin'

# Build
sg docker -c 'docker build \
  -t ghcr.io/jhonata-matias/gemma4-flux-serverless:0.1.0 \
  -f serverless/Dockerfile \
  serverless/'

# Push
sg docker -c 'docker push ghcr.io/jhonata-matias/gemma4-flux-serverless:0.1.0'
```

> Para que RunPod consiga puxar sem credentials, marque o package em https://github.com/users/Jhonata-Matias/packages/container/gemma4-flux-serverless/settings como **Public**.

## 2. Criar template + endpoint via RunPod REST API

```bash
. .env  # carrega RUNPOD_API_KEY

# 2.1 — criar template (referencia a imagem)
TEMPLATE=$(curl -sS -X POST "https://rest.runpod.io/v1/templates" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "gemma4-flux-serverless-v0_1_0",
    "imageName": "ghcr.io/jhonata-matias/gemma4-flux-serverless:0.1.0",
    "category": "NVIDIA",
    "containerDiskInGb": 20,
    "isServerless": true,
    "isPublic": false,
    "readme": "ComfyUI + FLUX.1-schnell handler — Story 2.1"
  }')
TEMPLATE_ID=$(echo "$TEMPLATE" | jq -r .id)
echo "TEMPLATE_ID=$TEMPLATE_ID"

# 2.2 — criar endpoint (referencia template + volume + GPU)
ENDPOINT=$(curl -sS -X POST "https://rest.runpod.io/v1/endpoints" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"gemma4-flux-serverless\",
    \"templateId\": \"$TEMPLATE_ID\",
    \"computeType\": \"GPU\",
    \"gpuTypeIds\": [\"NVIDIA GeForce RTX 4090\"],
    \"gpuCount\": 1,
    \"dataCenterIds\": [\"<RUNPOD_DATACENTER_ID>\"],
    \"networkVolumeId\": \"<NETWORK_VOLUME_ID>\",
    \"workersMin\": 0,
    \"workersMax\": 3,
    \"idleTimeout\": 5,
    \"executionTimeoutMs\": 300000,
    \"flashboot\": true,
    \"scalerType\": \"QUEUE_DELAY\",
    \"scalerValue\": 4
  }")
ENDPOINT_ID=$(echo "$ENDPOINT" | jq -r .id)
echo "ENDPOINT_ID=$ENDPOINT_ID"

# Persistir no .env (gitignored)
echo "RUNPOD_SERVERLESS_TEMPLATE_ID=$TEMPLATE_ID" >> .env
echo "RUNPOD_SERVERLESS_ENDPOINT_ID=$ENDPOINT_ID" >> .env
```

## 3. Invocar o endpoint

### Sync (curl)

```bash
. .env
curl -sS -X POST "https://api.runpod.ai/v2/$RUNPOD_SERVERLESS_ENDPOINT_ID/runsync" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"input":{"prompt":"a peaceful zen garden with cherry blossoms","seed":42}}' \
  | jq -r .output.image_b64 | base64 -d > out.png
```

### Async (curl)

```bash
JOB=$(curl -sS -X POST "https://api.runpod.ai/v2/$RUNPOD_SERVERLESS_ENDPOINT_ID/run" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"input":{"prompt":"sunset over mountains"}}')
JOB_ID=$(echo "$JOB" | jq -r .id)

# Polling
until curl -sS "https://api.runpod.ai/v2/$RUNPOD_SERVERLESS_ENDPOINT_ID/status/$JOB_ID" \
        -H "Authorization: Bearer $RUNPOD_API_KEY" | jq -e '.status == "COMPLETED"' >/dev/null; do
  sleep 1
done
```

### Python

```python
import base64, os, requests
ENDPOINT = os.environ["RUNPOD_SERVERLESS_ENDPOINT_ID"]
TOKEN    = os.environ["RUNPOD_API_KEY"]

r = requests.post(
    f"https://api.runpod.ai/v2/{ENDPOINT}/runsync",
    headers={"Authorization": f"Bearer {TOKEN}"},
    json={"input": {"prompt": "neon cyberpunk skyline", "steps": 4}},
    timeout=120,
)
r.raise_for_status()
img_b64 = r.json()["output"]["image_b64"]
open("out.png", "wb").write(base64.b64decode(img_b64))
```

### TypeScript (preview — Story 2.2 SDK em construção)

```ts
import { writeFileSync } from "node:fs";

const r = await fetch(
  `https://api.runpod.ai/v2/${process.env.RUNPOD_SERVERLESS_ENDPOINT_ID}/runsync`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RUNPOD_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input: { prompt: "abstract watercolor", seed: 7 } }),
  },
);
const { output } = await r.json();
writeFileSync("out.png", Buffer.from(output.image_b64, "base64"));
```

## 4. Rotacionar a imagem

```bash
NEW_TAG="0.2.0"
sg docker -c "docker build -t ghcr.io/jhonata-matias/gemma4-flux-serverless:$NEW_TAG -f serverless/Dockerfile serverless/"
sg docker -c "docker push ghcr.io/jhonata-matias/gemma4-flux-serverless:$NEW_TAG"

# Patch template para nova tag (rolling release)
curl -sS -X PATCH "https://rest.runpod.io/v1/templates/$RUNPOD_SERVERLESS_TEMPLATE_ID" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"imageName\":\"ghcr.io/jhonata-matias/gemma4-flux-serverless:$NEW_TAG\"}"
```

## 5. Schema do handler

Veja `serverless/README.md` para o contrato completo de input/output. TL;DR:

- **Input** (`event.input`): `{prompt: string, steps?: int=4, seed?: int=random, width?: int=1024, height?: int=1024}`
- **Input edit** (`event.input`): `{prompt: string, input_image_b64: string, strength?: float=0.85, steps?: int=8, seed?: int=random}`
- **Output sucesso**: `{image_b64: string, metadata: {seed: int, elapsed_ms: int}}`
- **Output erro**: `{error: string, code: 400|500|504}`

Validações:
- `prompt` obrigatório, não-vazio
- `steps` ∈ [1, 50]
- `width/height` ∈ [256, 2048] e múltiplos de 8
- `seed` ∈ [0, 2^63)
- Para edit: imagem PNG/JPEG/WebP por magic bytes, payload decodado ≤8 MB, rejeita `1:1`, downsample defensivo para ≤1 MP, `strength` ∈ (0.0, 1.0], `steps` ∈ [4, 50]

## 6. Operação

### Métricas e custo

```bash
# Listar últimas runs do endpoint
curl -sS "https://api.runpod.ai/v2/$RUNPOD_SERVERLESS_ENDPOINT_ID/" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" | jq

# Custo (via dashboard): https://www.runpod.io/console/serverless
```

### Logs em tempo real

Console RunPod > Serverless > endpoint > worker > Logs.
Handler emite logs JSON one-per-line (`level`, `msg`, `job_id`, ...) para facilitar parsing futuro.

## 7. Troubleshooting

| Sintoma | Causa provável | Fix |
|---|---|---|
| `Cold start > 30s` | Imagem não cacheada no datacenter | Garantir `flashboot: true`; primeira chamada após deploy é sempre lenta |
| `403 ImagePullBackOff` | Imagem ghcr.io privada | Tornar pacote público no GitHub OU configurar `containerRegistryAuthId` |
| `models dir missing` ao boot | Volume não montado ou path errado | Validar `networkVolumeId` no endpoint; volume tem que ter `ComfyUI/models/...` na raiz |
| `unet_name not in []` no /prompt | ComfyUI não enxerga modelos do volume | Verificar `extra_model_paths.yaml` no `$COMFY_DIR/` (start.sh escreve) |
| Worker fica RUNNING mas nunca responde | ComfyUI travou no boot | Logs do worker — provavelmente OOM ou GPU não disponível |
| Latência > 10s warm | GPU diferente da esperada (não é 4090) | Verificar `gpuTypeIds` no endpoint config; reduzir `gpuTypeIds` para só RTX 4090 |
| `executionTimeoutMs` exceeded | Cold start + steps muito altos | Aumentar timeout para 180000ms se steps > 10 |
| `invalid_aspect_ratio` em edit | Input exatamente `1:1` | Usar crop não-quadrado antes de submeter |

## 8. Comparativo com Pod self-hosted (Story 1.1)

| | Pod self-hosted | Serverless |
|---|---|---|
| Custo idle | $0.69/h sempre | $0 (scale to zero) |
| Custo por imagem | "grátis" se já ligado | `<$0.01/img warm` |
| Cold start | variável | variável com flashboot |
| Warm latência | baixa em Pod já ligado | baixa + overhead HTTP |
| Throughput máximo | 1 req/s (1 worker) | até `workersMax × throughput` |
| Operação | manual (`pod.sh up/stop`) | autoscale |
| Dev iterativo | rápido (SSH direto) | lento (re-build + re-push) |

**Quando usar:**
- Self-hosted = batch de muitas imagens em sequência ou debug iterativo do workflow
- Serverless = produção, tráfego esporádico, integração com app web/API
