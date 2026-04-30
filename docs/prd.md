# servegate Docs Portal Product Requirements Document (PRD)

## Goals and Background Context

### Goals

- Publish a clear, developer-first documentation portal for servegate at the Vercel-hosted `web/docs` site.
- Replace the prior single-page landing experience with navigable product documentation that supports onboarding, API reference, SDK usage, errors, and operational reports.
- Make the public docs the canonical entry point for alpha users evaluating or integrating servegate.
- Improve the didactic presentation of the docs so readers understand capabilities in a natural order before encountering edge cases and errors.
- Use human-friendly, task-oriented titles instead of internal or overly technical labels where the reader's intent is more important than implementation details.
- Preserve the existing dark brand direction from the landing page while using Astro Starlight conventions for maintainability, search, navigation, and accessibility.
- Keep documentation deployment simple: Vercel project root points to `web/docs`, Astro builds static output to `dist`, and no custom `vercel.json` is required.
- Ensure docs content stays consistent with the current alpha surface: image jobs via async submit/poll, TypeScript SDK, error taxonomy, Gemma text generation, and RunPod video capacity reporting.

### Background Context

servegate exposes an authenticated gateway for image generation/editing and text generation. The product now has enough public-facing surface area that a single marketing landing page is no longer sufficient for developer adoption. Users need a structured docs portal that explains what servegate is, how to request access, how to make the first request, how the API behaves, how the SDK maps errors, and which experimental capabilities are ready versus blocked.

The current docs app already contains the essential content, but the product need is broader than content presence. The portal must organize material in the order a developer learns: first what the product does, then how to start, then each capability, then reference details, and only then troubleshooting/error handling. Sections such as text generation must not feel buried after errors or implementation details, and page/section titles must read like user-facing documentation rather than internal labels.

The repository already contains an Astro Starlight docs app at `web/docs`, configured for the public Vercel site `https://deploy-lp-one.vercel.app`. It includes pages for Welcome, Quickstart, API Reference, SDK, Errors, and a RunPod Video Capacity Report. This PRD scopes the product requirements for that documentation portal as the published developer-facing surface, not for changing the underlying gateway or model runtime.

### Change Log

| Date | Version | Description | Author |
|---|---:|---|---|
| 2026-04-30 | 0.1 | Reframed PRD around the Vercel-published servegate documentation portal. | Morgan |
| 2026-04-30 | 0.2 | Added target information architecture, editorial title rules, and MVP scope for didactic reorganization. | Morgan |

## Requirements

### Functional

FR1: The docs portal must be served from the `web/docs` Astro Starlight application.

FR2: The deployed public site must use `https://deploy-lp-one.vercel.app` as its configured canonical site URL until a custom domain is introduced.

FR3: The Vercel project must use `web/docs` as the root directory, run `pnpm build`, and publish the Astro `dist` output.

FR4: The portal must include a Welcome page that explains servegate's alpha status, core capabilities, latest server/SDK versions, and primary navigation paths.

FR5: The portal must include a Quickstart page that lets a developer submit and poll a text-to-image job with curl.

FR6: The Quickstart page must also cover single-image and multi-image image editing using the same `POST /jobs` endpoint.

FR7: The portal must include an API Reference page covering `POST /jobs`, `GET /jobs/{job_id}`, and `POST /v1/generate`.

FR8: The API Reference must document required headers, request bodies, accepted responses, polling behavior, rate-limit headers, successful output shape, and text streaming behavior.

FR9: The portal must include a TypeScript SDK page covering package installation, client configuration, `generate()`, `edit()`, multi-image editing, and typed error handling.

FR10: The portal must include an Errors page with HTTP status codes, `i2i_validation` variants, multi-image `field` attribution, and SDK error class mapping.

FR11: The portal must include the RunPod Video Capacity Report as a clearly marked preliminary/decision-boundary document.

FR12: The sidebar must expose the target information architecture defined in this PRD: Welcome, Quickstart, Capabilities, Reference, and Reports.

FR13: The portal must provide GitHub social/edit links pointing at the public servegate repository.

FR14: The portal must preserve static search through Starlight/Pagefind so users can search docs without an external service or API key.

