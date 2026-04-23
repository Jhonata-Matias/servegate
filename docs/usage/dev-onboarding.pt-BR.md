# Onboarding do Dev — servegate FLUX API (Alpha)  *(anteriormente gemma4)*

> 🌐 [English](./dev-onboarding.md) | **Português (Brasil)**

**Status:** Alpha (invite-only)
**SDK:** `@jhonata-matias/flux-client@0.2.x` (GitHub Packages, **público** desde 2026-04-22)
**Gateway:** `https://gemma4-gateway.jhonata-matias.workers.dev` *(async submit/poll desde 2026-04-23)*

Comece a gerar imagens FLUX via API autenticada em ~15 minutos.

> ⚠️ **Upgrading a partir da v0.1.x?** O gateway mudou para async submit/poll em 2026-04-23 (INC-2026-04-23-gateway-504). O endpoint legado `POST /` agora retorna 404. O SDK `v0.2.0` cuida do novo contrato de forma transparente — só atualize o install. O `ColdStartError` foi removido em favor de `TimeoutError` (com discriminador `.cause`). Notas completas de migração: [`docs/api/migration-async.md`](../api/migration-async.md) (em inglês).

## Antes de começar

1. **Leia os [Termos de Uso](../legal/TERMS.pt-BR.md)** — especialmente a política de uso aceitável
2. **Leia a [Declaração de Privacidade](../legal/PRIVACY.pt-BR.md)** — entenda o que logamos e o que não logamos
3. **Concorde com o status alpha** — sem SLA, breaking changes esperadas, SDK v0.x

Se isso não funcionar para o seu caso de uso, por favor não peça acesso agora; aguarde o beta ou faça fork do repo.

## Passo 1 — Peça acesso (API key)

O acesso é invite-only durante o alpha. Para pedir uma `GATEWAY_API_KEY`:

### Opção A: issue no GitHub (preferida)

1. Vá para https://github.com/Jhonata-Matias/servegate/issues/new/choose
2. Selecione o template **"Alpha Access Request"** — preencha os campos obrigatórios (nome, GitHub username, caso de uso, volume esperado, aceite dos ToS/Privacy). Opcionalmente cole uma chave pública GPG ou age para entrega criptografada da `GATEWAY_API_KEY`.
3. Submeta a issue. O owner revisa em **3–7 dias úteis** (revisão manual — projeto pessoal).
4. O owner responde com:
   - `GATEWAY_API_KEY` — entregue via GitHub DM por padrão, ou pelo canal criptografado que você especificar.
   - Sua alocação efetiva de rate limit (padrão: fair share de 100/dia global).
   - Confirmação de onboarding.

### Opção B: contato direto

