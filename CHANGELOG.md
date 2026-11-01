# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
