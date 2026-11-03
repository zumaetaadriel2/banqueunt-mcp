# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The Worker serves the full bank from a private R2 bucket (`BancoR2`), with the same index and hash checks as the local folder, and falls back to the sample while the bucket is empty. It re-checks the index every five minutes and reloads when it changes.
- `npm run subir-banco`: uploads `examen-pwa/data` to R2 (local or `--remoto`) for the enabled courses only, uploading just the changed files, then the index, then deleting removed files; `--simular` prints the plan, and it aborts if the local index is out of date.
- Deployment guide (`docs/despliegue.md`).
- OAuth 2.1 for the Worker with `@cloudflare/workers-oauth-provider`: discovery metadata (RFC 9728 and RFC 8414), dynamic client registration, Client ID Metadata Documents, PKCE (S256) and refresh tokens.
- `/authorize` page where students sign in with their BanqueUNT email and password (Supabase Auth) and approve the client. Client-supplied text is escaped, the page cannot be framed, and the consent handle is single-use and browser-bound.
- Per-student access: the token carries the Supabase user id and the courses from the `mis_cursos()` RPC. Progress and the daily cap are per student, and the bank is limited to their courses (`Banco.restringido`). Access tokens last one hour; every refresh renews the Supabase session and re-reads `mis_cursos()`, so revoked access stops at the next refresh.
- Failed sign-in limit per email and per IP, stored in D1 (`migrations/0002_intentos_login.sql`).
- Cloudflare Workers entry point (`src/worker.ts`): stateless MCP over Streamable HTTP at `/mcp` with the SDK's `createMcpHandler`, Host and Origin validation, and the bundled sample bank. Local only for now (`npm run worker:dev`); not deployed publicly yet.
- `D1ProgresoRepo`: progress, mock exams and the call log in Cloudflare D1, sharing schema and queries with SQLite (`src/persistencia/sql.ts`) and the D1 migration `migrations/0001_inicial.sql`.
- Shared contract tests that run against both SQLite and D1, and a CI step that bundles the Worker without deploying (`npm run worker:check`).
- `scripts/probar-flujo.ts` (formerly `probar-stdio.ts`) can also test the flow over HTTP.

### Changed

- `BANQUEUNT_ORIGEN` in `wrangler.jsonc` is the production URL and stays empty until deployment (the Worker refuses to start without it); the local URL lives in `.dev.vars`.
- `CarpetaLocal` and `BancoR2` share `FuenteIndexada`; `huellaDeTexto` now uses Web Crypto and is async.
- Migrated to the MCP TypeScript SDK v2 (`@modelcontextprotocol/server` 2.4; `@modelcontextprotocol/client` for tests and scripts), replacing `@modelcontextprotocol/sdk` v1. This prepares the remote mode on Cloudflare Workers.
- The stdio entry point uses `serveStdio`, so the server answers both 2025-era clients (with the `initialize` handshake) and clients of the stateless 2026 protocol revision.
- Tool, output and prompt schemas are declared with `z.object(...)`; optional completable prompt arguments use `completable(schema).optional()`.

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

[Unreleased]: https://github.com/zumaetaadriel2/banqueunt-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/zumaetaadriel2/banqueunt-mcp/releases/tag/v0.1.0
