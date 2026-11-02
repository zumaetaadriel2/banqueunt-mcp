import {
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  originValidationResponse,
  type McpHttpHandler,
} from '@modelcontextprotocol/server';
import muestra from '../data/muestra.json' with { type: 'json' };
import { leerCursos, MuestraEmbebida } from './datos/fuentes.js';
import { Banco } from './dominio/banco.js';
import { leerTopeDiario } from './dominio/limites.js';
import { D1ProgresoRepo, type BaseD1 } from './persistencia/d1.js';
import { crearServidor } from './server.js';

/**
 * Entrada remota (Cloudflare Workers): MCP por Streamable HTTP en /mcp, sin estado. Cada petición la
 * atiende un servidor nuevo de la misma fábrica, así que no hay sesiones que guardar entre réplicas.
 *
 * Fase 6a: solo la muestra pública y sin login, así que todos comparten el usuario «anonimo». No se
 * despliega en público hasta la 6b (OAuth con Supabase), donde el usuario sale del token.
 */
interface Env {
  DB: BaseD1;
  BANQUEUNT_CURSOS?: string;
  BANQUEUNT_TOPE_DIARIO?: string;
  /** Hostnames públicos además de localhost, separados por comas (p. ej. banqueunt-mcp.<cuenta>.workers.dev) */
  BANQUEUNT_HOSTS?: string;
}

const RUTA = '/mcp';
const USUARIO_ANONIMO = 'anonimo';

// Viven lo que viva el isolate: la muestra se valida y deduplica una sola vez, no en cada petición
let banco: Banco | undefined;
let handler: McpHttpHandler | undefined;

function lista(valor: string | undefined): string[] {
  return (valor ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname !== RUTA) {
      return new Response(`BanqueUNT MCP: el servidor MCP está en ${RUTA}\n`, { status: 404 });
    }

    // El SDK no valida Host ni Origin por su cuenta (protección contra DNS rebinding)
    const hosts = lista(env.BANQUEUNT_HOSTS);
    const rechazo =
      hostHeaderValidationResponse(request, [...localhostAllowedHostnames(), ...hosts]) ??
      originValidationResponse(request, [...localhostAllowedOrigins(), ...hosts]);
    if (rechazo) return rechazo;

    if (!handler) {
      banco ??= new Banco(new MuestraEmbebida(muestra, leerCursos(env.BANQUEUNT_CURSOS)));
      const repo = new D1ProgresoRepo(env.DB);
      const topeDiario = leerTopeDiario(env.BANQUEUNT_TOPE_DIARIO);
      const b = banco;
      handler = createMcpHandler(() => crearServidor(b, repo, { usuario: USUARIO_ANONIMO, topeDiario }));
    }
    return handler.fetch(request);
  },
};
