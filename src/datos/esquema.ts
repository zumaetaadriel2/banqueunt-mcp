import { z } from 'zod';

export const LETRAS = ['A', 'B', 'C', 'D', 'E'] as const;

// Formato antiguo (bancos de exámenes viejos): texto de la clave y un párrafo de descarte
export const FundamentoAntiguo = z.strictObject({
  correcta: z.string(),
  descarte: z.string(),
});

// Formato ampliado (fijas y bancos nuevos). `alternativas` va en el orden original de `opciones`
// con "" en la clave; `otraPosible.opcion` también es un índice original.
export const FundamentoAmpliado = z.strictObject({
  idea: z.string(),
  correcta: z.string(),
  alternativas: z.array(z.string()),
  recordar: z.union([z.string(), z.array(z.string())]),
  referencia: z.string(),
  otraPosible: z.strictObject({ opcion: z.int().nonnegative(), motivo: z.string() }).optional(),
});

export const Fundamento = z.union([FundamentoAmpliado, FundamentoAntiguo]);

export const Pregunta = z
  .object({
    id: z.string().min(1),
    categoriaId: z.string().min(1),
    anio: z.string(),
    especialidad: z.string(),
    tema: z.string(),
    dificultad: z.string(),
    pregunta: z.string().min(1),
    opciones: z.array(z.string()).min(4).max(5),
    respuestaCorrecta: z.int().nonnegative(),
    fundamentoDetallado: Fundamento,
    examen: z.string().optional(),
    fuente: z.string().optional(),
    numero: z.int().optional(),
    // Sin el campo, la clave se toma como oficial (igual que en la app)
    claveOficial: z.boolean().optional(),
    fundamentoGenerado: z.boolean().optional(),
    prioritaria: z.boolean().optional(),
    imagen: z.string().optional(),
  })
  .superRefine((q, ctx) => {
    if (q.respuestaCorrecta >= q.opciones.length) {
      ctx.addIssue({ code: 'custom', path: ['respuestaCorrecta'], message: 'Clave fuera de rango' });
    }
    const fd = q.fundamentoDetallado;
    if ('alternativas' in fd) {
      if (fd.alternativas.length !== q.opciones.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['fundamentoDetallado', 'alternativas'],
          message: 'Debe tener una entrada por opción',
        });
      }
      if (fd.otraPosible && fd.otraPosible.opcion >= q.opciones.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['fundamentoDetallado', 'otraPosible', 'opcion'],
          message: 'Opción fuera de rango',
        });
      }
    }
  });

export const Banco = z.array(Pregunta);

export const IndiceBancos = z.object({
  version: z.unknown().optional(),
  categorias: z.record(
    z.string(),
    z.object({
      preguntas: z.int().nonnegative(),
      examenes: z.int().nonnegative().optional(),
      archivos: z.array(z.string()),
      versiones: z.record(z.string(), z.string()).default({}),
    }),
  ),
});

export type Pregunta = z.infer<typeof Pregunta>;
export type Fundamento = z.infer<typeof Fundamento>;
export type IndiceBancos = z.infer<typeof IndiceBancos>;
