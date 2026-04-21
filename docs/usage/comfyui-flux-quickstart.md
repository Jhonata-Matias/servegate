# ComfyUI + FLUX.1-schnell — Quickstart

Como usar o stack de geração de imagem instalado no Pod RunPod (Story 1.1).

## Stack

| Componente | Versão | Porta interna |
|---|---|---|
| ComfyUI | 0.19.3 | 8188 |
| FLUX.1-schnell | BFL official | — |
| PyTorch | 2.4.1+cu124 | — |
| Python venv | em `/workspace/ComfyUI/venv` | — |

**Modelos persistidos em `/workspace/ComfyUI/models/`:**
- `unet/flux1-schnell.safetensors` (23 GB, FP16; rodado em FP8 por `weight_dtype=fp8_e4m3fn`)
- `vae/ae.safetensors` (320 MB)
- `clip/t5xxl_fp8_e4m3fn.safetensors` (4.6 GB)
- `clip/clip_l.safetensors` (235 MB)

## Acesso ao endpoint

A porta `8188` **não está mapeada externamente** no template atual do Pod (apenas `:22 → porta dinâmica`). Acesso via SSH tunnel:

```bash
# Pega a porta SSH atual da API (muda a cada restart do Pod)
SSH_PORT=$(./pod.sh status | jq -r '.portMappings."22"')

# Tunnel local :8188 → Pod :8188
ssh -L 8188:localhost:8188 -N \
    -i ~/.ssh/id_ed25519 -p "$SSH_PORT" \
    root@203.57.40.93
```

Com o tunnel ativo, abra `http://localhost:8188` no browser ou consuma a API em `http://localhost:8188/`.

> Para expor publicamente (sem tunnel), `@devops` precisa adicionar port mapping `8188/http` no template do RunPod (story futura).

## Comandos do `pod.sh` (raiz do projeto)

```bash
./pod.sh status         # Status atual do Pod (RUNNING/EXITED, portas, custo)
./pod.sh up             # Liga + espera SSH + roda /workspace/start.sh (sobe Ollama + ComfyUI)
./pod.sh stop           # Para o Pod (zera GPU billing, mantém /workspace)
./pod.sh ssh '<cmd>'    # Executa comando remoto
./pod.sh ssh            # Sessão interativa
```

A porta SSH externa muda a cada restart do Pod — `pod.sh up` puxa a nova da API e atualiza `.env` automaticamente.

## Geração de imagem via API

### Workflow API mínimo (FLUX schnell, 4 steps, 1024x1024)

Salve em `flux-workflow.json` (ou veja `/workspace/ComfyUI/test-workflow.json` no Pod):

```json
{
  "prompt": {
    "10": {"class_type":"UNETLoader","inputs":{"unet_name":"flux1-schnell.safetensors","weight_dtype":"fp8_e4m3fn"}},
    "11": {"class_type":"DualCLIPLoader","inputs":{"clip_name1":"t5xxl_fp8_e4m3fn.safetensors","clip_name2":"clip_l.safetensors","type":"flux"}},
    "12": {"class_type":"VAELoader","inputs":{"vae_name":"ae.safetensors"}},
    "13": {"class_type":"EmptyLatentImage","inputs":{"width":1024,"height":1024,"batch_size":1}},
    "14": {"class_type":"CLIPTextEncode","inputs":{"text":"PROMPT_AQUI","clip":["11",0]}},
    "15": {"class_type":"CLIPTextEncode","inputs":{"text":"","clip":["11",0]}},
    "16": {"class_type":"KSampler","inputs":{"seed":42,"steps":4,"cfg":1.0,"sampler_name":"euler","scheduler":"simple","denoise":1.0,"model":["10",0],"positive":["14",0],"negative":["15",0],"latent_image":["13",0]}},
    "17": {"class_type":"VAEDecode","inputs":{"samples":["16",0],"vae":["12",0]}},
    "18": {"class_type":"SaveImage","inputs":{"images":["17",0],"filename_prefix":"out"}}
  }
}
```

