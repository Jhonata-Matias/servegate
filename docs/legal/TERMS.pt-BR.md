# Termos de Uso — servegate FLUX API (Alpha)  *(anteriormente gemma4)*

> 🌐 [English](./TERMS.md) | **Português (Brasil)**

**Data de vigência:** 2026-04-21
**Versão:** 0.1.0-alpha
**Status:** ⚠️ **ALPHA — sem SLA de uptime, sem garantias de estabilidade, breaking changes esperadas**

Ao usar a servegate FLUX API (doravante "o Serviço"; anteriormente distribuído como "gemma4 FLUX API"), você concorda com estes Termos. Se não concorda, não use o Serviço.

---

## 1. Descrição do Serviço

O Serviço fornece acesso programático à geração de imagens usando o modelo FLUX.1-schnell hospedado no RunPod Serverless. Ele consiste em:

- **HTTP Gateway:** `https://gemma4-gateway.jhonata-matias.workers.dev` (autenticado)
- **TypeScript SDK:** `@jhonata-matias/flux-client` (GitHub Packages)
- **Modelo único:** black-forest-labs/FLUX.1-schnell (Apache 2.0)

## 2. Uso aceitável

Você concorda em NÃO usar o Serviço para:

1. **Gerar conteúdo ilegal**, incluindo mas não limitado a:
   - Child Sexual Abuse Material (CSAM)
   - Conteúdo que incite violência, terrorismo ou discurso de ódio
   - Conteúdo que viole leis aplicáveis no Brasil ou na sua jurisdição

2. **Gerar conteúdo sem consentimento**, incluindo:
   - Deepfakes não-consensuais de pessoas reais
   - Nudez ou conteúdo sexual retratando indivíduos reais sem consentimento explícito deles
   - Personificação de figuras públicas em contextos enganosos

3. **Burlar copyright**:
   - Reproduzir obras protegidas via prompts descritivos ("Mickey Mouse tomando café")
   - Tentativas de extração de dados de treino

4. **Abusar do Serviço**:
   - Exceder rate limits usando múltiplas keys
   - Scraping automatizado além dos rate limits documentados
   - Revender acesso à API sem permissão por escrito
   - Tentativas de DOS ou load testing sem coordenação prévia

5. **Gerar conteúdo enganoso**:
   - Imagens de fake news apresentadas como reais
   - Imagens de aconselhamento médico/jurídico/financeiro
   - Conteúdo facilitador de fraude (IDs falsos, documentos, assinaturas)

## 3. Responsabilidade pelo conteúdo

**Você é o único responsável** pelos prompts que submete e pelos outputs que gera. O Serviço não modera outputs; o FLUX é um modelo probabilístico e pode produzir conteúdo que você não pretendia. Você deve:

- Revisar todos os outputs antes de usá-los publicamente
- Aplicar moderação adicional em deploys de produção (ex.: via content classifier)
- Não afirmar que os outputs foram gerados por humanos (se usar comercialmente, divulgue a origem AI conforme leis aplicáveis como o EU AI Act)
- Atribuir corretamente: "generated with FLUX.1-schnell (Apache 2.0)"

## 4. API keys & acesso

- API keys são emitidas por desenvolvedor (veja `docs/usage/dev-onboarding.pt-BR.md`)
- As keys são pessoais — **não compartilhe, não comite, não embute em código client-side**
- Reporte keys comprometidas imediatamente via issue no GitHub com tag `security-incident`
- O owner se reserva o direito de revogar keys sem aviso por violações destes Termos

## 5. Rate limits & quotas

- **Limite global:** 100 imagens/dia no total entre todos os usuários (budget cap de free tier)
- **Limite por key:** varia por acordo com o dev (padrão: fair share da quota global)
- Exceder limites retorna HTTP 429 com header `Retry-After`
- Abuso ou uso excessivo sustentado pode resultar em revogação de key

## 6. Disclaimers do status alpha

- **Sem SLA de uptime:** endpoint único, sem redundância, owner único
- **Latência:** warm ~7s p95 validado empiricamente; cold first-invocation ~130s (per ADR-0001 Path A)
- **Breaking changes:** o SDK v0.x pode mudar a API sem aviso; notas de migração em `sdk/CHANGELOG.md` (em inglês)
- **Perda de dados:** outputs NÃO são armazenados server-side (veja Privacy) — salve o que gerar
- **Política de deprecation:** nenhuma política formal durante o alpha; anúncios via README do repo

## 7. Transparência de custo

O Serviço opera em escala best-effort de projeto pessoal:

- Cap de custo diário global: ~$3/dia (100 requests × $0.03 worst-case cold)
- Budget mensal: target ~$25/mês
- Se o budget for excedido: o owner pode suspender temporariamente o Serviço
- Sem modelo de pricing para end users durante o alpha

## 8. Privacidade

Veja `docs/legal/PRIVACY.pt-BR.md` para a declaração detalhada de privacidade. Resumo:

- Nós logamos: timestamp, IP, HTTP status, elapsed_ms, contador diário — **NÃO prompts nem bytes de imagem**
- Prompts e imagens são processados em in-flight apenas; não armazenados server-side
- API keys são criptografadas at rest (Cloudflare Worker secrets)

## 9. Propriedade intelectual

- **Modelo FLUX:** Apache 2.0 (black-forest-labs/FLUX.1-schnell)
- **Seus prompts:** você mantém a propriedade
- **Imagens geradas:** você é dono do output (sujeito à licença do modelo e às leis aplicáveis sobre obras geradas por AI na sua jurisdição)
- **Código SDK/Gateway:** licença MIT

## 10. Limitação de responsabilidade

Na máxima extensão permitida por lei, o Serviço é fornecido **AS IS**, sem garantias de qualquer tipo. O owner não é responsável por:

- Downtime do Serviço, perda de dados ou oportunidades perdidas
- Falhas de content moderation (outputs violando suas expectativas)
- Ações de terceiros (quedas de RunPod, Cloudflare, GitHub Packages)
- Uso indevido por outros usuários afetando quotas compartilhadas

Responsabilidade máxima: o valor que você pagou pelo Serviço (atualmente $0 durante o alpha).

## 11. Rescisão

O owner pode encerrar o acesso a qualquer momento, com ou sem causa. Você pode parar de usar o Serviço a qualquer momento simplesmente não enviando requests.

## 12. Alterações

Estes Termos podem ser atualizados. Mudanças materiais serão anunciadas via:

- Commit em `docs/legal/TERMS.md` e `docs/legal/TERMS.pt-BR.md` no repo
- Atualização do número de versão no topo deste arquivo

Uso continuado após atualização = aceitação.

## 13. Jurisdição

Estes Termos são regidos pelas leis do Brasil. Disputas serão resolvidas nos tribunais da jurisdição do owner.

## 14. Contato

- Issues / reports de abuso: issues no GitHub em `Jhonata-Matias/servegate` (tag: `security-incident` ou `abuse-report`)
- Pedidos de key: veja `docs/usage/dev-onboarding.pt-BR.md`

---

**Histórico de versões:**

| Versão | Data | Notas |
|---|---|---|
| 0.1.0-alpha | 2026-04-21 | Termos iniciais do alpha — projeto pessoal de owner único |

---

## Equivalência Bilíngue

Ambas as versões em Inglês e Português (Brasil) destes Termos são canônicas e igualmente vinculantes. Em caso de divergência, prevalece a versão correspondente ao país de domicílio do usuário.

Consulte também: [TERMS.md](./TERMS.md) (em inglês)
