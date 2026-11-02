import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/server';
import type { FuenteBanco } from './datos/fuentes.js';
import { Banco } from './dominio/banco.js';
import type { ProgresoRepo } from './persistencia/repo.js';
import { registrarPrompts } from './prompts.js';
import { registrarRecursos } from './recursos.js';
import { registrarBuscar } from './tools/buscar.js';
import type { Contexto } from './tools/contexto.js';
import { registrarEstadisticas } from './tools/estadisticas.js';
import { registrarProgreso } from './tools/progreso.js';
import { registrarSimulacros } from './tools/simulacros.js';

export const NOMBRE = 'banqueunt';
export const VERSION = '0.1.0';

const INSTRUCCIONES = `Banco de preguntas médicas de BanqueUNT (UNT, Perú) para practicar.
- Usa estadisticas_banco para ver cursos, especialidades y años antes de proponer un simulacro.
- Flujo de práctica: generar_simulacro → mostrar las preguntas → el alumno responde → corregir_simulacro.
- No resuelvas, insinúes ni adelantes las respuestas antes de corregir: el alumno está practicando.
- Después de corregir, explica las falladas con lo que devuelve la corrección y respeta sus avisos
  («Clave no oficial», «Explicación elaborada con IA»).
- mi_progreso dice qué temas reforzar (débiles y fallados recientes); explicar_pregunta repasa una pregunta
  ya corregida.`;

export interface OpcionesServidor {
  usuario?: string;
  ahora?: () => Date;
  rng?: () => number;
  nuevoId?: () => string;
  vigenciaSimulacroMs?: number;
  /** Preguntas que un usuario puede recibir al día; sin él (o null), no hay tope */
  topeDiario?: number | null;
}

export function crearServidor(
  fuente: FuenteBanco,
  repo: ProgresoRepo,
  opciones: OpcionesServidor = {},
): McpServer {
  const server = new McpServer({ name: NOMBRE, version: VERSION }, { instructions: INSTRUCCIONES });
  const ctx: Contexto = {
    banco: new Banco(fuente),
    repo,
    usuario: opciones.usuario ?? 'local',
    ahora: opciones.ahora ?? (() => new Date()),
    rng: opciones.rng ?? Math.random,
    nuevoId: opciones.nuevoId ?? (() => randomUUID().replace(/-/g, '').slice(0, 12)),
    vigenciaSimulacroMs: opciones.vigenciaSimulacroMs ?? 24 * 60 * 60 * 1000,
    topeDiario: opciones.topeDiario ?? null,
  };

  registrarEstadisticas(server, ctx);
  registrarBuscar(server, ctx);
  registrarSimulacros(server, ctx);
  registrarProgreso(server, ctx);
  registrarRecursos(server, ctx);
  registrarPrompts(server, ctx);
  return server;
}
