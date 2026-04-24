# Declaração de Privacidade — servegate FLUX API (Alpha)  *(anteriormente gemma4)*

> 🌐 [English](./PRIVACY.md) | **Português (Brasil)**

**Data de vigência:** 2026-04-21
**Versão:** 0.2.0-alpha

Resumo para devs com pressa: **nós não armazenamos seus prompts, imagens submetidas para edit, nem imagens geradas.** Os logs contêm apenas metadata da request (timestamp, IP, status, timing). API keys são criptografadas at rest.

---

## O que coletamos

### 1. Metadata de request da API (sempre logada)

Para cada request ao Serviço, o gateway (Cloudflare Worker) loga:

| Campo | Exemplo | Propósito |
|---|---|---|
| `timestamp` | `1745186400000` | Correlação de request |
| `event` | `proxy_success`, `auth_failed`, `rate_limited` | Debug + detecção de abuso |
| `ip` | `203.0.113.42` (header `CF-Connecting-IP` do Cloudflare) | Tracking de abuso + rate limit |
| `status` | `200`, `401`, `429`, `504` | Monitoramento de performance |
| `elapsed_ms` | `7234` | Tracking de SLA de latência |
| `day_count` | `42` | Estado do rate limit |

**Visibilidade:** acessível via `wrangler tail` (owner apenas). Não exposto em dashboards públicos.

**Retenção:** logs do Cloudflare Worker retidos conforme a retenção padrão do Cloudflare (~7 dias no free tier).

### 2. API keys (criptografadas at rest)

- Sua API key pessoal é armazenada como um Cloudflare Worker secret (criptografado com o KMS do Cloudflare)
- As keys são **nunca logadas**, **nunca retornadas em responses** e **nunca visíveis** via qualquer API
- Rotação: o owner pode rotacionar via `wrangler secret put` (invalida a key antiga)

### 3. Dados de billing (RunPod)

O RunPod mantém registros de billing independentes por invocação de endpoint. Esses registros incluem:
- Timestamp da invocação
- Tempo de GPU consumido
- Status de sucesso/falha

O owner acessa isso via a billing API do RunPod para revisão mensal de custo. Sem atribuição por usuário.

## O que NÃO coletamos

O seguinte **NUNCA é logado, armazenado ou persistido** pelo gateway:

- ❌ **Conteúdo do prompt** — suas strings de prompt são encaminhadas para o RunPod e descartadas imediatamente após a response
- ❌ **Imagens submetidas para edit** — `input_image_b64` é processado apenas in-flight e não é logado, retido ou usado para melhoria de modelo
- ❌ **Bytes da imagem gerada** — o payload `image_b64` passa pelo gateway sem logging; descartado após a response
- ❌ **Corpos de request** de qualquer forma (prompt + params)
- ❌ **Corpos de response** além dos HTTP status codes
- ❌ **Identificadores de usuário** além do endereço IP (sem email, sem nome, sem sistema de conta)
- ❌ **Cookies ou tracking pixels** (o gateway é uma API HTTP pura, sem superfície browser-facing)

**Verificação:** o código-fonte do gateway está em `gateway/src/` deste repo. Pesquise por chamadas `log(` para auditar o que é emitido. Qualquer mudança futura que logue conteúdo de prompt/imagem exigiria code review.

## Fluxo de dados

```
┌────────────┐    POST /       ┌──────────┐   POST      ┌─────────────┐
│  Seu app   │ ──────────────► │ Gateway  │ ──────────► │ RunPod      │
│  (client)  │   X-API-Key     │ (CF)     │  Bearer     │ Serverless  │
└────────────┘                 └──────────┘             └─────────────┘
                                     │                         │
                                     ▼                         ▼
                              ┌─────────────┐           ┌──────────────┐
                              │ KV counter  │           │ FLUX model   │
                              │ (date→N)    │           │ (in-memory)  │
                              └─────────────┘           └──────────────┘

In-flight: prompt + image_b64, e input_image_b64 para jobs de edit
Logged:    apenas metadata (sem conteúdo de body)
Stored:    nada (nem prompt nem imagem persistidos server-side)
```

