import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { estadisticasCurso, type EstadisticasCurso } from '../dominio/estadisticas.js';
import { ejecutar, resultado, type Contexto } from './contexto.js';

const Conteo = z.object({ nombre: z.string(), preguntas: z.int() });

const Salida = {
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

export function registrarEstadisticas(server: McpServer, ctx: Contexto): void {
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
      outputSchema: Salida,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ curso, especialidad }) =>
      ejecutar(ctx, 'estadisticas_banco', async () => {
        const elegidos = curso ? [await ctx.banco.resolverCurso(curso)] : await ctx.banco.cursos();
        const cursos = await Promise.all(
          elegidos.map(async (c) => estadisticasCurso(c, await ctx.banco.publicadas(c), especialidad)),
        );
        return resultado(resumen(ctx.banco.origen, cursos), { origen: ctx.banco.origen, cursos });
      }),
  );
}
