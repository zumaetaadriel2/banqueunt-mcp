/**
 * HTML de /authorize: login con la cuenta de BanqueUNT y consentimiento en un solo paso. Todo lo que
 * viene del cliente OAuth (nombre, dominio, redirect) lo elige quien registró el cliente: se escapa siempre.
 */

/** Lo que la página necesita del pedido de autorización (ConsentDescription de workers-oauth-provider) */
export interface DatosConsentimiento {
  clientName: string;
  clientDomain?: string;
  redirectHost: string;
  redirectIsLoopback: boolean;
}

export const escapar = (valor: string): string => valor.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Cabeceras de toda página HTML propia: sin iframes, sin caché, sin scripts. Sin `form-action`: Chrome
 * también lo aplica a la redirección que sigue al formulario, y bloquearía la vuelta al cliente OAuth.
 */
export function cabecerasHtml(base?: Headers): Headers {
  const h = new Headers(base);
  h.set('Content-Type', 'text/html; charset=utf-8');
  h.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
  h.set('X-Frame-Options', 'DENY');
  h.set('Cache-Control', 'no-store');
  h.set('Referrer-Policy', 'no-referrer');
  return h;
}

const ESTILO = `
  body { font-family: system-ui, sans-serif; background: #f5f6f8; color: #1d2433; margin: 0; }
  main { max-width: 420px; margin: 48px auto; padding: 0 16px; }
  .tarjeta { background: #fff; border-radius: 12px; padding: 28px; box-shadow: 0 1px 3px rgb(0 0 0 / 0.12); }
  h1 { font-size: 1.25rem; margin: 0 0 12px; }
  p { line-height: 1.45; }
  .aviso { background: #fff4e5; border-left: 4px solid #f0a020; padding: 10px 12px; border-radius: 6px; }
  .error { background: #fdecec; border-left: 4px solid #d93025; padding: 10px 12px; border-radius: 6px; }
  label { display: block; margin: 14px 0 4px; font-weight: 600; }
  input[type=email], input[type=password] { width: 100%; box-sizing: border-box; padding: 10px; border: 1px solid #c5cad3; border-radius: 8px; font-size: 1rem; }
  .botones { display: flex; gap: 10px; margin-top: 20px; }
  button { flex: 1; padding: 11px; border-radius: 8px; border: 1px solid #c5cad3; background: #fff; font-size: 1rem; cursor: pointer; }
  button.principal { background: #1a5fd0; border-color: #1a5fd0; color: #fff; }
  small { color: #5b6475; }
  @media (prefers-color-scheme: dark) {
    body { background: #12151b; color: #e6e9ef; }
    .tarjeta { background: #1c2028; box-shadow: none; }
    input[type=email], input[type=password], button { background: #12151b; color: #e6e9ef; border-color: #3a4150; }
    .aviso { background: #3a2c12; } .error { background: #3d1a1a; } small { color: #9aa3b2; }
  }`;

function documento(titulo: string, cuerpo: string): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapar(titulo)}</title>
<style>${ESTILO}</style>
</head>
<body><main><div class="tarjeta">${cuerpo}</div></main></body>
</html>`;
}

export function paginaLogin(
  datos: DatosConsentimiento,
  handle: string,
  opciones: { error?: string; email?: string } = {},
): string {
  const nombre = escapar(datos.clientName);
  const origen = datos.clientDomain
    ? `Publicada por <strong>${escapar(datos.clientDomain)}</strong>.`
    : 'Esta aplicación se registró sola: su nombre no está verificado.';
  return documento(
    `Conectar ${datos.clientName} con BanqueUNT`,
    `<h1>¿Conectar <strong>${nombre}</strong> con tu cuenta de BanqueUNT?</h1>
<p>${origen} El acceso se enviará a <strong>${escapar(datos.redirectHost)}</strong>.</p>
${
  datos.redirectIsLoopback
    ? '<p class="aviso">El acceso irá a una aplicación de <strong>tu computadora</strong>. Continúa solo si acabas de empezar a conectarla tú.</p>'
    : ''
}
<p>Podrá generar simulacros, corregirlos y ver tu progreso con las preguntas de tus cursos.</p>
${opciones.error ? `<p class="error" role="alert">${escapar(opciones.error)}</p>` : ''}
<form method="post">
  <input type="hidden" name="handle" value="${escapar(handle)}">
  <label for="email">Correo de BanqueUNT</label>
  <input id="email" name="email" type="email" autocomplete="username" required value="${escapar(opciones.email ?? '')}">
  <label for="password">Contraseña</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required>
  <div class="botones">
    <button type="submit" name="decision" value="deny" formnovalidate>Cancelar</button>
    <button type="submit" name="decision" value="approve" class="principal">Conectar</button>
  </div>
</form>
<p><small>Tu contraseña solo se usa para iniciar sesión en BanqueUNT; no se guarda.</small></p>`,
  );
}

export function paginaError(mensaje: string): string {
  return documento(
    'No se pudo conectar',
    `<h1>No se pudo conectar con BanqueUNT</h1>
<p class="error" role="alert">${escapar(mensaje)}</p>
<p>Vuelve a la aplicación que estabas conectando y empieza otra vez.</p>`,
  );
}