Para casos onde uma issue pública não é apropriada (avaliação enterprise com NDA, disclosure sensível), envie um GitHub DM para [@Jhonata-Matias](https://github.com/Jhonata-Matias). O mesmo processo de revisão se aplica.

## Passo 2 — Instale o SDK

### TypeScript / Node.js 18+

**2a. Configure o `.npmrc` no seu projeto:**

```
@jhonata-matias:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Onde `GITHUB_TOKEN` é seu Personal Access Token com scope `read:packages`:
- Gere em https://github.com/settings/tokens (classic token)
- Selecione o scope: `read:packages`
- Export: `export GITHUB_TOKEN=ghp_xxx...`
- Ou adicione ao seu `.env` (não comite)

**2b. Instalar:**

```bash
npm install @jhonata-matias/flux-client
```

Verificar a instalação:
```bash
node -e "console.log(require('@jhonata-matias/flux-client').FluxClient.name)"
# Esperado: FluxClient
```

### Python / Colab (sem SDK)

Veja `examples/colab/flux_demo.py` para um quickstart Python standalone usando `requests`. Substitua a chamada ao endpoint RUNPOD pela URL do gateway e inclua o header `X-API-Key`.

**Nota:** um SDK Python oficial não está no escopo do alpha. Se precisar, você pode portar os patterns do SDK TypeScript (retry + warmup + typed errors) para Python.

## Passo 3 — Configure as credenciais no seu app

**Somente server-side** — NUNCA coloque a `GATEWAY_API_KEY` em bundle JS de browser ou em código client-facing.

```typescript
// .env (gitignored)
GATEWAY_URL=https://gemma4-gateway.jhonata-matias.workers.dev
GATEWAY_API_KEY=<sua-key-emitida>
```

```typescript
// server code (ex.: Next.js API route, Express handler, Lambda)
import { FluxClient, TimeoutError, RateLimitError, AuthError } from '@jhonata-matias/flux-client';

const client = new FluxClient({
  apiKey: process.env.GATEWAY_API_KEY!,
  gatewayUrl: process.env.GATEWAY_URL!,
});
```

## Passo 4 — Primeira imagem

```typescript
// Faça pre-warm no init do app para evitar cold start na primeira request
await client.warmup();
console.log('is warm:', client.isWarm()); // true

// Generate
try {
  const result = await client.generate({
    prompt: 'a peaceful zen garden with cherry blossoms, photorealistic',
    steps: 4,
    width: 1024,
    height: 1024,
    seed: 42,
  });

  // result.output.image_b64 é o PNG codificado em base64
  console.log('image size:', result.output.image_b64.length);
  console.log('elapsed:', result.output.metadata.elapsed_ms, 'ms');

  // Salve ou retorne ao client
  const buf = Buffer.from(result.output.image_b64, 'base64');
  // fs.writeFileSync('out.png', buf);
} catch (e) {
  if (e instanceof TimeoutError) {
    // Poll budget esgotado, gateway retornou 504, OU RunPod TIMED_OUT
    // e.cause ∈ { 'poll_exhausted' | 'gateway_504' | 'runpod_timeout' }
    // Recomendado: mostrar UX de "servidor demorando mais que o normal", retry depois
    console.error(`timeout (${e.cause})${e.elapsedMs ? ` após ${e.elapsedMs}ms` : ''}`);
  } else if (e instanceof RateLimitError) {
    // Limite diário global atingido (100/dia no alpha)
    console.error(`rate limit. retry in ${e.retry_after_seconds}s (resets at ${e.reset_at})`);
  } else if (e instanceof AuthError) {
    // API key inválida ou revogada
    console.error('auth failed — check GATEWAY_API_KEY');
  } else {
    throw e;
  }
}
```

## Passo 5 — Patterns production-ready

### Retry handling

A config default de retry do SDK é ajustada para cenários de cold start (primeira tentativa 180s, seguintes 30s, máx 3 retries, exponential backoff 1s/2s/4s). Para a sua aplicação:

- **Latency-sensitive (web UX):** use `client.warmup()` no start do app; mostre loading state por ≤2min na primeira visita do usuário
- **Processamento em batch (scripts):** aceite as cold penalties; use os retries default
- **High-throughput:** esteja ciente do cap global de 100/dia durante o alpha

### Input validation

O SDK valida `GenerateInput` estritamente (sem coerção). Gotchas comuns:

- `steps` precisa ser inteiro > 0 (FLUX.1-schnell funciona melhor com `steps=4`)
- `width`/`height` precisam ser inteiros positivos (recomendado: múltiplos de 64, máx ~1536)
- `seed` é inteiro opcional para reprodutibilidade
- `prompt` precisa ser string não-vazia

Input inválido lança `ValidationError` pre-network — sem custo, feedback imediato.

### Checklist de deploy em produção

Antes de fazer deploy do seu app usando a servegate FLUX API em produção:

- [ ] `GATEWAY_API_KEY` apenas no ambiente server-side (não no bundle client)
- [ ] Warmup chamado no init do app OU antes da primeira request esperada do usuário
- [ ] Tratamento de erros tipado para `TimeoutError` (com discriminador `.cause`), `RateLimitError`, `AuthError`, `NetworkError`
- [ ] UI graceful para espera de cold start (até 180s na primeira vez)
- [ ] Monitoring: track warmup latency, generate latency, error rates
- [ ] Budget alert: se o uso se aproximar do cap diário, implemente queueing
- [ ] Content moderation: FLUX é unfiltered; adicione classifier antes de publicar outputs

## Passo 6 — Gestão de key

### Rotação

Recomendada a cada 90 dias ou on-demand se:
- Suspeita de vazamento (key visível em logs de erro, repo, backup)
- Saída de desenvolvedor
- Incidente de segurança

**Processo:**
1. Peça uma nova key via nova issue no GitHub (mencione o fingerprint da key antiga, não o valor)
2. Owner emite nova key + revoga a antiga
3. Atualize `GATEWAY_API_KEY` no seu env
4. Faça redeploy do seu app
5. Verifique: key antiga retorna 401; key nova retorna 200

### Revogação (emergência)

Se a key foi comprometida **agora**:

1. Abra issue no GitHub com `security-incident` **imediatamente**
2. Owner rotaciona o gateway secret em horas (target de resposta no mesmo dia)
3. Seu app vai começar a receber 401s até você atualizar para a nova key

## Troubleshooting

| Sintoma | Causa provável | Ação |
|---|---|---|
| 401 Unauthorized | Key errada ou revogada | Verifique `GATEWAY_API_KEY` no env; contate o owner |
| 429 Too Many Requests | Limite global de 100/dia atingido | Aguarde até `reset_at` (próximo 00:00 UTC); planeje dentro da quota |
| 504 Gateway Timeout | Job RunPod expirou (>280s `COMFY_GENERATION_TIMEOUT`) | SDK captura como `TimeoutError({cause: 'gateway_504'})`; retry em 5 min |
| 502 Upstream Error | Endpoint RunPod com 5xx | Reporte via issue — owner investiga |
| Erros de tipo no `import` | `.npmrc` mal configurado | Verifique a linha `@jhonata-matias:registry=...` + token |
| `npm install` 404 | Token sem scope `read:packages` | Regenere o GitHub token com o scope correto |

## FAQ

**P: Posso usar isso em um produto comercial?**
R: Durante o alpha, não. O serviço é apenas para avaliação. Para uso comercial, aguarde o beta OU contate o owner com as especificidades.

**P: O SDK é open source?**
R: O código-fonte do SDK está no repo sob licença MIT, mas o package é publicado em um registry GitHub Packages privado. Você pode fazer fork e self-host se precisar.

**P: Posso fazer self-host do gateway?**
R: Sim. O código-fonte do gateway está em `gateway/` — faça deploy na sua própria conta Cloudflare seguindo `docs/usage/gateway-deploy.md` (em inglês). Você vai precisar da sua própria `RUNPOD_API_KEY`.

**P: O que acontece quando o alpha terminar?**
R: Sem timeline fixo. A transição para beta vai incluir: SDK estável v1.0.0, SLA formal, signup público (sem invite), potencial modelo de custo.

**P: Posso ajudar / contribuir?**
R: Sim! PRs são bem-vindos. Veja as stories existentes em `docs/stories/` (em inglês) para trabalho planejado. Especialmente úteis: port do SDK para Python, integrações com providers alternativos, middleware de content moderation.

## Referências

- [Termos de Uso](../legal/TERMS.pt-BR.md)
- [Declaração de Privacidade](../legal/PRIVACY.pt-BR.md)
- [Monitoring & abuse reporting](./monitoring.md) (em inglês)
- [Gateway deploy guide (self-host)](./gateway-deploy.md) (em inglês)
- [ADR-0001: Cold-start strategy](../architecture/adr-0001-flux-cold-start.md) (em inglês)
- [SDK CHANGELOG](../../sdk/CHANGELOG.md) (em inglês)

---

**Document version:** 0.1.0-alpha (2026-04-21)
**Próximo gatilho de revisão:** lançamento do beta OU SDK v1.0.0 OU mudança significativa de processo