FR15: Content authors must be able to add or edit docs by changing MDX files under `web/docs/src/content/docs` and updating `astro.config.mjs` sidebar entries when needed.

FR16: The old `web/landing` page must remain outside the active docs deploy path and must not be treated as the current product surface.

FR17: The docs portal must organize content by reader journey: overview, access/prerequisites, first successful call, image generation/editing, text generation, API reference, SDK usage, errors/troubleshooting, and operational reports.

FR18: The API Reference must present endpoint groups in a didactic order that introduces core capabilities before error details; text generation must appear as a first-class capability, not as an afterthought below error-oriented content.

FR19: Page titles, sidebar labels, card titles, and section headings must be human-friendly and task-oriented, using labels such as "Generate images", "Edit images", "Generate text", "Check job status", and "Handle errors" where they communicate better than raw endpoint names.

FR20: The docs must include short transition text between major sections so readers understand why the next section exists and when to use it.

FR21: The docs portal must implement the target information architecture in this PRD unless a story explicitly records an approved deviation.

FR22: The API Reference must use a repeated section pattern for each capability: "When to use this", "Endpoint", "Request", "Response", and "Common mistakes".

FR23: Error taxonomy details must live primarily on the Errors page; API Reference may include only capability-specific error notes and links to the full error guide.

### Non Functional

NFR1: The docs portal must remain static-build friendly and not require a backend service to render documentation.

NFR2: Production builds must pass with `pnpm build` from `web/docs`.

NFR3: Type/content validation should pass with `pnpm typecheck` from `web/docs` before publishing material changes.

NFR4: Broken internal links must fail the build or be caught before release through Astro/Starlight validation.

NFR5: The portal must preserve the dark-only V1 brand theme, including the existing obsidian background and blue accent palette.

NFR6: The theme must avoid exposing a light/dark switch in V1 because light mode is explicitly deferred.

NFR7: The docs must be readable by first-time developers and must avoid requiring readers to understand internal ADRs or story files before making a first API call.

NFR8: API examples must avoid real secrets and must use environment variable placeholders such as `GATEWAY_API_KEY`.

NFR9: Published docs must clearly label alpha/preliminary capabilities and avoid implying production SLA where none exists.

NFR10: The portal must avoid publishing local artifacts, generated build output, dependency folders, Vercel metadata, Lighthouse browser artifacts, environment files, or logs.

NFR11: Documentation updates must not alter gateway, SDK, or serverless runtime behavior unless a separate implementation story explicitly scopes that work.

NFR12: The portal should support basic SEO through page titles, descriptions, canonical site configuration, sitemap generation, and static crawlable pages.

NFR13: Documentation structure must optimize for comprehension, not only completeness; a reader should not need to infer the product model from endpoint order alone.

NFR14: Headings must avoid internal jargon unless paired with a plain-language explanation.

## User Interface Design Goals

### Overall UX Vision

The docs portal should feel like a concise developer handbook rather than a marketing site. A new alpha user should land on Welcome, understand what servegate does, go to Quickstart, make a first authenticated request, and then deepen into API/SDK/error references only as needed.

The experience must teach by progressive disclosure. Capability pages and reference sections should start with plain-language intent ("Generate an image", "Edit an image", "Generate text") before showing raw endpoint names, JSON schemas, status codes, or validation errors.

### Key Interaction Paradigms

- Sidebar-first navigation using Astro Starlight's documentation layout.
- Card-based entry points from the Welcome page for the most common user intents.
- Tabbed examples for curl responses and SDK variants.
- Caution/note/tip asides for alpha constraints, compatibility notes, and decision boundaries.
- Reader-journey ordering: capability explanation before endpoint reference, endpoint reference before errors, errors before deep operational reports.
- Human-friendly headings that answer "what can I do here?" before "which endpoint is this?"
- Search as a local static affordance, not a remote support tool.

### Core Screens and Views

- Welcome
- Quickstart
- Generate images
- Edit images
- Generate text
- API Reference
- SDK (TypeScript)
- Handle errors
- RunPod Video Capacity Report
- 404 page

### Accessibility

Target: WCAG AA where supported by Starlight defaults and local theme overrides.

### Branding

