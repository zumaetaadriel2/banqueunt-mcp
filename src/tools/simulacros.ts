import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { firmaPregunta } from '../datos/firma.js';
import { avisosDe, letra, normalizarExplicacion } from '../datos/normalizar.js';
import { filtrar } from '../dominio/busqueda.js';
import { aPreguntaPublica, textoPregunta } from '../dominio/publico.js';
import { corregir, elegirAlAzar } from '../dominio/simulacro.js';
import type { ItemSimulacro } from '../persistencia/repo.js';
import { ejecutar, error, resultado, type Contexto } from './contexto.js';
import { Explicacion, PreguntaPublica } from './esquemas.js';
import { textoExplicacion } from './formato.js';

export const MAX_PREGUNTAS_SIMULACRO = 100;

const fecha = (iso: string) => iso.slice(0, 16).replace('T', ' ');

export function registrarSimulacros(server: McpServer, ctx: Contexto): void {
  server.registerTool(
    'generar_simulacro',
    {
      title: 'Generar simulacro',
      description:
        'Arma un simulacro al azar con preguntas del banco, sin repetir y priorizando las que el alumno aún no vio. ' +
        'Devuelve un simulacro_id y las preguntas numeradas SIN respuesta. Muéstralas al alumno sin resolverlas ' +
        'y, cuando responda, llama a corregir_simulacro.',
      inputSchema: {
        curso: z.string().optional().describe('Id del curso; opcional si el servidor tiene uno solo'),
        cantidad: z.int().min(1).max(MAX_PREGUNTAS_SIMULACRO).default(10),
        especialidades: z.array(z.string()).optional().describe('P. ej. ["Cardiología", "Nefrología"]'),
        temas: z
          .array(z.string())
          .optional()
          .describe('Partes del nombre del tema; basta con que coincida uno'),
        anios: z.array(z.string()).optional().describe('P. ej. ["2020", "2021"]'),
        dificultad: z.string().optional().describe('"Fácil", "Intermedio" o "Difícil"'),
        solo_prioritarias: z.boolean().optional(),
        excluir_vistas: z
          .boolean()
          .default(true)
          .describe(
            'Primero preguntas que no salieron en simulacros anteriores; si no alcanzan, completa con vistas',
          ),
      },
      outputSchema: {
        simulacro_id: z.string(),
        curso: z.string(),
        total: z.int(),
        nuevas: z.int(),
        repetidas: z.int(),
        disponibles: z.int().describe('Preguntas que cumplen los filtros'),
        expira_en: z.string(),
        preguntas: z.array(PreguntaPublica.extend({ numero: z.int() })),
      },
    },
    (args) =>
      ejecutar(ctx, 'generar_simulacro', async (servir) => {
        const curso = await ctx.banco.resolverCurso(args.curso);
        const candidatas = filtrar(await ctx.banco.unicas(curso), {
          especialidades: args.especialidades,
          temas: args.temas,
          anios: args.anios,
          dificultad: args.dificultad,
          soloPrioritarias: args.solo_prioritarias,
        });
        if (candidatas.length === 0) {
          return error(
            `No hay preguntas en ${curso} con esos filtros. Revisa los nombres con estadisticas_banco.`,
          );
        }

        const vistas = args.excluir_vistas
          ? await ctx.repo.firmasVistas(ctx.usuario, curso)
          : new Set<string>();
        const noVistas = candidatas.filter((q) => !vistas.has(firmaPregunta(q)));
        const nuevas = elegirAlAzar(noVistas, args.cantidad, ctx.rng);
        const yaVistas = candidatas.filter((q) => vistas.has(firmaPregunta(q)));
        const elegidas = [...nuevas, ...elegirAlAzar(yaVistas, args.cantidad - nuevas.length, ctx.rng)];
        await servir(elegidas.length);

        const ahora = ctx.ahora();
        const id = ctx.nuevoId();
        const expiraEn = new Date(ahora.getTime() + ctx.vigenciaSimulacroMs).toISOString();
        const items: ItemSimulacro[] = elegidas.map((q, i) => ({
          orden: i + 1,
          preguntaId: q.id,
          firma: firmaPregunta(q),
          especialidad: q.especialidad,
          tema: q.tema,
          clave: q.respuestaCorrecta,
          nOpciones: q.opciones.length,
          respuesta: null,
          correcta: null,
        }));
        await ctx.repo.crearSimulacro({
          id,
          usuario: ctx.usuario,
          curso,
          creadoEn: ahora.toISOString(),
          expiraEn,
          corregidoEn: null,
          aciertos: null,
          items,
        });

        const preguntas = elegidas.map((q, i) => ({ numero: i + 1, ...aPreguntaPublica(q) }));
        const repetidas = elegidas.length - nuevas.length;
        const avisos = [
          elegidas.length < args.cantidad ? `Solo hay ${elegidas.length} preguntas con esos filtros.` : '',
          repetidas > 0 ? `${repetidas} ya habían salido en simulacros anteriores.` : '',
        ].filter(Boolean);
        const texto = [
          `Simulacro ${id} · ${curso} · ${elegidas.length} preguntas · se puede corregir hasta ${fecha(expiraEn)} (UTC)`,
          ...avisos,
          ...preguntas.map((q) => `\n${textoPregunta(q, q.numero)}`),
          '',
          'No resuelvas ni insinúes las respuestas. Cuando el alumno conteste, llama a corregir_simulacro con ' +
            `simulacro_id "${id}" y respuestas como {"1": "A", "2": "C", ...}.`,
        ].join('\n');

        return resultado(texto, {
          simulacro_id: id,
          curso,
          total: elegidas.length,
          nuevas: nuevas.length,
          repetidas,
          disponibles: candidatas.length,
          expira_en: expiraEn,
          preguntas,
        });
      }),
  );

  server.registerTool(
    'corregir_simulacro',
    {
      title: 'Corregir simulacro',
      description:
        'Corrige un simulacro generado con generar_simulacro. Devuelve la nota, la clave de cada pregunta y la ' +
        'explicación de las falladas. Las preguntas sin respuesta cuentan como incorrectas. Cada simulacro se ' +
        'corrige una sola vez.',
      inputSchema: {
        simulacro_id: z.string(),
        respuestas: z
          .record(z.string().regex(/^\d+$/), z.string())
          .describe('Número de pregunta → letra, p. ej. {"1": "A", "2": "C"}'),
      },
      outputSchema: {
        simulacro_id: z.string(),
        curso: z.string(),
        aciertos: z.int(),
        total: z.int(),
        porcentaje: z.int(),
        items: z.array(
          z.object({
            numero: z.int(),
            pregunta_id: z.string(),
            especialidad: z.string(),
            tema: z.string(),
            respuesta: z.string().nullable(),
            clave: z.string(),
            correcta: z.boolean(),
            avisos: z.array(z.string()),
          }),
        ),
        falladas: z.array(
          z.object({
            numero: z.int(),
            pregunta_id: z.string(),
            pregunta: z.string(),
            explicacion: Explicacion.optional(),
          }),
        ),
      },
    },
    ({ simulacro_id, respuestas }) =>
      ejecutar(ctx, 'corregir_simulacro', async () => {
        const s = await ctx.repo.obtenerSimulacro(simulacro_id, ctx.usuario);
        if (!s) return error(`No existe el simulacro «${simulacro_id}».`);
        if (s.corregidoEn) {
          return error(
            `El simulacro ${simulacro_id} ya fue corregido (${fecha(s.corregidoEn)} UTC). ` +
              'Para repasar una pregunta usa explicar_pregunta; para la nota, mi_progreso.',
          );
        }
        if (ctx.ahora().toISOString() > s.expiraEn) {
          return error(`El simulacro ${simulacro_id} venció (${fecha(s.expiraEn)} UTC). Genera uno nuevo.`);
        }
        if (Object.keys(respuestas).length === 0) return error('No se envió ninguna respuesta.');

        const corregidos = corregir(s.items, respuestas);
        await ctx.repo.guardarCorreccion(s.id, ctx.usuario, ctx.ahora().toISOString(), corregidos);

        const items = await Promise.all(
          s.items.map(async (it, i) => {
            const c = corregidos[i]!;
            const q = await ctx.banco.buscarPorId(s.curso, it.preguntaId).catch(() => undefined);
            return {
              numero: it.orden,
              pregunta_id: it.preguntaId,
              especialidad: it.especialidad,
              tema: it.tema,
              respuesta: c.respuesta === null ? null : letra(c.respuesta),
              clave: letra(it.clave),
              correcta: c.correcta,
              avisos: q ? avisosDe(q) : [],
              q,
            };
          }),
        );
        const aciertos = items.filter((it) => it.correcta).length;
        const porcentaje = Math.round((aciertos / items.length) * 100);
        const falladas = items
          .filter((it) => !it.correcta)
          .map((it) => ({
            numero: it.numero,
            pregunta_id: it.pregunta_id,
            pregunta: it.q?.pregunta ?? '(ya no está en el banco)',
            ...(it.q ? { explicacion: normalizarExplicacion(it.q) } : {}),
          }));

        const texto = [
          `Nota: ${aciertos}/${items.length} (${porcentaje} %)`,
          ...items.map(
            (it) =>
              `${it.numero}. ${it.correcta ? '✔' : '✘'} ` +
              (it.correcta
                ? it.clave
                : `${it.respuesta ? `respondió ${it.respuesta}` : 'sin responder'}, clave ${it.clave}`) +
              ` · ${it.tema}${it.avisos.length ? ` (${it.avisos.join(' · ')})` : ''}`,
          ),
          ...falladas.map((f) => {
            const respuesta = items.find((it) => it.numero === f.numero)?.respuesta;
            return `\n--- Pregunta ${f.numero} ---\n${f.pregunta}\n${
              f.explicacion ? textoExplicacion(f.explicacion, respuesta) : 'Sin explicación disponible.'
            }`;
          }),
        ].join('\n');

        return resultado(texto, {
          simulacro_id: s.id,
          curso: s.curso,
          aciertos,
          total: items.length,
          porcentaje,
          items: items.map(({ q, ...it }) => (void q, it)),
          falladas,
        });
      }),
  );

  server.registerTool(
    'explicar_pregunta',
    {
      title: 'Explicar pregunta',
      description:
        'Devuelve la clave y la explicación completa de una pregunta que el alumno YA corrigió en un simulacro. ' +
        'No sirve para preguntas que todavía no respondió.',
      inputSchema: { pregunta_id: z.string().describe('El pregunta_id que aparece en la corrección') },
      outputSchema: {
        pregunta: PreguntaPublica,
        tema: z.string(),
        explicacion: Explicacion,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ pregunta_id }) =>
      ejecutar(ctx, 'explicar_pregunta', async () => {
        const corregida = await ctx.repo.preguntaCorregida(ctx.usuario, pregunta_id);
        if (!corregida) {
          return error('Solo se pueden explicar preguntas que ya corregiste en un simulacro.');
        }
        const q = await ctx.banco.buscarPorId(corregida.curso, pregunta_id);
        if (!q) return error(`La pregunta ${pregunta_id} ya no está en el banco.`);
        const pregunta = aPreguntaPublica(q);
        const explicacion = normalizarExplicacion(q);
        return resultado(`${textoPregunta(pregunta)}\nTema: ${q.tema}\n${textoExplicacion(explicacion)}`, {
          pregunta,
          tema: q.tema,
          explicacion,
        });
      }),
  );
}
