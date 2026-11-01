import type { Pregunta } from '../datos/esquema.js';
import { deduplicar } from '../datos/firma.js';

export interface Conteo {
  nombre: string;
  preguntas: number;
}

export interface EstadisticasCurso {
  curso: string;
  /** Preguntas publicadas, contando las repetidas en varios exámenes */
  publicadas: number;
  /** Preguntas distintas (lo que se puede practicar); todos los demás conteos usan este total */
  unicas: number;
  claveNoOficial: number;
  prioritarias: number;
  explicacionConIA: number;
  porEspecialidad: Conteo[];
  porAnio: Conteo[];
  /** Solo cuando se pide el detalle de una especialidad */
  porTema?: Conteo[];
}

function contar(preguntas: Pregunta[], clave: (q: Pregunta) => string): Conteo[] {
  const mapa = new Map<string, number>();
  for (const q of preguntas) mapa.set(clave(q), (mapa.get(clave(q)) ?? 0) + 1);
  return [...mapa]
    .map(([nombre, preguntas]) => ({ nombre, preguntas }))
    .sort((a, b) => b.preguntas - a.preguntas || a.nombre.localeCompare(b.nombre, 'es'));
}

export function estadisticasCurso(
  curso: string,
  preguntas: Pregunta[],
  especialidad?: string,
): EstadisticasCurso {
  const unicas = deduplicar(preguntas);
  const stats: EstadisticasCurso = {
    curso,
    publicadas: preguntas.length,
    unicas: unicas.length,
    claveNoOficial: unicas.filter((q) => q.claveOficial === false).length,
    prioritarias: unicas.filter((q) => q.prioritaria === true).length,
    explicacionConIA: unicas.filter((q) => q.fundamentoGenerado === true).length,
    porEspecialidad: contar(unicas, (q) => q.especialidad),
    porAnio: contar(unicas, (q) => q.anio),
  };
  if (especialidad) {
    const objetivo = especialidad.toLocaleLowerCase('es');
    stats.porTema = contar(
      unicas.filter((q) => q.especialidad.toLocaleLowerCase('es') === objetivo),
      (q) => q.tema,
    );
  }
  return stats;
}
