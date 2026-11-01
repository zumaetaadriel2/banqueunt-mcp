import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { filtrar, paginar } from '../dominio/busqueda.js';
import { aPreguntaPublica, textoPregunta } from '../dominio/publico.js';
import { ejecutar, resultado, type Contexto } from './contexto.js';
import { PreguntaPublica } from './esquemas.js';

export const LIMITE_BUSQUEDA = 20;

export function registrarBuscar(server: McpServer, ctx: Contexto): void {
  server.registerTool(
    'buscar_preguntas',
    {
      title: 'Buscar preguntas',
      description:
        'Busca preguntas del banco por texto y filtros. Devuelve enunciado y alternativas, nunca la respuesta ' +
        'ni la explicación. Para practicar con corrección usa generar_simulacro.',
      inputSchema: {
        curso: z.string().optional().describe('Id del curso; opcional si el servidor tiene uno solo'),
        texto: z
          .string()
          .optional()
          .describe('Palabras que deben aparecer (sin importar tildes ni mayúsculas)'),
        especialidad: z.string().optional().describe('P. ej. "Cardiología"'),
        tema: z.string().optional().describe('Parte del nombre del tema'),
        anio: z.string().optional().describe('P. ej. "2021" o "Sin fecha"'),
        dificultad: z.string().optional().describe('"Fácil", "Intermedio" o "Difícil"'),
        solo_prioritarias: z.boolean().optional(),
        limite: z.int().min(1).max(LIMITE_BUSQUEDA).default(10),
        cursor: z.string().optional().describe('El valor "siguiente" de la página anterior'),
      },
      outputSchema: {
        curso: z.string(),
        total: z.int(),
        preguntas: z.array(PreguntaPublica),
        siguiente: z.string().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) =>
      ejecutar(ctx, 'buscar_preguntas', async (servir) => {
        const curso = await ctx.banco.resolverCurso(args.curso);
        const encontradas = filtrar(await ctx.banco.unicas(curso), {
          texto: args.texto,
          especialidades: args.especialidad ? [args.especialidad] : undefined,
          temas: args.tema ? [args.tema] : undefined,
          anios: args.anio ? [args.anio] : undefined,
          dificultad: args.dificultad,
          soloPrioritarias: args.solo_prioritarias,
        });
        const { pagina, siguiente } = paginar(encontradas, args.limite, args.cursor);
        await servir(pagina.length);
        const preguntas = pagina.map(aPreguntaPublica);
        const texto = encontradas.length
          ? [
              `${encontradas.length} preguntas encontradas en ${curso}; se muestran ${preguntas.length}.`,
              ...preguntas.map((q) => `\n(${q.id}) ${textoPregunta(q)}`),
              siguiente ? `\nHay más: vuelve a llamar con cursor "${siguiente}".` : '',
            ].join('\n')
          : `No hay preguntas en ${curso} con esos filtros.`;
        return resultado(texto, {
          curso,
          total: encontradas.length,
          preguntas,
          ...(siguiente ? { siguiente } : {}),
        });
      }),
  );
}
