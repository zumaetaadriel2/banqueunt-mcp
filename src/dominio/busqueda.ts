import type { Pregunta } from '../datos/esquema.js';

export interface Filtros {
  especialidades?: string[];
  /** Basta con que el tema contenga alguno de estos textos */
  temas?: string[];
  anios?: string[];
  dificultad?: string;
  soloPrioritarias?: boolean;
  texto?: string;
}

/** Minúsculas, sin tildes y con espacios simples, para comparar lo que escribe el alumno. */
export function normalizarTexto(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function filtrar(preguntas: Pregunta[], f: Filtros): Pregunta[] {
  const especialidades = f.especialidades?.length ? new Set(f.especialidades.map(normalizarTexto)) : null;
  const anios = f.anios?.length ? new Set(f.anios.map(normalizarTexto)) : null;
  const temas = f.temas?.length ? f.temas.map(normalizarTexto) : null;
  const dificultad = f.dificultad ? normalizarTexto(f.dificultad) : null;
  const palabras = f.texto ? normalizarTexto(f.texto).split(' ').filter(Boolean) : [];

  return preguntas.filter((q) => {
    if (especialidades && !especialidades.has(normalizarTexto(q.especialidad))) return false;
    if (anios && !anios.has(normalizarTexto(q.anio))) return false;
    if (temas && !temas.some((t) => normalizarTexto(q.tema).includes(t))) return false;
    if (dificultad && normalizarTexto(q.dificultad) !== dificultad) return false;
    if (f.soloPrioritarias && q.prioritaria !== true) return false;
    if (palabras.length > 0) {
      const texto = normalizarTexto([q.pregunta, ...q.opciones, q.tema].join(' '));
      if (!palabras.every((p) => texto.includes(p))) return false;
    }
    return true;
  });
}

// Paginación con un cursor opaco (el desplazamiento en base36), suficiente para un banco estático
export function paginar<T>(lista: T[], limite: number, cursor?: string) {
  const desde = cursor ? parseInt(cursor, 36) : 0;
  if (!Number.isInteger(desde) || desde < 0) throw new Error('Cursor inválido.');
  const pagina = lista.slice(desde, desde + limite);
  const fin = desde + pagina.length;
  return { pagina, siguiente: fin < lista.length ? fin.toString(36) : undefined };
}
