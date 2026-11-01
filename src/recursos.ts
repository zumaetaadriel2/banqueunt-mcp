import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { estadisticasCurso } from './dominio/estadisticas.js';
import { aPreguntaPublica } from './dominio/publico.js';
import { registrado, type Contexto } from './tools/contexto.js';

function json(uri: URL, datos: unknown): ReadResourceResult {
  return {
    contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(datos, null, 2) }],
  };
}

const variable = (v: string | string[] | undefined) =>
  decodeURIComponent((Array.isArray(v) ? v[0] : v) ?? '');

/**
 * Recursos: datos de solo lectura que el cliente puede adjuntar al contexto sin llamar herramientas.
 * Igual que las herramientas previas a la corrección, nunca incluyen claves ni fundamentos.
 */
export function registrarRecursos(server: McpServer, ctx: Contexto): void {
  const completarCurso = async (valor: string) =>
    (await ctx.banco.cursos()).filter((c) => c.startsWith(valor.toLowerCase()));

  server.registerResource(
    'cursos',
    'banqueunt://cursos',
    {
      title: 'Cursos disponibles',
      description: 'Cursos del banco con su número de preguntas, especialidades y años',
      mimeType: 'application/json',
    },
    async (uri) => {
      const cursos = await Promise.all(
        (await ctx.banco.cursos()).map(async (curso) => {
          const s = estadisticasCurso(curso, await ctx.banco.publicadas(curso));
          return {
            curso,
            preguntas: s.unicas,
            especialidades: s.porEspecialidad,
            anios: s.porAnio.map((a) => a.nombre),
          };
        }),
      );
      return json(uri, { origen: ctx.banco.origen, cursos });
    },
  );

  server.registerResource(
    'temas-del-curso',
    new ResourceTemplate('banqueunt://cursos/{curso}/temas', {
      list: async () => ({
        resources: (await ctx.banco.cursos()).map((curso) => ({
          uri: `banqueunt://cursos/${curso}/temas`,
          name: `Temas de ${curso}`,
          mimeType: 'application/json',
        })),
      }),
      complete: { curso: completarCurso },
    }),
    {
      title: 'Temas de un curso',
      description: 'Especialidades y temas de un curso, con cuántas preguntas tiene cada uno',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const curso = await ctx.banco.resolverCurso(variable(variables.curso));
      const unicas = await ctx.banco.unicas(curso);
      const especialidades = estadisticasCurso(curso, unicas).porEspecialidad.map((e) => ({
        nombre: e.nombre,
        preguntas: e.preguntas,
        temas: estadisticasCurso(curso, unicas, e.nombre).porTema ?? [],
      }));
      return json(uri, { curso, especialidades });
    },
  );

  server.registerResource(
    'pregunta',
    new ResourceTemplate('banqueunt://pregunta/{id}', { list: undefined }),
    {
      title: 'Pregunta (versión pública)',
      description: 'Enunciado y alternativas de una pregunta por su id, sin respuesta ni explicación',
      mimeType: 'application/json',
    },
    // Entrega una pregunta, así que cuenta para el tope diario igual que buscar_preguntas
    (uri, variables) =>
      registrado(ctx, 'recurso:pregunta', async (servir) => {
        const id = variable(variables.id);
        const q = await ctx.banco.buscarEnCursos(id);
        if (!q) throw new Error(`No existe la pregunta «${id}».`);
        await servir(1);
        return json(uri, aPreguntaPublica(q));
      }),
  );
}
