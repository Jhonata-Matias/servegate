# gemma4 FLUX — Google Colab Examples

Scripts Python standalone para testar o endpoint FLUX Serverless (Story 2.1) direto do Colab.

## `flux_demo.py`

Quickstart — submete job async, faz polling, decodifica PNG e exibe inline.

### Como usar

**Opção 1: copy-paste**
1. Abra https://colab.research.google.com/ e crie um novo notebook
2. Copie o conteúdo de `flux_demo.py` inteiro em uma célula
3. Execute (`Shift+Enter`)
4. Cole seu `RUNPOD_API_KEY` no prompt quando solicitado
5. Imagem será exibida inline + salva como `gemma4_output.png`

**Opção 2: upload file**
1. Colab → `File → Upload notebook` OU faça upload do `flux_demo.py` direto
2. Crie célula com `%run flux_demo.py`
3. Mesmo flow acima

**Opção 3: GitHub direct** (se repo for público no futuro)
```
https://colab.research.google.com/github/Jhonata-Matias/gemma4/blob/main/examples/colab/flux_demo.py
```
(Repo atualmente é privado — use Opção 1 ou 2.)

### Cost expectations

- **Cold start** (primeira run OU após >5min idle): 60-180s wall, ~$0.02-0.05
- **Warm** (runs subsequentes em <5min): 5-10s wall, ~$0.002-0.004
- Reference: ADR-0001 Path A (accept cold, mitigate via warmup pattern)

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

- `RUNPOD_API_KEY` é coletado via `getpass()` (não logado, não aparece em output)
- Não commite seu API key no notebook
- Em produção (não Colab demo), use Gateway (Story 2.5) com X-API-Key em vez de RUNPOD_API_KEY direto

### Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `401 Unauthorized` | API key inválido | Verifique scope `write:workers` em RunPod dashboard |
| Timeout >5min | Cold persistente ou endpoint unhealthy | Check RunPod dashboard → endpoint logs |
| `image_b64 ausente` | Handler failure | Inspect response em `print(result)` antes de decode |
| Imagem aparece muito ruim | Prompt vago ou steps muito baixo | Aumente steps para 6-8; refine prompt |

### Related

- Endpoint ID: `80e45g6gct1opm`
- Story: `docs/stories/2.1.runpod-serverless-flux-endpoint.story.md`
- Para produção via SDK + Gateway: Story 2.2 (`@jhonata-matias/flux-client`) + Story 2.5 (Cloudflare Worker)