## Processadores de terceiros

O Serviço usa estes terceiros. Ao usar o Serviço, você aceita o processamento deles como parte do pipeline:

| Provider | Propósito | O que eles veem | Política de privacidade |
|---|---|---|---|
| **Cloudflare** | Hospedagem do gateway (Workers + KV) | IP, metadata de request, contador de rate limit | https://www.cloudflare.com/privacypolicy/ |
| **RunPod** | Inferência GPU (modelos FLUX e Qwen-Image-Edit) | Conteúdo do prompt, imagem submetida para edit, imagem gerada (todos apenas in-flight) | https://www.runpod.io/legal/privacy-policy |
| **Hugging Face** | Download dos pesos do modelo (durante cold init do worker) | N/A em runtime | https://huggingface.co/privacy |

**Nota sobre RunPod:** o Serviço faz proxy de prompts e, para jobs de edit, imagens submetidas para o worker RunPod Serverless existente. Nenhum provider separado de API hospedada de image-edit recebe a imagem. O owner não configura logging de conteúdo de prompt ou imagem no lado RunPod.

## Seus direitos (LGPD Brasil + GDPR EU)

Mesmo coletando dados mínimos, você tem direitos:

- **Acesso:** requisição de cópia dos logs relacionados ao seu IP dentro de uma janela de tempo (email ao owner via issue no GitHub)
- **Exclusão:** requisição de deleção de logs (limitado — retenção do Cloudflare ~7d deleta automaticamente)
- **Retificação:** não aplicável (não armazenamos dados pessoais)
- **Objeção:** parar de usar o Serviço = parar a coleta de dados
- **Portabilidade de dados:** não aplicável (sem dados de conta de usuário para exportar)

Tempo de resposta: 30 dias (padrão LGPD).

## Cookies

O Serviço é uma API HTTP pura. Nenhum cookie é definido pelo gateway. Se você usar o SDK a partir de um contexto browser, o SDK em si não define cookies.

## Analytics

O Serviço não usa web analytics (Google Analytics, Mixpanel, etc.) nos seus endpoints de API. Se um futuro web demo (Story 2.3) for deployado com Vercel Analytics, o escopo dele será documentado separadamente.

## Crianças

O Serviço não é direcionado a crianças abaixo de 13 anos (COPPA) ou 18 anos (LGPD para menores). O owner não coleta conscientemente dados de menores.

## Alterações

A Declaração de Privacidade pode ser atualizada. Mudanças materiais serão anunciadas via:

- Commit em `docs/legal/PRIVACY.md` e `docs/legal/PRIVACY.pt-BR.md` no repo
- Atualização do número de versão no topo deste arquivo

## Contato

- Dúvidas de privacidade: issue no GitHub com tag `privacy`
- Incidentes de segurança: issue no GitHub com tag `security-incident`
- Rotação de key: veja `docs/usage/dev-onboarding.pt-BR.md`

---

**Histórico de versões:**

| Versão | Data | Notas |
|---|---|---|
| 0.2.0-alpha | 2026-04-24 | Adicionada clareza de privacidade para image-to-image: imagens de input não são logadas, retidas ou usadas para melhoria de modelo |
| 0.1.0-alpha | 2026-04-21 | Declaração de Privacidade inicial do alpha — logs apenas de metadata, sem retenção de prompt/imagem |

---

## Equivalência Bilíngue

Ambas as versões em Inglês e Português (Brasil) desta Declaração de Privacidade são canônicas e igualmente vinculantes. Em caso de divergência, prevalece a versão correspondente ao país de domicílio do usuário.

Consulte também: [PRIVACY.md](./PRIVACY.md) (em inglês)
