import { z } from 'zod';

// Esquemas de salida (structuredContent). Ninguno de los que se usan antes de corregir tiene
// campos para la clave, el fundamento o el tema.

export const PreguntaPublica = z.object({
  id: z.string(),
  curso: z.string(),
  anio: z.string(),
  examen: z.string().optional(),
  especialidad: z.string(),
  dificultad: z.string(),
  pregunta: z.string(),
  opciones: z.array(z.string()),
});

export const Explicacion = z.object({
  formato: z.enum(['antiguo', 'ampliado']),
  clave: z.string(),
  idea: z.string().optional(),
  correcta: z.string(),
  alternativas: z.array(z.object({ letra: z.string(), motivo: z.string() })),
  descarte: z.string().optional(),
  recordar: z.array(z.string()),
  referencia: z.string().optional(),
  otraPosible: z.object({ letra: z.string(), motivo: z.string() }).optional(),
  avisos: z.array(z.string()),
});

export const Rendimiento = z.object({
  nombre: z.string(),
  respondidas: z.int(),
  aciertos: z.int(),
  porcentaje: z.int(),
});
