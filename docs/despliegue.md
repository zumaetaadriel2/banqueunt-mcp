# Despliegue del modo remoto (Cloudflare Workers)

Guía para publicar el Worker de BanqueUNT MCP en la misma cuenta de Cloudflare de la PWA. Se hace una sola
vez; después, cada versión es `npx wrangler deploy` y cada cambio del banco es `npm run subir-banco -- --remoto`.

Todo se corre desde la carpeta del repo, en PowerShell. Despliega desde `main` (después de publicar la versión),
nunca desde una rama de trabajo.

## 1. Iniciar sesión en Cloudflare

```powershell
npx wrangler login
```

Se abre el navegador: entra con la cuenta de la PWA y acepta. Comprueba con `npx wrangler whoami`.

## 2. Activar R2

En el panel de Cloudflare: **Storage & Databases → R2**. Si te pide activarlo (puede pedir un método de pago,
aunque el plan gratuito no cobra hasta 10 GB), actívalo. **No** actives el acceso público de ningún bucket.

## 3. Crear la base, el KV y el bucket

```powershell
npx wrangler d1 create banqueunt-mcp
```

```powershell
npx wrangler kv namespace create OAUTH_KV
```

```powershell
npx wrangler r2 bucket create banqueunt-mcp-bancos
```

Si wrangler pregunta _«Would you like Wrangler to add it on your behalf?»_, responde **no**: los bindings ya
están en `wrangler.jsonc` (con otro nombre que el que propone) y los duplicaría.

Copia en `wrangler.jsonc` los dos ids que imprimen los dos primeros comandos (no son secretos, van al repo):

- `d1_databases[0].database_id` ← el `database_id` de la D1
- `kv_namespaces[0].id` ← el `id` del KV

## 4. Poner la URL pública

En el panel: **Workers & Pages → Overview**, a la derecha está tu subdominio (`<algo>.workers.dev`). La URL
del Worker será `https://banqueunt-mcp.<algo>.workers.dev`. Ponla en `wrangler.jsonc`:

```jsonc
"BANQUEUNT_ORIGEN": "https://banqueunt-mcp.<algo>.workers.dev",
```

Mientras esté vacía, el Worker responde con error a todo: así nunca sale a producción con la URL de desarrollo.
(Los pasos 3 y 4 cambian `wrangler.jsonc`: súbelos en una rama `chore/...` con su PR).

## 5. Cargar los secrets

```powershell
npx wrangler secret put SUPABASE_ANON_KEY
```

Pega la anon key (Supabase → Project Settings → API → anon public). Si wrangler pregunta si crear el Worker
porque aún no existe, responde que sí.

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

```powershell
npx wrangler secret put CONSENT_SECRET
```

Pega el texto que generó el comando anterior. **No** reutilices el de tu `.dev.vars`.

## 6. Crear las tablas

```powershell
npx wrangler d1 migrations apply banqueunt-mcp --remote
```

## 7. Desplegar

```powershell
npx wrangler deploy
```

Comprueba que responde: abre `https://banqueunt-mcp.<algo>.workers.dev/` (debe decir dónde está `/mcp`).

## 8. Subir el banco real

Primero mira el plan sin tocar nada, después súbelo:

```powershell
$env:BANQUEUNT_DATA = "C:\Users\GRLL\Desktop\examen-pwa\data"
```

```powershell
npm run subir-banco -- --remoto --simular
```

```powershell
npm run subir-banco -- --remoto
```

Solo sube los cursos de `BANQUEUNT_CURSOS` (por defecto `med2_unt`) y se detiene si el índice está desfasado
(corre antes `node builder_banco.js --reindex` en examen-pwa). El Worker lo ve en menos de 5 minutos.

## 9. Probar

- **Claude.ai:** Settings → Connectors → **Add custom connector** → URL `https://banqueunt-mcp.<algo>.workers.dev/mcp`
  → Connect. Se abre la página de BanqueUNT: inicia sesión y pide «¿cuántas preguntas hay por especialidad?».
  Debe decir `origen: r2` y 1,392 preguntas únicas en med2_unt.
- **Claude Code:**
  ```powershell
  claude mcp add --transport http banqueunt-remoto https://banqueunt-mcp.<algo>.workers.dev/mcp
  ```
  y luego `/mcp` → `banqueunt-remoto` → Authenticate.
- **Una cuenta sin el curso** (o desactivada): la página de login debe decir que no tiene acceso.

## 10. Antes de abrirlo a los alumnos

- **Límite de logins de Supabase:** todos los inicios de sesión le llegan desde las IPs de Cloudflare. En
  Supabase → **Authentication → Rate Limits**, revisa el de _sign-ins_ y súbelo si vas a tener muchos alumnos
  entrando a la vez. El Worker ya limita los fallos por correo (5) y por IP (20) cada 15 minutos.
- **Uso de Supabase:** en el panel debería subir solo con los logins y las renovaciones (una por alumno por hora
  de uso), nunca con cada pregunta.

## Mantenimiento

- **Ver qué pasa en vivo:** `npx wrangler tail`
- **Uso por alumno (detectar extracción masiva):**
  ```powershell
  npx wrangler d1 execute banqueunt-mcp --remote --command "select usuario, count(*) llamadas, sum(case when resultado='ok' then cantidad end) preguntas, sum(resultado='limite') rechazadas from llamadas where en >= datetime('now','-7 days') group by usuario order by preguntas desc"
  ```
- **Actualizar el banco:** después de cambiar examen-pwa, `npm run subir-banco -- --remoto`.
- **Volver a la versión anterior del Worker:** `npx wrangler rollback`.
- **Cambiar el tope diario:** `BANQUEUNT_TOPE_DIARIO` en `wrangler.jsonc` y `npx wrangler deploy`.
