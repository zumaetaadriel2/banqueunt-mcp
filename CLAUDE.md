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
npm run uso -- 7     # llamadas y preguntas servidas por usuario en los últimos 7 días
npx tsx scripts/probar-flujo.ts   # flujo generar → corregir → mi_progreso por stdio (con una URL, por HTTP)
npm run worker:migrar            # aplica migrations/ a la D1 local de wrangler
npm run worker:dev               # Worker en http://127.0.0.1:8787/mcp (D1 local)
npm run worker:check             # empaqueta el Worker sin desplegar (también en el CI)
npm run worker:tipos             # regenera src/worker-configuration.d.ts tras cambiar wrangler.jsonc (el CI lo comprueba)
npx @modelcontextprotocol/inspector --cli -e BANQUEUNT_DB=<temporal> node dist/index.js --method tools/list
```

Variables: `BANQUEUNT_DATA` (carpeta `data/` de examen-pwa; sin ella se usa la muestra), `BANQUEUNT_CURSOS` (por defecto `med2_unt`), `BANQUEUNT_DB` (SQLite del progreso; por defecto `%LOCALAPPDATA%\banqueunt-mcp\progreso.db`), `BANQUEUNT_TOPE_DIARIO` (preguntas por usuario al día; vacío o 0 = sin tope, lo normal en local). Para pruebas, apunta `BANQUEUNT_DB` a un archivo temporal y bórralo al terminar: no mezcles pruebas con el progreso real del usuario. MCP Inspector no hereda las variables de entorno: pásalas con `-e`.

Después de `npm run build`, el servidor ya conectado sigue con el código viejo: hay que abrir una sesión nueva de Claude Code o reconectar con `/mcp`.

## Arquitectura

- `src/datos/`: esquema zod de las preguntas (dos formatos de `fundamentoDetallado`), normalizador de explicaciones, firma de deduplicación (portada de `questionSignature()` de examen-pwa) y fuentes. `fuentes.ts` corre en Node y en Workers (`FuenteBanco`, `MuestraEmbebida`); `fuentes-node.ts` lee del disco (`MuestraLocal`, `CarpetaLocal`, que lee `index.json → archivos` y comprueba las huellas sha256).
- `src/dominio/`: lógica pura (búsqueda, simulacros, corrección, progreso, salida pública).
- `src/persistencia/`: `ProgresoRepo` (interfaz asíncrona) con dos implementaciones que comparten esquema y consultas (`sql.ts`): SQLite con `node:sqlite` (local) y Cloudflare D1 (`d1.ts`, remoto). Guarda simulacros y el registro de llamadas (`llamadas`), del que sale el tope diario. `migrations/0001_inicial.sql` debe coincidir con `ESQUEMA`; los cambios de esquema van en una migración nueva. `tests/persistencia.test.ts` corre el mismo contrato contra las dos.
- `src/tools/`, `src/recursos.ts`, `src/prompts.ts`: superficie MCP con el SDK v2 (`@modelcontextprotocol/server`; los esquemas van en `z.object`). `src/server.ts` lo registra todo; `src/index.ts` es la entrada por stdio y `src/worker.ts` la del Worker: `OAuthProvider` (workers-oauth-provider) con `/authorize`, `/oauth/token` y `/oauth/register`, y `/mcp` (`createMcpHandler`, sin estado; valida Host y Origin) con el usuario y los cursos del token. `src/worker.ts` se tipa aparte (`tsconfig.worker.json` + `src/worker-configuration.d.ts`); el resto no puede importar tipos de Workers.
- `src/remoto/`: piezas portables del modo remoto, probadas en `tests/remoto.test.ts` sin Cloudflare: `supabase.ts` (login, renovación y `rpc/mis_cursos` con la anon key), `acceso.ts` (props del grant y del token), `intentos.ts` (límite de logins fallidos en D1) y `pagina.ts` (HTML de `/authorize`, todo escapado). `Banco.restringido(cursos)` limita el banco a los cursos del alumno compartiendo la caché. Fuera de `index.ts`, `fuentes-node.ts` y `sqlite.ts` no se importa nada de `node:*`: el resto también corre en Workers.

## Reglas que no se rompen

- **El banco real nunca entra al repo.** Solo `data/muestra.json`, generado con `scripts/crear-muestra.ts`: exámenes antiguos (`examenes_<año>.json`) con clave oficial y nada de `prioritarias_*` (contenido de pago; «Fijas Grupo C» es de un autor externo).
- **Antes de corregir no sale la clave, el fundamento ni el `tema`** (el tema delata la respuesta). Toda salida previa pasa por `aPreguntaPublica()`. Los tests de `tests/servidor.test.ts` lo vigilan: amplíalos al añadir herramientas.
- No se fijan nombres de bancos en el código; se leen de `index.json`.
- Con stdio, stdout es del protocolo: los logs van a `console.error`.
- Toda herramienta pasa por `ejecutar(ctx, nombre, …)`, que registra la llamada. Si entrega preguntas, llama a `servir(n)` **antes** de guardar o devolver nada, para que cuente en el tope diario (ver `tests/limites.test.ts`).
- Nunca la service role key de Supabase en este repo ni en el Worker; el acceso por curso sale del RPC `mis_cursos()` con el JWT del alumno.
- La contraseña del alumno solo pasa por `/authorize` hacia Supabase: no se guarda ni se registra. El refresh token de Supabase solo vive en el grant (cifrado por la librería); a `/mcp` llegan `usuario`, `email` y `cursos`.
- Secrets del Worker (`SUPABASE_ANON_KEY`, `CONSENT_SECRET`): en local en `.dev.vars` (ignorado por git; plantilla en `.dev.vars.example`), en producción con `wrangler secret put`. Nunca en `wrangler.jsonc`.

## Git: Gitflow y quién hace qué

Las reglas generales (Gitflow, Claude no hace commits, push, merges ni releases, y qué entregar en cada PR y versión) están en el `CLAUDE.md` global del mantenedor. Resumen para este repo:

- Ramas: `main` (solo versiones, protegida, entra por PR con merge commit), `develop` (rama por defecto), `feature/*` y `docs/*` desde `develop`, `release/<x.y.z>` desde `develop` y `hotfix/*` desde `main`. Conventional Commits.
- Claude crea la rama de trabajo en local y, al terminar, entrega los comandos de PowerShell, el PR completo (base/compare, título, descripción, assignee, label y _Create a merge commit_) y los comandos para sincronizar. **Nunca** hace commit, push, merges, tags ni releases.

Particularidades de este proyecto:

- Después de cada cambio: `npm run build` y abrir una sesión nueva de Claude Code (o `/mcp` → Reconnect) para probarlo.
- En cada release, la versión se cambia en **dos lugares**: `package.json` y `VERSION` de `src/server.ts`. El `CHANGELOG.md` y las notas de la GitHub Release van en inglés.
- Versionado semántico `0.x.y` mientras sea MVP: sube el **minor** con herramientas nuevas y el **patch** con arreglos.
