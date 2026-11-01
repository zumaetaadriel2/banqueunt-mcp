# CLAUDE.md

Guía para Claude Code en este repositorio. Responde siempre en español; código, nombres e historial de git pueden ir en inglés.

## Proyecto

**banqueunt-mcp**: servidor MCP en TypeScript que conecta el banco de preguntas médicas de BanqueUNT (app privada `examen-pwa`) con asistentes de IA. El plan completo y las fases están en [PLAN.md](PLAN.md); marca ahí los pendientes que se completen.

## Comandos

```bash
npm run build        # compila a dist/ (lo que ejecutan Claude Code y Claude Desktop)
npm test             # Vitest; con BANQUEUNT_DATA también valida el banco real
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npx prettier --write .
npm run muestra      # regenera data/muestra.json (requiere BANQUEUNT_DATA)
npx tsx scripts/probar-stdio.ts   # flujo generar → corregir → mi_progreso por stdio
```

Variables: `BANQUEUNT_DATA` (carpeta `data/` de examen-pwa; sin ella se usa la muestra), `BANQUEUNT_CURSOS` (por defecto `med2_unt`), `BANQUEUNT_DB` (SQLite del progreso; por defecto `%LOCALAPPDATA%\banqueunt-mcp\progreso.db`). Para pruebas, apunta `BANQUEUNT_DB` a un archivo temporal y bórralo al terminar: no mezcles pruebas con el progreso real del usuario.

Después de `npm run build`, el servidor ya conectado sigue con el código viejo: hay que abrir una sesión nueva de Claude Code o reconectar con `/mcp`.

## Arquitectura

- `src/datos/`: esquema zod de las preguntas (dos formatos de `fundamentoDetallado`), normalizador de explicaciones, firma de deduplicación (portada de `questionSignature()` de examen-pwa) y fuentes (`MuestraLocal`, `CarpetaLocal`, que lee `index.json → archivos` y comprueba las huellas sha256).
- `src/dominio/`: lógica pura (búsqueda, simulacros, corrección, progreso, salida pública).
- `src/persistencia/`: `ProgresoRepo` (interfaz asíncrona) y su implementación SQLite con `node:sqlite`. En la Fase 6 se añadirá D1.
- `src/tools/`, `src/recursos.ts`, `src/prompts.ts`: superficie MCP. `src/server.ts` lo registra todo; `src/index.ts` es la entrada por stdio.

## Reglas que no se rompen

- **El banco real nunca entra al repo.** Solo `data/muestra.json`, generado con `scripts/crear-muestra.ts`: exámenes antiguos (`examenes_<año>.json`) con clave oficial y nada de `prioritarias_*` (contenido de pago; «Fijas Grupo C» es de un autor externo).
- **Antes de corregir no sale la clave, el fundamento ni el `tema`** (el tema delata la respuesta). Toda salida previa pasa por `aPreguntaPublica()`. Los tests de `tests/servidor.test.ts` lo vigilan: amplíalos al añadir herramientas.
- No se fijan nombres de bancos en el código; se leen de `index.json`.
- Con stdio, stdout es del protocolo: los logs van a `console.error`.
- Nunca la service role key de Supabase en este repo ni en el Worker; el acceso por curso sale del RPC `mis_cursos()` con el JWT del alumno.

## Git: Gitflow y quién hace qué

Ramas: `main` (solo versiones, protegida, entra por PR con merge commit), `develop` (rama por defecto), `feature/<nombre>` desde `develop`, `release/<x.y.z>` desde `develop`, `hotfix/<nombre>` desde `main`. Mensajes con Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`).

**Claude puede** crear y cambiar a la rama de trabajo en local (`git switch -c feature/...`). **Claude nunca** hace `git commit`, `git push`, merge, tags ni releases: los hace el usuario. Al terminar cada tarea, entrega todo lo que el usuario necesita, completo y listo para copiar:

### Al terminar una feature, fix o hotfix

1. **Comandos en PowerShell**, cada uno en su propio bloque: `cd` a la carpeta, `git add -A`, `git commit -m "<tipo>: <resumen>"` y `git push -u origin <rama>`.
2. **El PR**:
   - **base** y **compare**: `develop` ← `feature/...` (hotfix: `main` y después `develop`).
   - **Title**: el mismo del commit.
   - **Description** en un bloque de Markdown listo para pegar: qué incluye, decisiones importantes y cómo probarlo.
   - **Assignees**: el usuario («assign yourself»).
   - **Labels**: `enhancement`, `bug`, `documentation` o el que corresponda.
   - **Método de merge**: **Create a merge commit**, y luego **Delete branch**.
3. **Sincronizar en local**: `git switch develop`, `git pull`, `git branch -d <rama>` y `git fetch --prune`.
4. **Recordatorio**: `npm run build` y abrir una sesión nueva (o `/mcp` → Reconnect) para probarlo.

### Al publicar una versión (release)

1. `git switch -c release/<x.y.z> develop`.
2. Claude actualiza la versión en `package.json` **y** en `VERSION` de `src/server.ts`, y el `CHANGELOG.md` (formato Keep a Changelog, en inglés), y deja el commit sugerido: `chore(release): v<x.y.z>`.
3. **PR** `main` ← `release/<x.y.z>`, con title `Release v<x.y.z>`, descripción con el changelog y **Create a merge commit**.
4. **Tag y GitHub Release**: en Releases → _Draft a new release_:
   - **Tag**: `v<x.y.z>`, creado sobre `main`.
   - **Title**: `v<x.y.z> – <resumen corto>`.
   - **Notes**: el texto que entrega Claude, en inglés: highlights, cambios y cómo instalar.
   - Marcar **Set as the latest release** (o **pre-release** si es `0.x` experimental).
5. **Devolver `main` a `develop`**: PR `develop` ← `main` con title `chore: merge main into develop after v<x.y.z>`, o en local `git switch develop`, `git merge main` y `git push`.
6. Borrar `release/<x.y.z>`.

Versionado semántico: `0.x.y` mientras sea MVP. Sube el **minor** con herramientas o funciones nuevas y el **patch** con arreglos.
