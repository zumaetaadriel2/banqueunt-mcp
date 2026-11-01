# banqueunt-mcp: plan refinado

## Contexto

`PLAN.md` describe un servidor MCP para el banco de preguntas de BanqueUNT. Revisé el repo real (`Desktop\examen-pwa`) y tus respuestas:

- BanqueUNT es tu proyecto.
- Quieres progreso persistente (SQLite).
- El objetivo es el CV y, si se puede, que tus compañeros lo usen con su IA favorita, con el banco completo **solo para suscriptores**.

Por eso el plan cambia en estos puntos:

- **Modelo de datos real.** El plan suponía otro formato de preguntas; este plan usa el real.
- **Fuente de datos.** En local, las preguntas salen de tu carpeta `examen-pwa/data`. En remoto salen de un bucket privado de Cloudflare R2. Supabase solo se usa para el login, así que no suma uso de Storage.
- **Progreso persistente.**
- **Modo remoto con login.** Pasa de "opcional" a fase propia.

**Alcance del MVP: un solo curso, `med2_unt`** (1,433 preguntas). Todo el código recibe `curso` como parámetro, pero la configuración solo habilita `med2_unt` (`BANQUEUNT_CURSOS=med2_unt`). Agregar ENCIB o Residentado después es cambiar esa variable y probar el otro formato de `fundamentoDetallado`.

---

## 1. Lo que encontré en `examen-pwa` (y cambia el plan)

| Dato                                                                                                                                                                                                                                                             | Implicancia para el MCP                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2,173 preguntas en `data/<curso>/*.json`, indexadas en `data/index.json`                                                                                                                                                                                         | El cargador lee `index.json` y luego los archivos por curso                                                                                                                                                                                                                                |
| Cursos: `encib`, `med1_unt`, `med2_unt`, `residentado`, `enam` (este último aún sin preguntas)                                                                                                                                                                   | El parámetro se llama **`curso`** (coincide con `categoriaId`), no `examen`, porque en tus datos `examen` es otra cosa ("Examen nacional")                                                                                                                                                 |
| Campos: `id, categoriaId, anio, especialidad, tema, dificultad, pregunta, opciones[], respuestaCorrecta (índice desde 0), fundamentoDetallado, fuente, claveOficial, prioritaria, imagen`                                                                        | Filtros reales: `curso, especialidad, tema, anio, dificultad, prioritaria`, más texto libre                                                                                                                                                                                                |
| En `med2_unt` conviven **dos formatos** de `fundamentoDetallado`: el antiguo `{correcta, descarte}` (822) y el ampliado `{idea, correcta, alternativas[], recordar, referencia, otraPosible?}` (611), que usan las fijas y lo nuevo                              | Esquema zod con unión de ambos y un **normalizador** a un único `Explicacion`, **desde el MVP**. `alternativas` va en el orden original de `opciones`, con `""` en la clave. `recordar` puede ser texto o lista. `otraPosible` es `{opcion, motivo}`, donde `opcion` es el índice original |
| `claveOficial: false` (255) y `fundamentoGenerado: true`                                                                                                                                                                                                         | Se muestran como avisos: «clave no oficial» y «explicación elaborada con IA». Si no hay `claveOficial`, la clave se toma como oficial, igual que en la app                                                                                                                                 |
| Hay preguntas con 4 alternativas (A–D) y con 5 (A–E); las opciones ya traen la letra al inicio                                                                                                                                                                   | El alumno responde con una letra, que se valida contra `opciones.length`                                                                                                                                                                                                                   |
| Los nombres de los bancos cambian (las fijas son `data/med2_unt/prioritarias_<fuente>.json`)                                                                                                                                                                     | **No se fijan nombres en el código.** Se lee `data/index.json → categorias[curso].archivos` y `versiones` (huella sha256 de 12 caracteres sobre el texto con LF, como `builder_banco.js`)                                                                                                  |
| Una misma pregunta aparece en varios exámenes (44 grupos en med2)                                                                                                                                                                                                | Se deduplica con la misma firma que `questionSignature()` de `app.js`: enunciado y opciones normalizados, con las opciones sin la letra y ordenadas                                                                                                                                        |
| `med2_unt` no tiene imágenes (otros cursos sí: `imagenes/<curso>/<id>.webp`)                                                                                                                                                                                     | Imágenes fuera del MVP                                                                                                                                                                                                                                                                     |
| Bucket privado `bancos/<curso>/<archivo>.json` con la política RLS `puede_ver_curso`                                                                                                                                                                             | El MCP **no** lo usa, para no gastar uso de Supabase                                                                                                                                                                                                                                       |
| Acceso: **`mis_cursos()`** en `supabase/esquema.sql`. Si la cuenta no está activa (`usuario_activo()`), devuelve vacío. Un admin ve todos los cursos. Los demás ven los de `perfiles.cursos` más los cursos con `abierto`. `med2_unt` ya tiene `abierto = false` | **No se reimplementa la regla.** Al iniciar sesión se llama **una vez** al RPC `mis_cursos()` con el JWT del usuario y el resultado se guarda en las props del token. **La service role key nunca va en el Worker**                                                                        |

