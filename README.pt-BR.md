# servegate

> 🌐 [English](./README.md) | **Português (Brasil)**

**API FLUX text-to-image + Qwen-Image-Edit — alpha, autenticada, com rate limit.**

> Anteriormente `gemma4`. Renomeado para refletir o padrão generalizado de gateway-para-serverless-model. O hostname do Cloudflare Worker `gemma4-gateway.jhonata-matias.workers.dev` permanece inalterado para compatibilidade do SDK.

[![status: alpha](https://img.shields.io/badge/status-alpha-orange)](./docs/legal/TERMS.pt-BR.md)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue)](./sdk/LICENSE)
[![gateway: live](https://img.shields.io/badge/gateway-live-green)](https://gemma4-gateway.jhonata-matias.workers.dev)
[![SDK: v0.3.0](https://img.shields.io/badge/sdk-v0.3.0-brightgreen)](./sdk/README.md)
[![API: async submit/poll](https://img.shields.io/badge/api-async%20submit%2Fpoll-blue)](./docs/api/migration-async.md)

---

## O que é isso?

- **Uma API serverless de imagem** por trás de um gateway Cloudflare Worker autenticado: FLUX.1-schnell para text-to-image e Qwen-Image-Edit para image-to-image.
- **Para quem:** desenvolvedores TypeScript/Node.js que querem gerar ou editar imagens programaticamente sem hospedar infraestrutura GPU.
- **Status atual:** Alpha (invite-only). 100 imagens/dia como rate limit global. Sem SLA. Breaking changes esperadas.

## Quickstart

**Quer fazer sua primeira chamada na API?** Vá para o [Guia de Onboarding do Dev](./docs/usage/dev-onboarding.pt-BR.md) — 5 passos, ~15 minutos do pedido de acesso até a primeira imagem.

A API usa um contrato **async submit/poll** (desde 2026-04-23, INC-2026-04-23-gateway-504). O submit retorna `202 + job_id`; você faz poll até o job ficar `COMPLETED`. O SDK TypeScript cuida do polling de forma transparente; o HTTP raw fica assim:

```bash
# 1. Submit do job → 202 + {job_id, status_url, est_wait_seconds: "unknown"}
JOB=$(curl -sX POST https://gemma4-gateway.jhonata-matias.workers.dev/jobs \
  -H "X-API-Key: $GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"a zen garden, photorealistic","steps":4,"width":1024,"height":1024,"seed":42}' \
  | jq -r '.job_id')

# 2. Poll a cada 5s até 200 + {output: {image_b64, ...}} (cold start pode levar ~130s)
until OUT=$(curl -sf https://gemma4-gateway.jhonata-matias.workers.dev/jobs/$JOB \
  -H "X-API-Key: $GATEWAY_API_KEY" | jq -e '.output.image_b64' 2>/dev/null); do sleep 5; done

echo "$OUT" | tr -d '"' | base64 -d > out.png
```

Image-to-image usa o mesmo endpoint. Adicione `input_image_b64` para rotear o job para Qwen-Image-Edit:

```bash
INPUT_IMAGE_B64="$(base64 -w 0 input.png)"

JOB=$(curl -sX POST https://gemma4-gateway.jhonata-matias.workers.dev/jobs \
  -H "X-API-Key: $GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"prompt\":\"make the jacket green while keeping the background unchanged\",\"input_image_b64\":\"$INPUT_IMAGE_B64\",\"strength\":0.85,\"steps\":8}" \
  | jq -r '.job_id')
```

Para o caminho TypeScript (recomendado): `npm install @jhonata-matias/flux-client@^0.3.0` e depois `client.generate(...)` ou `client.edit(...)` — o polling é interno. Veja [Onboarding do Dev](./docs/usage/dev-onboarding.pt-BR.md).

## Links

| Recurso | Localização |
|---|---|
| Onboarding do Dev | [docs/usage/dev-onboarding.pt-BR.md](./docs/usage/dev-onboarding.pt-BR.md) |
| API Reference | [docs/api/reference.md](./docs/api/reference.md) (em inglês) |
| Async Migration Guide | [docs/api/migration-async.md](./docs/api/migration-async.md) (em inglês) |
| TypeScript SDK | [sdk/README.md](./sdk/README.md) (em inglês) |
| ADR image-to-image | [docs/architecture/adr-0003-image-to-image-model-selection.md](./docs/architecture/adr-0003-image-to-image-model-selection.md) (em inglês) |
| Exemplo Python / Colab | [examples/colab/README.md](./examples/colab/README.md) (em inglês) |
| Termos de Uso | [docs/legal/TERMS.pt-BR.md](./docs/legal/TERMS.pt-BR.md) |
| Declaração de Privacidade | [docs/legal/PRIVACY.pt-BR.md](./docs/legal/PRIVACY.pt-BR.md) |
| Monitoring runbook | [docs/usage/monitoring.md](./docs/usage/monitoring.md) (em inglês) |
| Arquitetura (ADR) | [docs/architecture/adr-0001-flux-cold-start.md](./docs/architecture/adr-0001-flux-cold-start.md) (em inglês) |

## Contato

**Canal primário (pedidos de acesso, bugs, ideias de feature):** [abra uma issue](https://github.com/Jhonata-Matias/servegate/issues/new/choose) usando um dos templates.

**SLA de resposta (alpha):** 3–7 dias úteis, best-effort. Este é um projeto pessoal — sem garantias de suporte enterprise durante o alpha.

**Entrega segura da API key:** após aprovação do pedido de acesso, o owner envia sua `GATEWAY_API_KEY` via GitHub DM (preferido) ou um canal criptografado que você especificar (inclua uma chave pública GPG/age na sua issue para entrega criptografada).

**Fallback:** GitHub DM para [@Jhonata-Matias](https://github.com/Jhonata-Matias) — reservado para casos onde uma issue pública não é apropriada (avaliação enterprise com NDA, disclosure sensível).

**Security issues:** por favor use [private vulnerability reporting](https://github.com/Jhonata-Matias/servegate/security/advisories/new) em vez de uma issue pública.

## Legal + expectativas alpha

- **Alpha = invite-only**: o acesso é controlado por emissão de `GATEWAY_API_KEY` (revisão manual, 3–7 dias).
- **Rate limit**: 100 imagens/dia globalmente entre todos os usuários — previne custo descontrolado durante o alpha.
- **Cold start**: a primeira chamada após um período idle pode levar ~130 segundos. O SDK lida com isso via `warmup()` + polling assíncrono transparente (desde v0.2.0).
- **Sem SLA**: projeto pessoal, uptime best-effort. Cloudflare Workers + RunPod Serverless fornecem os SLAs de plataforma subjacentes.
- **Breaking changes esperadas** em bumps de versão minor (pre-1.0). Siga [sdk/CHANGELOG.md](./sdk/CHANGELOG.md) (em inglês).

Ao usar a API você aceita os [Termos de Uso](./docs/legal/TERMS.pt-BR.md) e a [Declaração de Privacidade](./docs/legal/PRIVACY.pt-BR.md).

## Licença

MIT — veja [LICENSE](./sdk/LICENSE) (o SDK também cobre os artefatos públicos da API).