The portal should preserve the dark servegate look from the previous landing page: obsidian background, charcoal code surfaces, blue accent, Inter/system sans font, and JetBrains Mono for code. V1 remains dark-only.

### Target Device and Platforms

Web Responsive, published as a static site on Vercel.

## Target Information Architecture

### Sidebar Order

The sidebar should guide the reader from orientation to action to reference:

1. Welcome
2. Quickstart
3. Capabilities
   - Generate images
   - Edit images
   - Generate text
4. Reference
   - API Reference
   - SDK (TypeScript)
   - Handle errors
5. Reports
   - RunPod Video Capacity Report

### API Reference Order

The API Reference must teach capabilities before troubleshooting. The target internal order is:

1. Overview: one API key, image jobs use async submit/poll, text uses generation responses or streaming.
2. Generate images: explain the text-to-image use case before showing `POST /jobs`.
3. Edit images: explain single-image and multi-image editing before showing `input_image_b64` fields.
4. Check job status: explain polling before showing `GET /jobs/{job_id}`.
5. Generate text: explain text generation as a first-class capability before showing `POST /v1/generate`.
6. Rate limits and headers: explain quota behavior shared by endpoints.
7. Endpoint-specific error notes: short notes only, with a link to Handle errors for full taxonomy.

### Heading Rules

- Use action-oriented headings for main sections: "Generate images", "Edit images", "Check job status", "Generate text", "Handle errors".
- Use raw endpoint names as supporting labels or subtitles, not as the only H2 when a human action is clearer.
- Avoid acronyms in primary headings unless paired with plain language: "Generate images (T2I)" is acceptable; "T2I" alone is not.
- Explain internal terms such as T2I, i2i, SSE, RunPod, SDK, and Pagefind on first use.
- Prefer "Handle errors" over "Errors" where the page is intended to help developers recover.

### MVP Editorial Scope

The first implementation pass should focus on comprehension, not visual redesign:

- Reorder the sidebar and page flow around the target information architecture.
- Rework API Reference ordering so text generation is not buried after error-oriented sections.
- Rename unclear titles and headings using the heading rules above.
- Add short transition paragraphs at the top of major pages and before major capability sections.
- Keep the current dark Starlight theme, deployment setup, and static search unchanged unless a story requires a minimal supporting edit.

Out of scope for the first pass:

- Custom Starlight components beyond existing usage.
- Light theme.
- New backend, SDK, gateway, or serverless behavior.
- New public domain or Vercel project migration.
- Large visual redesign of the docs portal.

## Technical Assumptions

### Repository Structure

Monorepo-style repository with the docs portal living under `web/docs`.

### Service Architecture

Static Astro Starlight documentation app deployed independently from the gateway/runtime services. The docs app is a public presentation layer only and does not control servegate API behavior.

### Testing Requirements

- Run `pnpm build` in `web/docs` for production build validation.
- Run `pnpm typecheck` in `web/docs` for Astro/TypeScript validation.
- Manually smoke the Vercel preview for navigation, search, code examples, and mobile layout when content structure changes.
- Confirm `.vercelignore` excludes local-only artifacts from source uploads.

### Additional Technical Assumptions and Requests

- Package manager for `web/docs` is `pnpm`.
- Framework is Astro with `@astrojs/starlight`.
- Static search is provided by Starlight/Pagefind.
- Vercel root directory is `web/docs`.
- Build output is `dist`.
- No custom `vercel.json` is required for V1.

## Epic List

Epic 1: Docs Portal Foundation and Vercel Deploy: Establish the Astro Starlight docs portal as the active public Vercel surface with correct routing, build, metadata, and deploy hygiene.

Epic 2: Developer Onboarding and Content Didactics: Make first-use docs complete and easy to follow, with target information architecture, human-friendly titles, and clear transitions from overview to first successful request.

Epic 3: API, SDK, and Error Reference Clarity: Ensure the reference material accurately documents the HTTP contract, SDK usage, validation behavior, and typed error taxonomy while presenting capabilities before error handling and keeping errors in their own recovery-focused guide.

Epic 4: Public Trust, Search, and Maintainability: Improve confidence and maintainability through search, SEO, alpha labeling, preliminary report framing, and authoring conventions.

