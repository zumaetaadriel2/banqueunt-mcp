import type { Pregunta } from './esquema.js';

// Misma firma que questionSignature() de examen-pwa/app.js: enunciado y opciones normalizados
// (sin tildes ni signos, opciones sin su letra y ordenadas). Así una pregunta publicada en
// varios exámenes cuenta una sola vez.
const norm = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const sinLetra = (opcion: string) => opcion.replace(/^[A-E]\.\s*/, '');

export function firmaPregunta(q: Pick<Pregunta, 'pregunta' | 'opciones'>): string {
  return `${norm(q.pregunta)}|${q.opciones
    .map((o) => norm(sinLetra(o)))
    .sort()
    .join('|')}`;
}

/** Deja la primera aparición de cada pregunta repetida, en el orden original. */
export function deduplicar<T extends Pick<Pregunta, 'pregunta' | 'opciones'>>(preguntas: T[]): T[] {
  const vistas = new Set<string>();
  return preguntas.filter((q) => {
    const firma = firmaPregunta(q);
    if (vistas.has(firma)) return false;
    vistas.add(firma);
    return true;
  });
}
