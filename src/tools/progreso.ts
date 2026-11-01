import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { calcularProgreso, MIN_PARA_DEBIL } from '../dominio/progreso.js';
import { ejecutar, resultado, type Contexto } from './contexto.js';
import { Rendimiento } from './esquemas.js';

export function registrarProgreso(server: McpServer, ctx: Contexto): void {
  server.registerTool(
    'mi_progreso',
    {
      title: 'Mi progreso',
      description:
        'Resume los simulacros corregidos del alumno: porcentaje global, rendimiento por especialidad, temas ' +
        'débiles (2+ respuestas), temas fallados recientemente y últimos simulacros. Úsalo para recomendar qué repasar.',
      inputSchema: { curso: z.string().optional().describe('Solo ese curso; sin él, todos') },
      outputSchema: {
        simulacros: z.int(),
        respondidas: z.int(),
        aciertos: z.int(),
        porcentaje: z.int(),
        porEspecialidad: z.array(Rendimiento),
        temasDebiles: z.array(Rendimiento.extend({ especialidad: z.string() })),
        temasFallados: z.array(
          z.object({
            nombre: z.string(),
            especialidad: z.string(),
            fallas: z.int(),
            ultimaFalla: z.string(),
          }),
        ),
        ultimos: z.array(
          z.object({
            id: z.string(),
            curso: z.string(),
            creadoEn: z.string(),
            corregidoEn: z.string(),
            aciertos: z.int(),
            total: z.int(),
            porcentaje: z.int(),
          }),
        ),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ curso }) =>
      ejecutar(async () => {
        const p = calcularProgreso(
          await ctx.repo.simulacrosCorregidos(ctx.usuario, curso),
          await ctx.repo.itemsRespondidos(ctx.usuario, curso),
        );
        const texto =
          p.simulacros === 0
            ? 'Todavía no hay simulacros corregidos. Genera uno con generar_simulacro.'
            : [
                `${p.simulacros} simulacros corregidos · ${p.aciertos}/${p.respondidas} aciertos (${p.porcentaje} %)`,
                'Por especialidad (de menor a mayor %):',
                ...p.porEspecialidad.map(
                  (e) => `- ${e.nombre}: ${e.aciertos}/${e.respondidas} (${e.porcentaje} %)`,
                ),
                p.temasDebiles.length
                  ? 'Temas más débiles:'
                  : `Aún no hay temas débiles (se necesitan ${MIN_PARA_DEBIL}+ respuestas por tema).`,
                ...p.temasDebiles.map(
                  (t) =>
                    `- ${t.nombre} (${t.especialidad}): ${t.aciertos}/${t.respondidas} (${t.porcentaje} %)`,
                ),
                p.temasFallados.length
                  ? 'Temas fallados recientemente (para repasar):'
                  : 'Sin temas fallados.',
                ...p.temasFallados.map(
                  (t) => `- ${t.nombre} (${t.especialidad})${t.fallas > 1 ? ` · ${t.fallas} fallas` : ''}`,
                ),
                'Últimos simulacros:',
                ...p.ultimos.map(
                  (s) =>
                    `- ${s.id} · ${s.corregidoEn.slice(0, 10)} · ${s.aciertos}/${s.total} (${s.porcentaje} %)`,
                ),
              ].join('\n');
        return resultado(texto, { ...p });
      }),
  );
}