### Submeter prompt

```bash
# Com SSH tunnel ativo em localhost:8188
curl -sS -X POST -H "Content-Type: application/json" \
     -d @flux-workflow.json \
     http://localhost:8188/prompt
# → {"prompt_id":"abc-123","number":N,"node_errors":{}}
```

### Polling até completar

```bash
PID="abc-123"
until curl -sS http://localhost:8188/history/$PID | \
      python3 -c 'import sys,json,os;p=os.environ["PID"];print(json.load(sys.stdin).get(p,{}).get("status",{}).get("completed",False))' | grep -q True; do
  sleep 1
done
echo "ready"
```

### Recuperar a imagem

ComfyUI salva em `/workspace/ComfyUI/output/<filename_prefix>_NNNNN_.png`. Recuperar via API:

```bash
curl "http://localhost:8188/view?filename=out_00001_.png&type=output" -o ./gerada.png
```

Ou via SSH/SCP direto do diretório.

## Performance esperada (RTX 4090, 1024x1024, 4 steps)

| Estado | Latência por imagem |
|---|---|
| Cold start (primeira request após boot ou idle) | ~30-70s (model load em VRAM) |
| Warm cache (model já em VRAM) | ~3-5s |
| Throughput sustained | ~10-15 img/min sequencial |

## VRAM e coexistência com Ollama

- VRAM total: 24 GB (RTX 4090)
- FLUX FP8 carregado: ~16 GB ocupado
- Ollama qwen2.5-coder:14b: ~9 GB (descarrega após 5 min de keep-alive default)
- **Não cabem simultâneos em VRAM.** Ollama descarrega quando ocioso; FLUX carrega sob demanda.

Se Ollama for chamado durante geração FLUX ativa, o que ocorrer primeiro mantém VRAM; o segundo vai pra fila ou desloca. Para chat+image em paralelo, considere segundo Pod ou GPU maior.

## Troubleshooting

| Sintoma | Causa provável | Fix |
|---|---|---|
| `401` ou `403` em download HF | Token ausente / licença não aceita | Verifique `/workspace/.hf-token`; aceite licença em huggingface.co/black-forest-labs/FLUX.1-schnell |
| `unet_name not in []` no /prompt | Modelo em diretório errado | Mova `flux1-schnell.safetensors` para `/workspace/ComfyUI/models/unet/` |
| `Disk quota exceeded` | Network volume cheio | Aumente quota: `curl -X PATCH .../v1/networkvolumes/<id> -d '{"size":N}'` |
| ComfyUI :8188 não responde após boot | Cold start em progresso (~30s) | Aguarde, depois `tail /workspace/comfyui.log` |
| `Connection refused` em `pod.sh ssh` | Porta SSH externa mudou após restart | `./pod.sh up` re-busca a porta automaticamente |

## Arquivos relevantes (no Pod)

```
/workspace/
├── ComfyUI/
│   ├── main.py              # entrypoint
│   ├── venv/                # Python venv (--system-site-packages)
│   ├── models/
│   │   ├── unet/flux1-schnell.safetensors
│   │   ├── vae/ae.safetensors
│   │   └── clip/{t5xxl_fp8_e4m3fn,clip_l}.safetensors
│   ├── output/              # imagens geradas
│   └── test-workflow.json   # workflow exemplo
├── start.sh                 # boot script (sobe Ollama + ComfyUI)
├── start.sh.bak.<ts>        # backups das versões anteriores
├── comfyui.log              # log do servidor ComfyUI
├── ollama.log               # log do servidor Ollama
├── .ollama/                 # modelos Ollama (qwen2.5-coder:14b)
├── .hf-token                # token HuggingFace (chmod 600)
└── .authorized_keys.bak     # backup SSH key (restaurado no boot)
```