**⚠️ Fuera del MCP, pero importante:** todo el banco (`data/**` y `bancos/*.json`) está commiteado en `zumaetaadriel2/examen-pwa`. Hoy parece privado. Si algún día lo haces público, o lo enlazas desde el README del MCP, se filtran las 2,173 preguntas con sus explicaciones. Hay que limpiar el historial (`git filter-repo`) antes de hacer público ese repo. Lo dejo como tarea aparte.

---

## 2. Arquitectura

```
src/
  index.ts              # entrada stdio (local)
  http.ts               # entrada Streamable HTTP (remoto, Fase 6)
  server.ts             # createServer(deps): registra tools, resources y prompt
  datos/
    esquema.ts          # zod: Pregunta, Fundamento (unión), Index
    normalizar.ts       # Fundamento → Explicacion única
    fuentes.ts          # interfaz FuenteBanco + 3 implementaciones
  dominio/
    busqueda.ts         # filtros + texto (minúsculas y sin tildes)
    simulacro.ts        # muestreo sin repetir, corrección, nota
    publico.ts          # aPreguntaPublica(): quita respuesta y fundamento (único punto de salida)
  persistencia/
    repo.ts             # interfaz ProgresoRepo
    sqlite.ts           # local: node:sqlite (Node ≥ 22) o better-sqlite3
    d1.ts               # remoto: Cloudflare D1 (SQLite), mismo esquema que el local
data/muestra.json       # unas 30 preguntas de med2_unt de exámenes antiguos con clave oficial (lo único del banco que va a GitHub)
tests/
```

**Fuentes de datos (`FuenteBanco`)**, elegidas por variables de entorno:

1. `MuestraLocal` (por defecto): `data/muestra.json`. Así el repo funciona en cualquier PC sin credenciales.
2. `CarpetaLocal`: `BANQUEUNT_DATA=C:\...\examen-pwa\data`. Lee `index.json` y los archivos del banco. Es tu modo de uso diario.
3. `CloudflareR2` (modo remoto): el banco se sube a un bucket **privado de Cloudflare R2** con un script que, como `herramientas/subir_bancos.js`, compara las `versiones` de `index.json` y sube solo lo que cambió. Supabase Storage no se usa.

**Uso de Supabase:**

- **Local:** ninguno.
- **Remoto:** solo el login. Al iniciar sesión se hace una llamada a `rpc/mis_cursos` con el JWT del alumno y la anon key, y el resultado se guarda en las props del token OAuth. Las llamadas siguientes validan el token en el propio Worker, sin pedirle nada a Supabase.

**Regla de oro:** las tools leen preguntas solo a través de `aPreguntaPublica()`. La única excepción es `corregir_simulacro`, que lee respuestas solo del simulacro guardado.

---

## 3. Superficie MCP (revisada)

Usar `server.registerTool` con `inputSchema` y `outputSchema` (zod) y devolver `structuredContent` además del texto. Marcar las tools de lectura con `annotations: { readOnlyHint: true }`.

| Tool                                      | Cambios respecto al plan original                                                                                                                                                                                |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buscar_preguntas`                        | Filtros reales (`curso, especialidad, tema, anio, dificultad, prioritaria, texto`) y paginación (`limite` ≤ 20, `cursor`). Nunca devuelve la respuesta                                                           |
| `generar_simulacro`                       | Parámetros `curso, cantidad (1–100), especialidades?, temas?, solo_prioritarias?, excluir_vistas?` (no repetir preguntas que el alumno ya hizo, usando SQLite). Se guarda en la BD con `creado_en` y `expira_en` |
| `corregir_simulacro`                      | Respuestas `{ numero: "A".."E" }`. Devuelve nota, falladas y la explicación normalizada. Marca el simulacro como corregido, de modo que no se puede corregir dos veces. Registra los resultados por tema         |
| `estadisticas_banco`                      | Conteo por curso, especialidad y tema. En modo remoto, solo de los cursos que el usuario puede ver                                                                                                               |
| **`mi_progreso`** (nueva)                 | Historial de simulacros, % de aciertos por especialidad y tema, y los **5 temas más débiles**. Es la que más luce en el CV                                                                                       |
| **`explicar_pregunta`** (nueva, opcional) | Recibe el id de una pregunta _ya corregida_ y devuelve el fundamento completo. Sirve para el prompt de repaso                                                                                                    |

**Resources:** `banqueunt://cursos`, `banqueunt://cursos/{curso}/temas` (con _completion_ del parámetro `curso`) y `banqueunt://pregunta/{id}` (versión pública).

