import type { Pregunta } from '../datos/esquema.js';

/**
 * Lo único que sale del servidor antes de corregir. Sin clave, sin fundamento y sin `tema`
 * (el tema suele nombrar el diagnóstico o el fármaco correcto, p. ej. «Ántrax por inhalación»).
 */
export interface PreguntaPublica {
  id: string;
  curso: string;
  anio: string;
  examen?: string;
  especialidad: string;
  dificultad: string;
  pregunta: string;
  opciones: string[];
}

export function aPreguntaPublica(q: Pregunta): PreguntaPublica {
  return {
    id: q.id,
    curso: q.categoriaId,
    anio: q.anio,
    ...(q.examen ? { examen: q.examen } : {}),
    especialidad: q.especialidad,
    dificultad: q.dificultad,
    pregunta: q.pregunta,
    opciones: [...q.opciones],
  };
}

export function textoPregunta(q: PreguntaPublica, numero?: number): string {
  const encabezado = `${numero ? `${numero}. ` : ''}[${q.especialidad} · ${q.anio}${q.examen ? ` · ${q.examen}` : ''}]`;
  return [`${encabezado} ${q.pregunta}`, ...q.opciones.map((o) => `   ${o}`)].join('\n');
}
