import { completable, type GetPromptResult, type McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { estadisticasCurso } from './dominio/estadisticas.js';
import { normalizarTexto } from './dominio/busqueda.js';
import { calcularProgreso } from './dominio/progreso.js';
import type { Contexto } from './tools/contexto.js';

const MAX_TEMAS_REPASO = 10;

function mensaje(descripcion: string, texto: string): GetPromptResult {
  return { description: descripcion, messages: [{ role: 'user', content: { type: 'text', text: texto } }] };
}

/** Los argumentos de un prompt siempre llegan como texto: «10» → 10, con límites y un valor por defecto */
function cantidadDe(valor: string | undefined, porDefecto: number, maximo: number): number {
  const n = Number.parseInt(valor ?? '', 10);
  return Number.isInteger(n) && n > 0 ? Math.min(n, maximo) : porDefecto;
}

const lista = (valores: string[]) => JSON.stringify(valores);

export function registrarPrompts(server: McpServer, ctx: Contexto): void {
  const completarCurso = async (valor: string | undefined) =>
    (await ctx.banco.cursos()).filter((c) => c.startsWith((valor ?? '').toLowerCase()));

  const completarEspecialidad = async (
    valor: string | undefined,
    contexto?: { arguments?: Record<string, string> },
  ) => {
    try {
      const curso = await ctx.banco.resolverCurso(contexto?.arguments?.curso || undefined);
      const nombres = estadisticasCurso(curso, await ctx.banco.publicadas(curso)).porEspecialidad.map(
        (e) => e.nombre,
      );
      const buscado = normalizarTexto(valor ?? '');
      return nombres.filter((n) => normalizarTexto(n).startsWith(buscado));
    } catch {
      return [];
    }
  };

  server.registerPrompt(
    'sesion_de_repaso',
    {
      title: 'Sesión de repaso con tutor',
      description: 'Repaso pregunta por pregunta: el tutor pregunta, espera tu respuesta, corrige y explica.',
      argsSchema: z.object({
        curso: completable(z.string().describe('Curso, p. ej. med2_unt'), completarCurso).optional(),
        especialidad: completable(z.string().describe('P. ej. Nefrología'), completarEspecialidad).optional(),
        cantidad: z.string().optional().describe('Cuántas preguntas (por defecto 5, máximo 20)'),
      }),
    },
    async ({ curso, especialidad, cantidad }) => {
      const n = cantidadDe(cantidad, 5, 20);
      const argumentos = [
        'cantidad: 1',
        curso ? `curso: "${curso}"` : '',
        especialidad ? `especialidades: ${lista([especialidad])}` : '',
      ]
        .filter(Boolean)
        .join(', ');
      return mensaje(
        `Repaso de ${n} preguntas${especialidad ? ` de ${especialidad}` : ''}`,
        `Quiero una sesión de repaso tipo tutor con el banco de BanqueUNT: ${n} preguntas` +
          `${especialidad ? ` de ${especialidad}` : ''}, una a la vez.\n\n` +
          `Para cada pregunta:\n` +
          `1. Llama a generar_simulacro con { ${argumentos} }.\n` +
          `2. Muéstrame la pregunta y sus alternativas tal cual, sin pistas ni resolverla, y espera mi respuesta.\n` +
          `3. Con la letra que te dé, llama a corregir_simulacro con ese simulacro_id.\n` +
          `4. Dime si acerté y explícame con lo que devuelve la corrección: la idea clave, por qué mi opción no ` +
          `era (si fallé) y qué recordar. Si trae avisos («Clave no oficial», «Explicación elaborada con IA»), ` +
          `menciónalos.\n` +
          `5. Pasa a la siguiente.\n\n` +
          `Al terminar, dime cuántas acerté y llama a mi_progreso para sugerirme qué repasar después.`,
      );
    },
  );

  server.registerPrompt(
    'repasar_temas_debiles',
    {
      title: 'Repasar mis temas débiles',
      description: 'Arma un simulacro con los temas que más te cuestan o que fallaste hace poco.',
      argsSchema: z.object({
        curso: completable(z.string().describe('Curso, p. ej. med2_unt'), completarCurso).optional(),
        cantidad: z.string().optional().describe('Cuántas preguntas (por defecto 10, máximo 30)'),
      }),
    },
    async ({ curso, cantidad }) => {
      const n = cantidadDe(cantidad, 10, 30);
      const cursoElegido = curso ? await ctx.banco.resolverCurso(curso) : undefined;
      const p = calcularProgreso(
        await ctx.repo.simulacrosCorregidos(ctx.usuario, cursoElegido),
        await ctx.repo.itemsRespondidos(ctx.usuario, cursoElegido),
      );

      if (p.respondidas === 0) {
        return mensaje(
          'Todavía no hay progreso',
          'Quiero repasar mis temas débiles, pero aún no he hecho simulacros. Hazme primero un simulacro de ' +
            `${n} preguntas con generar_simulacro${curso ? ` (curso "${curso}")` : ''}, corrígelo y luego ` +
            'dime qué temas debo reforzar.',
        );
      }

      // Primero los débiles (2+ respuestas, menor %), luego los fallados recientes; sin repetir
      const temas = [
        ...new Set([...p.temasDebiles.map((t) => t.nombre), ...p.temasFallados.map((t) => t.nombre)]),
      ].slice(0, MAX_TEMAS_REPASO);
      const especialidadMasDebil = p.porEspecialidad[0]?.nombre;

      if (temas.length === 0) {
        return mensaje(
          'Sin temas fallados',
          `No he fallado ningún tema todavía (${p.aciertos}/${p.respondidas}). Hazme un simulacro de ${n} ` +
            `preguntas nuevas con generar_simulacro${especialidadMasDebil ? ` de ${especialidadMasDebil}` : ''} ` +
            'para seguir midiendo.',
        );
      }

      return mensaje(
        `Repaso de ${temas.length} temas`,
        `Quiero repasar mis temas débiles del banco de BanqueUNT. Según mi progreso ` +
          `(${p.aciertos}/${p.respondidas}, ${p.porcentaje} %), estos son los que debo reforzar:\n` +
          temas.map((t) => `- ${t}`).join('\n') +
          `\n\n1. Llama a generar_simulacro con { cantidad: ${n}, temas: ${lista(temas)}` +
          `${cursoElegido ? `, curso: "${cursoElegido}"` : ''}, excluir_vistas: true }. Así salen primero ` +
          `preguntas nuevas de esos temas y, si no alcanzan, las que ya fallé.\n` +
          `2. Si salen menos de ${n}, dímelo y ofréceme completar con otro simulacro` +
          `${especialidadMasDebil ? ` de ${especialidadMasDebil}, mi especialidad más floja` : ''}.\n` +
          `3. Muéstrame las preguntas sin resolverlas, espera mis respuestas y corrígelas con corregir_simulacro.\n` +
          `4. Explícame las que falle y, al final, compara con mi_progreso si mejoré en esos temas.`,
      );
    },
  );
}
