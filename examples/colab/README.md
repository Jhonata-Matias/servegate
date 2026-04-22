# servegate FLUX — Google Colab Examples

Scripts Python standalone para gerar imagens via servegate (ex-gemma4) alpha gateway direto do Colab.

> **Alpha invite-only:** você precisa de um `GATEWAY_API_KEY` para usar. Request via [issue template](https://github.com/Jhonata-Matias/servegate/issues/new/choose) — manual review 3-7 business days.

## `flux_demo.py`

Quickstart — single sync POST ao gateway com retry-on-cold, decodifica PNG e exibe inline.

### Como usar

**Opção 1: copy-paste**
1. Abra https://colab.research.google.com/ e crie um novo notebook
2. Copie o conteúdo de `flux_demo.py` inteiro em uma célula
3. Execute (`Shift+Enter`)
4. Cole seu `GATEWAY_API_KEY` no prompt quando solicitado
5. Imagem será exibida inline + salva como `gemma4_output.png`

**Opção 2: upload file**
1. Colab → `File → Upload notebook` OU faça upload do `flux_demo.py` direto
2. Crie célula com `%run flux_demo.py`
3. Mesmo flow acima

**Opção 3: GitHub direct** (repo público)
```
https://colab.research.google.com/github/Jhonata-Matias/servegate/blob/main/examples/colab/flux_demo.py
```

### Latency expectations

- **Cold start** (primeira run OU após >5min idle): 60-180s wall (1-2 retries enquanto worker aquece, depois 200 OK)
- **Warm** (runs subsequentes em <5min idle): 5-10s wall
- Reference: ADR-0001 Path A (accept cold, mitigate via SDK warmup ou retry-on-504 pattern)

### Customization

Edite `DEFAULT_INPUT` no script ou chame `generate()` com overrides:

```python
generate({
    "prompt": "your custom prompt here",
    "seed": 42,
    "steps": 4,      # 4 para FLUX.1-schnell (otimizado); mais steps = mais detalhes mas mais lento
    "width": 1024,   # múltiplo de 64, max recomendado 1536
    "height": 1024,
})
```

### Security

- `GATEWAY_API_KEY` é coletado via `getpass()` (não logado, não aparece em output)
- **Server-side only:** nunca commite seu API key no notebook ou em código que vá pra produção
- A `GATEWAY_API_KEY` autentica via `X-API-Key` header — não confunda com `RUNPOD_API_KEY` (esse é interno ao gateway, não exposto a clients)

### Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `401 Unauthorized` | `GATEWAY_API_KEY` inválido ou ausente | Verifique key (case-sensitive); request nova via issue template se rotação necessária |
| `429 Rate limit exhausted` | Quota global 100/dia esgotada | Aguarde reset 00:00 UTC; veja `reset_at` em response body |
| `Esgotaram retries por timeout` | Cold persistente >180s ou upstream degradado | Aguarde alguns minutos; reporte via bug-report issue se persistir |
| `image_b64 ausente` | Upstream handler failure | Reporte via bug-report; cole `print(result)` antes de decode |
| Imagem aparece muito ruim | Prompt vago ou steps muito baixo | Aumente steps para 6-8; refine prompt |

### Related

- **API Reference:** [`docs/api/reference.md`](../../docs/api/reference.md) — HTTP contract completo
- **Onboarding:** [`docs/usage/dev-onboarding.md`](../../docs/usage/dev-onboarding.md) — 5-step quickstart
- **TypeScript SDK** (alternativa com retry built-in + warmup helper): [`@jhonata-matias/flux-client`](../../sdk/README.md)
- **Architecture:** [ADR-0001 cold-start](../../docs/architecture/adr-0001-flux-cold-start.md)
