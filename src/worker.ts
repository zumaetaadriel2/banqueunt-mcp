import {
  AuthorizationError,
  CimdFetchError,
  GrantType,
  OAuthError,
  OAuthProvider,
  type OAuthHelpers,
  type TokenExchangeCallbackOptions,
} from '@cloudflare/workers-oauth-provider';
import {
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  originValidationResponse,
} from '@modelcontextprotocol/server';
import muestra from '../data/muestra.json' with { type: 'json' };
import { leerCursos, MuestraEmbebida } from './datos/fuentes.js';
import { Banco } from './dominio/banco.js';
import { leerTopeDiario } from './dominio/limites.js';
import { D1ProgresoRepo } from './persistencia/d1.js';
import {
  autorizar,
  leerPropsAcceso,
  propsPublicas,
  renovarAcceso,
  SinCursos,
  type PropsGrant,
} from './remoto/acceso.js';
import { IntentosLogin } from './remoto/intentos.js';
import { cabecerasHtml, paginaError, paginaLogin, type DatosConsentimiento } from './remoto/pagina.js';
import { ClienteSupabase, CredencialesInvalidas } from './remoto/supabase.js';
import { crearServidor } from './server.js';

/**
 * Entrada remota (Cloudflare Workers). Un solo Worker hace de:
 * - servidor de autorización OAuth 2.1 (workers-oauth-provider): /authorize (login con la cuenta de
 *   BanqueUNT), /oauth/token, /oauth/register y los metadatos de descubrimiento;
 * - recurso protegido /mcp: MCP por Streamable HTTP sin estado, con el usuario y los cursos del token.
 */

const RUTA_MCP = '/mcp';
const RUTA_AUTORIZAR = '/authorize';
const ESCOPO = 'banqueunt';
/** La descripción del cliente para volver a mostrar la página tras un error de login (vive con el handle) */
const PREFIJO_CONSENTIMIENTO = 'banqueunt:consentimiento:';
const VIDA_CONSENTIMIENTO_S = 600;

type EnvConOAuth = Env & { OAUTH_PROVIDER: OAuthHelpers };

// Viven lo que viva el isolate: la muestra se valida y deduplica una sola vez para todos los alumnos
let banco: Banco | undefined;
let proveedor: OAuthProvider<Env> | undefined;

const origenDe = (env: Env) => new URL(env.BANQUEUNT_ORIGEN).origin;
const supabase = (env: Env) => new ClienteSupabase({ url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY });

function html(cuerpo: string, status = 200, headers?: Headers): Response {
  return new Response(cuerpo, { status, headers: cabecerasHtml(headers) });
}

const mcp = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // El SDK no valida Host ni Origin por su cuenta (protección contra DNS rebinding)
    const host = new URL(origenDe(env)).hostname;
    const rechazo =
      hostHeaderValidationResponse(request, [...localhostAllowedHostnames(), host]) ??
      originValidationResponse(request, [...localhostAllowedOrigins(), host]);
    if (rechazo) return rechazo;

    // workers-oauth-provider ya validó el token: ctx.props son las props del grant (sin el refresh de Supabase)
    const acceso = leerPropsAcceso((ctx as ExecutionContext<unknown>).props);
    if (!acceso) return new Response('Token sin usuario', { status: 403 });

    banco ??= new Banco(new MuestraEmbebida(muestra, leerCursos(env.BANQUEUNT_CURSOS)));
    const delAlumno = banco.restringido(acceso.cursos);
    const repo = new D1ProgresoRepo(env.DB);
    const topeDiario = leerTopeDiario(env.BANQUEUNT_TOPE_DIARIO);
    const handler = createMcpHandler(() =>
      crearServidor(delAlumno, repo, { usuario: acceso.usuario, topeDiario }),
    );
    return handler.fetch(request);
  },
} satisfies ExportedHandler<Env>;

async function mostrarLogin(request: Request, env: EnvConOAuth): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  const pedido = await oauth.parseAuthRequest(request);
  const descripcion = await oauth.describeConsent(pedido);
  const datos: DatosConsentimiento = {
    clientName: descripcion.clientName,
    clientDomain: descripcion.clientDomain,
    redirectHost: descripcion.redirectHost,
    redirectIsLoopback: descripcion.redirectIsLoopback,
  };
  const consentimiento = await oauth.beginConsent(pedido);
  await env.OAUTH_KV.put(PREFIJO_CONSENTIMIENTO + consentimiento.handle, JSON.stringify(datos), {
    expirationTtl: VIDA_CONSENTIMIENTO_S,
  });
  return html(paginaLogin(datos, consentimiento.handle), 200, consentimiento.headers);
}

