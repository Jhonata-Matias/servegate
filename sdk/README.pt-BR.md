# `@jhonata-matias/flux-client`

[![alpha](https://img.shields.io/badge/status-alpha-orange)](../docs/legal/TERMS.pt-BR.md) [![license MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

SDK TypeScript para o gateway servegate de geração e edição de imagens. O SDK encapsula o contrato assíncrono `POST /jobs` + `GET /jobs/{id}` e expõe erros tipados para UX.

## Status Alpha

Este SDK está em alpha (`v0.x`). Breaking changes podem ocorrer antes do beta. Leia os [Termos](../docs/legal/TERMS.pt-BR.md) e a [Privacidade](../docs/legal/PRIVACY.pt-BR.md) antes de usar.

## Instalação

Configure `.npmrc` no projeto consumer:

```text
@jhonata-matias:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

```bash
npm install @jhonata-matias/flux-client
```

Requisito: Node.js >= 18.

## Quickstart

```typescript
import { FluxClient, TimeoutError, RateLimitError, AuthError } from '@jhonata-matias/flux-client';

const client = new FluxClient({
  apiKey: process.env.GATEWAY_API_KEY!,
  gatewayUrl: process.env.GATEWAY_URL!,
});

try {
  const result = await client.generate({
    prompt: 'a peaceful zen garden with cherry blossoms, photorealistic',
    steps: 4,
    width: 1024,
    height: 1024,
  });
  console.log(result.output.image_b64);
} catch (e) {
  if (e instanceof TimeoutError) console.error(e.cause);
  else if (e instanceof RateLimitError) console.error(e.retry_after_seconds);
  else if (e instanceof AuthError) console.error('auth failed');
  else throw e;
}
```

## Edição de imagem

`v0.3.0` adiciona `client.edit()` para image-to-image usando Qwen-Image-Edit. É uma mudança estritamente aditiva: `generate()`, `GenerateInput`, `GenerateOutput` e os erros tipados continuam compatíveis com `v0.2.x`.

```typescript
import { FluxClient, ValidationError } from '@jhonata-matias/flux-client';
import { readFileSync, writeFileSync } from 'node:fs';

const client = new FluxClient({
  apiKey: process.env.GATEWAY_API_KEY!,
  gatewayUrl: process.env.GATEWAY_URL!,
});

try {
  const result = await client.edit({
    prompt: 'make the jacket green while keeping the background unchanged',
    image: readFileSync('input.png'),
    strength: 0.85,
    steps: 8,
    seed: 42,
  });

  writeFileSync('edited.png', Buffer.from(result.output.image_b64, 'base64'));
  console.log(result.output.metadata.output_width, result.output.metadata.output_height);
} catch (e) {
  if (e instanceof ValidationError) console.error(e.field, e.reason);
  else throw e;
}
```

`EditInput.image` aceita `Buffer`, `Uint8Array`, `Blob` ou string base64. Validações client-side:

- imagens `1:1` são rejeitadas por causa de um gotcha conhecido do Qwen-Image-Edit
- payload decodado precisa ter `<= 8 MB`
- imagem acima de `1 MP` é rejeitada por padrão; em Node.js, use `autoDownsample: true` com `sharp` instalado para downsample opt-in
- apenas PNG, JPEG e WebP são aceitos por magic bytes
- `strength` precisa estar em `(0.0, 1.0]`; `steps` em `4-50`

Troubleshooting:

- Se o output parecer com zoom ou aspect ratio deslocado, o handler redimensiona o PNG final para as dimensões efetivas do input e retorna metadata com dimensões originais do Qwen e dimensões finais.
- Se o background mudar, seja explícito no prompt: "keep the background unchanged".
- HEIC/HEIF não é aceito em `v0.3.0`; converta para PNG/JPEG/WebP antes de chamar `edit()`.

## Proveniência de Licença do Modelo

O SDK continua sob licença MIT. A inferência de edição roda em infraestrutura própria com componentes Qwen-Image-Edit documentados no ADR-0003: UNet Qwen-Image-Edit, encoder Qwen2.5-VL e Qwen VAE sob Apache 2.0. O artefato Lightning 8-step LoRA deve ser verificado por `@devops` antes do upload; se não houver LoRA compatível, o deploy usa fallback Apache-only de 50 steps.

## Referências

- [API Reference](../docs/api/reference.md)
- [Onboarding do Dev](../docs/usage/dev-onboarding.pt-BR.md)
- [ADR-0003](../docs/architecture/adr-0003-image-to-image-model-selection.md)
- [CHANGELOG](./CHANGELOG.md)

## Licença

MIT — veja `LICENSE`.