**Prompts:**

- `sesion_de_repaso(curso, tema?, cantidad?)`: tutor que hace una pregunta a la vez, espera la respuesta, corrige con `corregir_simulacro` y explica.
- **`repasar_temas_debiles`** (nuevo): llama a `mi_progreso` y arma un simulacro con los temas débiles.

**Esquema SQLite:**

- `simulacros(id, curso, creado_en, expira_en, corregido_en, nota)`
- `simulacro_items(simulacro_id, orden, pregunta_id, respuesta_alumno, correcta)`

Los aciertos por tema se calculan con un join contra el banco cargado. La ruta de la BD es configurable (`BANQUEUNT_DB`); por defecto, la carpeta de datos del usuario.

---

## 4. Fases (revisadas, unas 3 a 4 semanas)

### Fase 0: Preparación

- [x] Crear el repo público `banqueunt-mcp`, separado de `examen-pwa`
- [x] TypeScript estricto, ESM, Node ≥ 22, `tsup` o `tsc` para compilar, ESLint y Prettier
- [x] `.gitignore`: `.env`, `*.db`, cualquier `data/` que no sea `muestra.json`

### Fase 1: Datos

- [x] `esquema.ts` con zod a partir de los campos reales (sección 1). Test que valide **las 1,433 preguntas** de `med2_unt` en `examen-pwa/data` (se ejecuta en local y se salta si falta `BANQUEUNT_DATA`)
- [x] `normalizar.ts` para los dos formatos de `fundamentoDetallado` (antiguo y ampliado con `otraPosible`), con avisos de `claveOficial` y `fundamentoGenerado`. Tests de cada caso
- [x] Generar `muestra.json` con un script (`scripts/crear-muestra.ts`), unas 30 preguntas de `med2_unt`:
  - **Solo** de exámenes antiguos (`examenes_<año>.json`)
  - Con clave oficial: sin `claveOficial: false`
  - **Nunca** de `prioritarias_*`, que es contenido de pago (y «Fijas Grupo C» es de un autor externo, con permiso solo para la app). También se excluyen las que tienen `prioritaria: true` o el mismo enunciado que una prioritaria
- [x] `MuestraLocal` y `CarpetaLocal`. `CarpetaLocal` lee `index.json → categorias[curso].archivos` y comprueba las huellas de `versiones`
- [x] Firma de deduplicación (portada de `questionSignature()` de `app.js`), para usarla en los conteos y en los simulacros

### Fase 2: Primera tool y conexión

- [ ] `estadisticas_banco`, transporte stdio, prueba con MCP Inspector
- [x] **Hito:** `claude mcp add banqueunt -- node dist/index.js`, luego preguntar "¿cuántas preguntas hay por especialidad en med2?"

### Fase 3: Tools principales y persistencia

- [x] `publico.ts` y `busqueda.ts` (comparación sin tildes) para `buscar_preguntas`
- [x] Repo SQLite, `generar_simulacro` y `corregir_simulacro`
- [x] `mi_progreso`
- [x] **Tests clave:** ninguna salida (salvo la corrección) contiene `respuestaCorrecta`, `fundamento*` ni la letra correcta. El test recorre la respuesta serializada de cada tool
- [x] `explicar_pregunta` (solo preguntas ya corregidas). El `tema` tampoco sale antes de corregir: suele nombrar el diagnóstico o el fármaco correcto

### Fase 4: Resources, prompts y errores

- [x] Resources con completion, los 2 prompts
- [x] Errores claros con `isError: true`: curso inexistente o sin preguntas (`enam`), simulacro vencido o ya corregido, letra fuera de rango, curso sin acceso
- [x] `mi_progreso` devuelve también los **temas fallados recientes** (desde la primera falla), que usa el prompt `repasar_temas_debiles`

### Fase 4.5: Protección del banco

- [ ] Límites por usuario: `buscar_preguntas` ≤ 20 por llamada y un tope diario de preguntas servidas (ej. 300 al día). En remoto se guarda en Cloudflare D1; en local no aplica
- [ ] Registrar cada llamada (usuario, tool, cantidad) para detectar una extracción masiva

### Fase 5: Presentación

- [ ] README en inglés: demo en GIF, instalación (Claude Desktop, Claude Code, Cursor y VS Code), tabla de tools y diagrama de arquitectura
- [ ] GitHub Actions: lint, `tsc --noEmit` y tests en Node 22
- [ ] Portafolio y LinkedIn

