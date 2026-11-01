import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Banco } from '../dominio/banco.js';
import type { ProgresoRepo } from '../persistencia/repo.js';

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
}

export function error(texto: string): CallToolResult {
  return { content: [{ type: 'text', text: texto }], isError: true };
}

export function resultado(texto: string, estructurado: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text: texto }], structuredContent: estructurado };
}

/** Cualquier error (curso no disponible, respuestas inválidas, banco ilegible…) vuelve como isError. */
export async function ejecutar(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (e) {
    return error(e instanceof Error ? e.message : String(e));
  }
}
