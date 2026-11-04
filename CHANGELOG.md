# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.1] - 2026-11-03

The remote server is live at `https://banqueunt-mcp.zumaetaadriel2.workers.dev/mcp`.

### Changed

- Production configuration in `wrangler.jsonc`: D1 database, OAuth KV namespace, R2 bucket and the public URL (`BANQUEUNT_ORIGEN`).
- README: new _Use it remotely_ section with the connector URL and how to add it in Claude.ai, Claude Code and other clients; the local setup is now under _Run it locally_.
- Deployment guide: answer "no" when Wrangler offers to add the binding, which would duplicate it.

## [0.2.0] - 2026-11-03

Remote mode: the same server now runs on Cloudflare Workers, where students sign in with their BanqueUNT account and practise with the full bank from any MCP client.

### Added

- **Cloudflare Workers entry point** (`src/worker.ts`): stateless MCP over Streamable HTTP at `/mcp` with the SDK's `createMcpHandler`, plus Host and Origin validation.
- **OAuth 2.1** with `@cloudflare/workers-oauth-provider`: discovery metadata (RFC 9728 and RFC 8414), dynamic client registration, Client ID Metadata Documents, PKCE (S256) and refresh tokens.
- **Sign-in with BanqueUNT accounts**: an `/authorize` page where students enter their email and password (Supabase Auth) and approve the client. Client-supplied text is escaped, the page cannot be framed, and the consent handle is single-use and browser-bound. Failed sign-ins are limited per email and per IP (`migrations/0002_intentos_login.sql`).
- **Per-student access**: the token carries the Supabase user id and the courses from the `mis_cursos()` RPC. Progress and the daily cap are per student, and the bank is limited to their courses (`Banco.restringido`). Access tokens last one hour; every refresh renews the Supabase session and re-reads `mis_cursos()`, so revoked access stops at the next refresh.
- **Full bank from a private R2 bucket** (`BancoR2`), with the same index and hash checks as the local folder; the Worker falls back to the sample while the bucket is empty and reloads within five minutes when the index changes.
- `npm run subir-banco`: uploads `examen-pwa/data` to R2 for the enabled courses only (changed files, then the index, then removals), with `--simular` and `--remoto`; it aborts if the local index is out of date.
- `D1ProgresoRepo`: progress, mock exams and the call log in Cloudflare D1, sharing schema and queries with SQLite (`src/persistencia/sql.ts`); contract tests run the same suite against both.
- CI checks that the Worker bundles and that its generated types are up to date.
- Deployment guide (`docs/despliegue.md`) and a demo GIF in the README.
- `scripts/probar-flujo.ts` (formerly `probar-stdio.ts`) can also test the flow over HTTP.

### Changed

- Migrated to the MCP TypeScript SDK v2 (`@modelcontextprotocol/server` 2.4; `@modelcontextprotocol/client` for tests and scripts), replacing `@modelcontextprotocol/sdk` v1.
- The stdio entry point uses `serveStdio`, so it answers both 2025-era clients (with the `initialize` handshake) and clients of the stateless 2026 protocol revision.
- Tool, output and prompt schemas are declared with `z.object(...)`; optional completable prompt arguments use `completable(schema).optional()`.
- `CarpetaLocal` and `BancoR2` share `FuenteIndexada`; `huellaDeTexto` uses Web Crypto and is async.
- `BANQUEUNT_ORIGEN` in `wrangler.jsonc` is the production URL and stays empty until deployment (the Worker refuses to start without it); the local URL lives in `.dev.vars`.

## [0.1.0] - 2026-11-01

First public release: a local MCP server over stdio for the BanqueUNT medical question bank.

### Added

- **Question bank loading** from the bundled public sample (`data/muestra.json`, 30 questions from past exams) or from a local bank folder (`BANQUEUNT_DATA`), reading `index.json` and verifying sha256 file hashes.
- zod schema for the real question format, supporting both explanation formats, and a normalizer into a single `Explicacion`, with "unofficial key" and "AI-written explanation" notices.
- Deduplication signature ported from the original app, so a question published in several exams counts once.
- Tools:
  - `estadisticas_banco`: counts by course, specialty, year and topic.
  - `buscar_preguntas`: accent-insensitive search with filters and cursor pagination (max 20 per call).
  - `generar_simulacro`: random mock exams (1–100 questions), preferring unseen questions, with an expiry time.
  - `corregir_simulacro`: one-time grading with score, answer key and explanations for wrong answers.
  - `mi_progreso`: accuracy by specialty and topic, weakest topics and recently failed topics.
  - `explicar_pregunta`: full explanation of an already graded question.
- Resources `banqueunt://cursos`, `banqueunt://cursos/{curso}/temas` (with completion) and `banqueunt://pregunta/{id}`.
- Prompts `sesion_de_repaso` and `repasar_temas_debiles`.
- Persistent progress in SQLite (`node:sqlite`, `BANQUEUNT_DB`).
- Optional daily cap of questions served per user (`BANQUEUNT_TOPE_DIARIO`, resets at midnight Peru time) and a log of every call, with `npm run uso` to spot bulk extraction.
- Clear `isError` results for unknown or empty courses, expired or already graded mock exams, out-of-range answers and the daily cap.
- Tests with Vitest, including end-to-end tests with an in-memory MCP client that check no answer key, explanation or topic leaks before grading.
- GitHub Actions CI (lint, typecheck, Prettier, build and tests on Node 22 and 24), README and MIT license.

[Unreleased]: https://github.com/zumaetaadriel2/banqueunt-mcp/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/zumaetaadriel2/banqueunt-mcp/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/zumaetaadriel2/banqueunt-mcp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/zumaetaadriel2/banqueunt-mcp/releases/tag/v0.1.0
