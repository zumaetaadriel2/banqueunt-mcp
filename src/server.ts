import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CursoNoDisponible, type FuenteBanco } from './datos/fuentes.js';
import { estadisticasCurso, type EstadisticasCurso } from './dominio/estadisticas.js';

export const NOMBRE = 'banqueunt';
export const VERSION = '0.1.0';

const Conteo = z.object({ nombre: z.string(), preguntas: z.int() });

const SalidaEstadisticas = {
  origen: z.string().describe('De dónde salen las preguntas: "muestra" (pública) o "carpeta" (banco local)'),
  cursos: z.array(
    z.object({
      curso: z.string(),
      publicadas: z.int(),
      unicas: z.int(),
      claveNoOficial: z.int(),
      prioritarias: z.int(),
      explicacionConIA: z.int(),
      porEspecialidad: z.array(Conteo),
      porAnio: z.array(Conteo),
      porTema: z.array(Conteo).optional(),
    }),
  ),
};

function resumen(origen: string, cursos: EstadisticasCurso[]): string {
  const lineas = [`Banco BanqueUNT (origen: ${origen})`];
  for (const c of cursos) {
    lineas.push(
      '',
      `## ${c.curso}: ${c.unicas} preguntas distintas (${c.publicadas} publicadas)`,
      `Clave no oficial: ${c.claveNoOficial} · prioritarias: ${c.prioritarias} · explicación con IA: ${c.explicacionConIA}`,
      'Por especialidad:',
      ...c.porEspecialidad.map((e) => `- ${e.nombre}: ${e.preguntas}`),
      'Por año:',
      ...c.porAnio.map((e) => `- ${e.nombre}: ${e.preguntas}`),
    );
    if (c.porTema) {
      lineas.push(
        c.porTema.length ? 'Por tema:' : 'No hay preguntas de esa especialidad.',
        ...c.porTema.map((e) => `- ${e.nombre}: ${e.preguntas}`),
      );
    }
  }
  return lineas.join('\n');
}

const error = (texto: string) => ({ content: [{ type: 'text' as const, text: texto }], isError: true });

export function crearServidor(fuente: FuenteBanco): McpServer {
  const server = new McpServer(
    { name: NOMBRE, version: VERSION },
    {
      instructions:
        'Banco de preguntas médicas de BanqueUNT (UNT, Perú). Usa estadisticas_banco para saber qué cursos, ' +
        'especialidades y años hay antes de proponer un simulacro.',
    },
  );

  server.registerTool(
    'estadisticas_banco',
    {
      title: 'Estadísticas del banco',
      description:
        'Cuenta las preguntas del banco por curso, especialidad y año (y por tema si se indica una especialidad). ' +
        'Las preguntas repetidas en varios exámenes se cuentan una sola vez. No devuelve preguntas ni respuestas.',
      inputSchema: {
        curso: z
          .string()
          .optional()
          .describe('Id del curso, p. ej. "med2_unt". Sin él: todos los disponibles'),
        especialidad: z
          .string()
          .optional()
          .describe('Si se indica, añade el conteo por tema de esa especialidad (p. ej. "Cardiología")'),
      },
      outputSchema: SalidaEstadisticas,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ curso, especialidad }) => {
      try {
        const disponibles = await fuente.cursos();
        const elegidos = curso ? [curso] : disponibles;
        if (curso && !disponibles.includes(curso)) {
          return error(
            `El curso «${curso}» no está disponible. Cursos disponibles: ${disponibles.join(', ') || 'ninguno'}.`,
          );
        }
        const cursos = await Promise.all(
          elegidos.map(async (c) => estadisticasCurso(c, await fuente.preguntas(c), especialidad)),
        );
        const salida = { origen: fuente.origen, cursos };
        return {
          content: [{ type: 'text', text: resumen(fuente.origen, cursos) }],
          structuredContent: salida,
        };
      } catch (e) {
        if (e instanceof CursoNoDisponible) return error(e.message);
        return error(`No se pudo leer el banco: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  return server;
}