## Epic Details

### Epic 1: Docs Portal Foundation and Vercel Deploy

Establish `web/docs` as the canonical public docs app. This epic ensures the deployed Vercel site is generated from the Astro Starlight source, not from the archived landing page or local build artifacts.

#### Story 1.1: Configure Vercel Docs Root

As a project owner, I want Vercel to deploy from `web/docs`, so that the public site reflects the maintained documentation portal.

Acceptance Criteria:

1: Vercel root directory is documented and set to `web/docs`.
2: Build command is `pnpm build`.
3: Output directory is `dist`.
4: No custom `vercel.json` is required for the V1 docs portal.
5: Deployment does not rely on `web/landing`.

#### Story 1.2: Keep Deploy Uploads Clean

As a maintainer, I want local-only artifacts excluded from Vercel uploads, so that deploys are small, deterministic, and do not leak local state.

Acceptance Criteria:

1: `.vercelignore` excludes `.vercel`, dependencies, `dist`, `.astro`, browser QA artifacts, env files, logs, and git metadata.
2: Local Lighthouse/Puppeteer artifacts under `web/docs` are not part of deploy uploads.
3: Build output is regenerated by Vercel rather than uploaded from local `dist`.

### Epic 2: Developer Onboarding and Content Didactics

Make the first developer journey coherent from landing to first working request, while ensuring titles, section order, and transitions teach the product clearly.

#### Story 2.1: Welcome Page as Product Entry

As an alpha developer, I want the Welcome page to summarize servegate and direct me to the right next page, so that I can start quickly.

Acceptance Criteria:

1: Welcome states alpha status.
2: Welcome identifies the image and text capabilities currently documented.
3: Welcome shows latest server and SDK versions.
4: Welcome links to Quickstart, authentication/access, API Reference, SDK, Errors, releases, and RunPod Video Report.

#### Story 2.2: Quickstart Covers First Image Job

As an integrating developer, I want copy-pasteable curl examples, so that I can submit and poll a first image job.

Acceptance Criteria:

1: Quickstart lists prerequisites and base URL.
2: Quickstart shows a T2I `POST /jobs` example.
3: Quickstart shows a polling `GET /jobs/{job_id}` example.
4: Quickstart shows running and completed response shapes.
5: Examples use `GATEWAY_API_KEY`, not real secrets.

#### Story 2.3: Quickstart Covers Image Editing Variants

As an integrating developer, I want single-image and multi-image editing examples, so that I can understand which payload shape selects each workflow.

Acceptance Criteria:

1: Quickstart documents `input_image_b64` for single-image i2i.
2: Quickstart documents `input_image_b64_2` for multi-image i2i.
3: Quickstart states compatibility requirements for server and SDK versions.
4: Quickstart lists input constraints for format, size, resolution, and aspect ratio.

#### Story 2.4: Human-Friendly Information Architecture

As a first-time reader, I want documentation labels and section order to match my goals, so that I can understand servegate without decoding endpoint names first.

Acceptance Criteria:

1: Sidebar labels and page headings are reviewed for reader intent and renamed where raw technical labels reduce clarity.
2: Capability-oriented labels are preferred where useful, such as "Generate images", "Edit images", "Generate text", "Check job status", and "Handle errors".
3: The docs introduce text generation as a first-class capability in the learning flow, not only inside a late reference section.
4: Major pages include one- or two-sentence transitions explaining what the reader should do next.
5: Internal terms such as T2I, i2i, SSE, RunPod, and SDK appear with plain-language explanation on first use.
6: Sidebar order matches the Target Information Architecture section unless the story documents an approved deviation.
7: Main headings use action-oriented labels and avoid raw endpoint names as standalone H2 titles where a clearer user action exists.

#### Story 2.5: Capability Pages or Sections Teach Before Reference

As a developer learning servegate, I want each capability introduced in plain language before endpoint details, so that I understand when to use each feature.

Acceptance Criteria:

1: Generate images is introduced as a capability before `POST /jobs` T2I fields are shown.
2: Edit images is introduced as a capability before `input_image_b64` and `input_image_b64_2` details are shown.
3: Generate text is introduced as a capability before `POST /v1/generate` request details are shown.
4: Check job status is introduced as the shared image polling flow before `GET /jobs/{job_id}` details are shown.
5: Each capability introduction answers "what this does", "when to use it", and "where to go next".

