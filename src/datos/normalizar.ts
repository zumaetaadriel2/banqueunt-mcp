import { LETRAS, type Pregunta } from './esquema.js';

/** Explicación de una pregunta en un único formato, sea cual sea el del banco. */
export interface Explicacion {
  formato: 'antiguo' | 'ampliado';
  clave: string;
  idea?: string;
  correcta: string;
  /** Por qué se descarta cada alternativa incorrecta (formato ampliado), con su letra original */
  alternativas: { letra: string; motivo: string }[];
  /** Párrafo de descarte tal cual (formato antiguo) */
  descarte?: string;
  recordar: string[];
  referencia?: string;
  otraPosible?: { letra: string; motivo: string };
  avisos: string[];
}

export const AVISO_CLAVE_NO_OFICIAL = 'Clave no oficial';
export const AVISO_GENERADO_IA = 'Explicación elaborada con IA';

export function letra(indice: number): string {
  return LETRAS[indice] ?? String(indice + 1);
}

export function avisosDe(q: Pregunta): string[] {
  const avisos: string[] = [];
  if (q.claveOficial === false) avisos.push(AVISO_CLAVE_NO_OFICIAL);
  if (q.fundamentoGenerado === true) avisos.push(AVISO_GENERADO_IA);
  return avisos;
}

export function normalizarExplicacion(q: Pregunta): Explicacion {
  const fd = q.fundamentoDetallado;
  const base = { clave: letra(q.respuestaCorrecta), correcta: fd.correcta, avisos: avisosDe(q) };

  if (!('alternativas' in fd)) {
    return { ...base, formato: 'antiguo', alternativas: [], descarte: fd.descarte, recordar: [] };
  }

  const alternativas = fd.alternativas
    .map((motivo, i) => ({ letra: letra(i), motivo: motivo.trim(), i }))
    .filter((a) => a.i !== q.respuestaCorrecta && a.motivo !== '')
    .map(({ letra, motivo }) => ({ letra, motivo }));

  const recordar = (Array.isArray(fd.recordar) ? fd.recordar : [fd.recordar])
    .map((r) => r.trim())
    .filter(Boolean);

  return {
    ...base,
    formato: 'ampliado',
    idea: fd.idea,
    alternativas,
    recordar,
    referencia: fd.referencia || undefined,
    otraPosible: fd.otraPosible
      ? { letra: letra(fd.otraPosible.opcion), motivo: fd.otraPosible.motivo }
      : undefined,
  };
}
