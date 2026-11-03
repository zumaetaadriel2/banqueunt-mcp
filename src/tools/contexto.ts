import type { CallToolResult } from '@modelcontextprotocol/server';
import type { Banco } from '../dominio/banco.js';
import { inicioDelDia, mensajeTope } from '../dominio/limites.js';
import type { Llamada, ProgresoRepo } from '../persistencia/repo.js';

export interface Contexto {
  banco: Banco;
  repo: ProgresoRepo;
  /** Local: siempre 'local'. Remoto (Fase 6): el id de la cuenta de BanqueUNT */
  usuario: string;
  ahora: () => Date;
  rng: () => number;
  nuevoId: () => string;
  /** Cuánto tiempo se puede corregir un simulacro después de generarlo */
  vigenciaSimulacroMs: number;
  /** Preguntas que un usuario puede recibir al día; null = sin tope (lo normal en local) */
  topeDiario: number | null;
}

/** Antes de entregar preguntas: comprueba el tope diario y las anota en la llamada */
export type Servir = (cantidad: number) => Promise<void>;

class TopeDiarioAlcanzado extends Error {}

export function error(texto: string): CallToolResult {
  return { content: [{ type: 'text', text: texto }], isError: true };
}

export function resultado(texto: string, estructurado: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text: texto }], structuredContent: estructurado };
}

/**
 * Ejecuta una herramienta o recurso y deja exactamente una fila en el registro de llamadas: 'ok',
 * 'error' o 'limite'. Solo las 'ok' cuentan para el tope diario.
 */
export async function registrado<T>(
  ctx: Contexto,
  herramienta: string,
  fn: (servir: Servir) => Promise<T>,
  esError: (r: T) => boolean = () => false,
): Promise<T> {
  let cantidad = 0;
  const registrar = (estado: Llamada['resultado'], n = cantidad) =>
    ctx.repo.registrarLlamada({
      usuario: ctx.usuario,
      herramienta,
      cantidad: n,
      en: ctx.ahora().toISOString(),
      resultado: estado,
    });

  const servir: Servir = async (n) => {
    if (ctx.topeDiario !== null) {
      const desde = inicioDelDia(ctx.ahora()).toISOString();
      const servidas = await ctx.repo.preguntasServidas(ctx.usuario, desde);
      if (servidas + cantidad + n > ctx.topeDiario) {
        await registrar('limite', cantidad + n);
        throw new TopeDiarioAlcanzado(mensajeTope(ctx.topeDiario, servidas, cantidad + n));
      }
    }
    cantidad += n;
  };

  try {
    const r = await fn(servir);
    await registrar(esError(r) ? 'error' : 'ok');
    return r;
  } catch (e) {
    if (!(e instanceof TopeDiarioAlcanzado)) await registrar('error');
    throw e;
  }
}

/** Cualquier error (curso no disponible, respuestas inválidas, tope diario…) vuelve como isError. */
export async function ejecutar(
  ctx: Contexto,
  herramienta: string,
  fn: (servir: Servir) => Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    return await registrado(ctx, herramienta, fn, (r) => r.isError === true);
  } catch (e) {
    return error(e instanceof Error ? e.message : String(e));
  }
}