### Epic 3: API, SDK, and Error Reference Clarity

Turn the docs portal into a reliable reference once users move beyond quickstart, without making the reference feel like a raw endpoint dump.

#### Story 3.1: API Reference Completeness

As an API user, I want request and response contracts in one place, so that I can integrate without reading source code.

Acceptance Criteria:

1: API Reference documents all public endpoints currently shown in the portal.
2: API Reference documents required headers per endpoint.
3: API Reference documents T2I and i2i request body fields.
4: API Reference documents accepted and completed response shapes.
5: API Reference documents rate-limit headers and polling semantics.
6: API Reference documents text generation streaming and non-streaming responses.
7: API Reference groups content by user capability before raw endpoint detail.
8: Text generation appears before any dedicated error taxonomy section.
9: Error material inside API Reference is limited to endpoint-specific basics and links to the dedicated Errors page for exhaustive handling.
10: Section titles are understandable without knowing endpoint paths in advance.
11: Each major capability section follows the repeated pattern: "When to use this", "Endpoint", "Request", "Response", and "Common mistakes".
12: The API Reference internal order matches: overview, generate images, edit images, check job status, generate text, rate limits and headers, endpoint-specific error notes.

#### Story 3.2: SDK Reference Completeness

As a TypeScript developer, I want SDK examples and error classes, so that I can use the official client safely.

Acceptance Criteria:

1: SDK page documents registry setup and install command.
2: SDK page documents client configuration.
3: SDK page documents `generate()`.
4: SDK page documents `edit()` for single-image and multi-image calls.
5: SDK page documents validation and error handling patterns.

#### Story 3.3: Error Reference Completeness

As an application developer, I want a recovery-focused error guide, so that I can build correct retry and user feedback behavior without scanning the whole API Reference.

Acceptance Criteria:

1: Errors page is titled or presented as "Handle errors" where the navigation label supports task-oriented comprehension.
2: Errors page lists HTTP status codes and gateway error codes.
3: Errors page documents all shown `i2i_validation` variants.
4: Errors page explains `field: "image"` and `field: "image2"` attribution.
5: Errors page maps gateway responses to SDK error classes.
6: Errors page begins with practical recovery guidance before exhaustive tables.

### Epic 4: Public Trust, Search, and Maintainability

Ensure the docs are useful, honest, discoverable, and easy to maintain as servegate changes.

#### Story 4.1: Alpha and Preliminary Framing

As a reader, I want experimental areas clearly labeled, so that I know what is stable enough to try.

Acceptance Criteria:

1: Alpha status is visible on the Welcome page.
2: RunPod Video Capacity Report is labeled preliminary.
3: T2V, I2V, and production readiness are framed with explicit decision boundaries.
4: Docs do not imply production SLA.

#### Story 4.2: Search and SEO Basics

As a developer, I want searchable and crawlable docs, so that I can find reference material quickly.

Acceptance Criteria:

1: Starlight/Pagefind search is available after build.
2: Pages have titles and descriptions.
3: The configured site URL matches the public Vercel URL.
4: Sitemap output is generated by the static build.

#### Story 4.3: Authoring Conventions

As a maintainer, I want clear content ownership patterns, so that future docs changes remain consistent.

Acceptance Criteria:

1: `web/docs/README.md` explains file layout.
2: New docs are added under `web/docs/src/content/docs`.
3: Sidebar changes happen in `web/docs/astro.config.mjs`.
4: Authors use Starlight components consistently for cards, tabs, badges, asides, and links.

## Checklist Results Report

Pending PM checklist execution after requirements review.

## Next Steps

### UX Expert Prompt

Review the `web/docs` Astro Starlight portal for developer onboarding clarity, responsive navigation, dark-theme readability, and whether Welcome/Quickstart flows make the first successful API call obvious.

### Architect Prompt

Review the `web/docs` deployment architecture for Vercel root configuration, static build assumptions, artifact exclusion, Starlight maintainability, SEO/search behavior, and separation from the gateway/runtime services.