### Fase 6: Remoto para suscriptores (antes "opcional")

- [ ] Entrada `http.ts` con **Streamable HTTP** (con sesiones y sin estado entre réplicas)
- [ ] **Autenticación:** el servidor actúa como _resource server_ OAuth 2.1 según la spec de autorización de MCP. Recomendación: desplegar en **Cloudflare Workers** (ya usas Cloudflare para la PWA) con `@cloudflare/workers-oauth-provider`. La pantalla de login usa Supabase Auth (email y contraseña de BanqueUNT). **Solo en ese momento** se llama al RPC `mis_cursos()` con el JWT del alumno, sin reimplementar la regla, y el resultado se guarda en las _props_ del token OAuth. El Worker solo tiene la URL y la anon key; **la service role key nunca va en el Worker**. Si el admin cambia los cursos de un alumno, el cambio se aplica al refrescar el token, por ejemplo cada 24 h.
  - Alternativa más simple si OAuth se complica: un token personal generado en la cuenta de BanqueUNT y enviado como `Authorization: Bearer`
- [ ] Banco en R2 privado: el script `scripts/subir-r2.ts` lee `index.json`, sube solo los archivos cuya huella cambió (como `subir_bancos.js`), borra los que ya no están en el índice y aborta si el índice está desfasado
- [ ] Persistencia remota en **Cloudflare D1** (`d1.ts`, mismo esquema que SQLite, filtrado por `user_id` del token). Los límites diarios y el registro de llamadas también van en D1
- [ ] Verificar en el dashboard de Supabase que el uso solo sube con los logins
- [ ] Probar con el conector remoto de Claude.ai y con otro cliente (ChatGPT o Cursor) para cumplir el "con su IA favorita"
- [ ] Publicar en npm (`npx banqueunt-mcp`), que funciona en modo muestra o carpeta local

---

### Mejoras futuras

- **Sincronizar el progreso:** el progreso del MCP (SQLite o D1) **no** se sincroniza con el de la app (`public.progreso` en Supabase). Para el MVP está bien así. Más adelante se puede importar o exportar entre ambos.
- Más cursos (ENCIB, Residentado) e imágenes.

## 4.9 Repos y costos

- `examen-pwa` **se queda privado**. El MCP es un repo aparte y público, con solo `muestra.json`. El CI del MCP usa solo la muestra; el banco real se lee desde tu PC (local) o se sube a R2 con un script que corre en tu PC.
- Costos objetivo: **S/ 0**, todo dentro de los planes gratuitos:
  - Cloudflare: Workers, R2, D1, y KV o Durable Objects para los tokens OAuth
  - GitHub y npm (paquete público)
  - el subdominio `*.workers.dev`
- Opcionales: un dominio propio (`mcp.banqueunt.com`, unos USD 10 al año).
- Cada compañero usa su propia IA. Tú no pagas su uso del modelo.
- Protección contra sorpresas: los límites diarios de la Fase 4.5 y revisar los límites del plan gratuito de Cloudflare antes de lanzarlo.

## 5. Verificación

- `npm test`:
  - unidad (esquema, normalizador, búsqueda, muestreo, corrección)
  - **integración con `InMemoryTransport` del SDK**: un `Client` real llama a cada tool y valida `structuredContent` contra `outputSchema`
- Validar las 1,433 preguntas de `med2_unt`: `BANQUEUNT_DATA=…/examen-pwa/data npm test`
- MCP Inspector: listar tools, resources y prompts; flujo generar → corregir → `mi_progreso`
- Manual en Claude Code: "hazme un simulacro de 10 preguntas de med2 de Cardiología", responder, corregir, reiniciar el servidor y comprobar que `mi_progreso` conserva el historial
- Remoto: una cuenta para la que `mis_cursos()` no incluye `med2_unt` (sin el curso o inactiva) no ve preguntas (403 o lista vacía); una cuenta con el curso sí las ve

## 6. Línea de CV (actualizada)

> **BanqueUNT MCP Server**: Servidor MCP en TypeScript que conecta un banco de más de 1,400 preguntas médicas con asistentes de IA (Claude, ChatGPT, Cursor): búsqueda, simulacros, corrección con explicaciones y seguimiento de temas débiles. 6 herramientas tipadas con zod y salida estructurada, recursos y prompts, persistencia en SQLite (local) y Cloudflare D1 (remoto), despliegue remoto con OAuth 2.1 sobre Cloudflare Workers y acceso solo para suscriptores con login de Supabase Auth. Tests en Vitest y CI en GitHub Actions.