async function procesarLogin(request: Request, env: EnvConOAuth): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  const form = await request.formData();
  const handle = String(form.get('handle') ?? '');

  if (form.get('decision') !== 'approve') {
    const denegado = await oauth.denyConsent(request, handle);
    return new Response(null, { status: 302, headers: denegado.headers });
  }

  const email = String(form.get('email') ?? '').trim();
  const password = String(form.get('password') ?? '');
  const guardado = await env.OAUTH_KV.get(PREFIJO_CONSENTIMIENTO + handle);
  if (!guardado) {
    return html(paginaError('La página de inicio de sesión venció o ya se usó.'), 400);
  }
  const datos = JSON.parse(guardado) as DatosConsentimiento;
  // Mismo handle: approveConsent() todavía no lo consumió, así que el alumno puede reintentar
  const reintentar = (error: string, status = 400) =>
    html(paginaLogin(datos, handle, { error, email }), status);

  const intentos = new IntentosLogin(env.DB);
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  if (!email || !password) return reintentar('Escribe tu correo y tu contraseña.');
  if (!(await intentos.permitido(email, ip))) {
    return reintentar('Demasiados intentos fallidos. Espera 15 minutos y vuelve a intentarlo.', 429);
  }

  let props: PropsGrant;
  try {
    props = await autorizar(supabase(env), email, password);
  } catch (e) {
    if (e instanceof CredencialesInvalidas) {
      await intentos.registrarFallo(email, ip);
      return reintentar('Correo o contraseña incorrectos (o la cuenta aún no confirmó su correo).', 401);
    }
    if (e instanceof SinCursos) return reintentar(e.message, 403);
    throw e;
  }

  const aprobado = await oauth.approveConsent(request, handle, { scope: [ESCOPO] });
  await env.OAUTH_KV.delete(PREFIJO_CONSENTIMIENTO + handle);
  const { redirectTo } = await oauth.completeAuthorization({
    request: aprobado.request,
    userId: props.usuario,
    metadata: { email: props.email },
    scope: [ESCOPO],
    props,
  });
  aprobado.headers.set('Location', redirectTo);
  return new Response(null, { status: 302, headers: aprobado.headers });
}

const paginas: ExportedHandler<Env> = {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname !== RUTA_AUTORIZAR) {
      return new Response(`BanqueUNT MCP: conecta tu asistente a ${origenDe(env)}${RUTA_MCP}\n`, {
        status: pathname === '/' ? 200 : 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
    try {
      if (request.method === 'GET') return await mostrarLogin(request, env as EnvConOAuth);
      if (request.method === 'POST') return await procesarLogin(request, env as EnvConOAuth);
      return new Response(null, { status: 405, headers: { Allow: 'GET, POST' } });
    } catch (e) {
      // Redirigir al cliente solo si la librería ya validó su redirect URI; si no, mostrar el error aquí
      if (e instanceof AuthorizationError && e.redirectTo) return Response.redirect(e.redirectTo, 302);
      if (e instanceof AuthorizationError) {
        // Página vencida, ya usada o abierta en otro navegador, o un pedido de autorización inválido
        console.error('authorize:', e.code, e.description);
        return html(paginaError('El pedido de conexión no es válido, venció o ya se usó.'), 400);
      }
      if (e instanceof CimdFetchError) return html(paginaError('No se pudo verificar la aplicación.'), 400);
      throw e;
    }
  },
};

/**
 * Al canjear el código, el token de acceso lleva solo usuario, correo y cursos. Al renovarlo, se renueva
 * la sesión de Supabase y se vuelve a leer mis_cursos(): si la cuenta ya no tiene acceso, se corta.
 */
async function alCanjearToken({ grantType, props, env }: TokenExchangeCallbackOptions<Env>) {
  const grant = props as PropsGrant;
  if (grantType === GrantType.AUTHORIZATION_CODE) return { accessTokenProps: propsPublicas(grant) };
  if (grantType !== GrantType.REFRESH_TOKEN) return undefined;
  try {
    const renovado = await renovarAcceso(supabase(env), grant);
    return { newProps: renovado, accessTokenProps: propsPublicas(renovado) };
  } catch (e) {
    if (e instanceof CredencialesInvalidas || e instanceof SinCursos) {
      throw new OAuthError('invalid_grant', {
        description: 'La sesión de BanqueUNT ya no es válida: vuelve a conectar tu cuenta.',
      });
    }
    throw e;
  }
}

function crearProveedor(env: Env): OAuthProvider<Env> {
  const origen = origenDe(env);
  return new OAuthProvider<Env>({
    apiRoute: RUTA_MCP,
    apiHandler: mcp,
    defaultHandler: paginas,
    authorizeEndpoint: RUTA_AUTORIZAR,
    tokenEndpoint: '/oauth/token',
    // Registro dinámico (lo usan varios clientes) y CIMD (lo que recomienda la especificación de MCP)
    clientRegistrationEndpoint: '/oauth/register',
    clientIdMetadataDocumentEnabled: true,
    scopesSupported: [ESCOPO],
    requiredScopes: [ESCOPO],
    resourceMetadata: {
      resource: `${origen}${RUTA_MCP}`,
      authorization_servers: [origen],
      resource_name: 'BanqueUNT',
    },
    // 1 h de acceso: cada renovación vuelve a consultar mis_cursos(). La sesión dura mientras se use.
    accessTokenTTL: 60 * 60,
    refreshTokenIdleTTL: 30 * 24 * 60 * 60,
    tokenExchangeCallback: alCanjearToken,
  });
}

export default {
  fetch(request, env, ctx) {
    proveedor ??= crearProveedor(env);
    return proveedor.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
