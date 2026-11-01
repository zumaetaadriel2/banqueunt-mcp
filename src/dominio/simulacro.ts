import { LETRAS } from '../datos/esquema.js';

/** Elige `n` elementos distintos al azar (Fisher-Yates parcial); `rng` se inyecta en los tests. */
export function elegirAlAzar<T>(lista: T[], n: number, rng: () => number = Math.random): T[] {
  const copia = [...lista];
  const k = Math.min(n, copia.length);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rng() * (copia.length - i));
    [copia[i], copia[j]] = [copia[j]!, copia[i]!];
  }
  return copia.slice(0, k);
}

/** «a», «B», «b)», «C.» → índice; null si no es una letra válida para esa pregunta. */
export function parsearLetra(valor: string, nOpciones: number): number | null {
  const limpio = valor
    .trim()
    .toUpperCase()
    .replace(/[.)\s]+$/, '');
  const i = LETRAS.indexOf(limpio as (typeof LETRAS)[number]);
  return i >= 0 && i < nOpciones ? i : null;
}

export interface ItemParaCorregir {
  orden: number;
  clave: number;
  nOpciones: number;
}

export interface ItemCorregido {
  orden: number;
  respuesta: number | null;
  correcta: boolean;
}

export class RespuestasInvalidas extends Error {}

/**
 * Corrige un simulacro. `respuestas` va por número de pregunta (1, 2, …): las que faltan cuentan
 * como no respondidas (incorrectas). Rechaza números que no existen o letras fuera de rango.
 */
export function corregir(items: ItemParaCorregir[], respuestas: Record<string, string>): ItemCorregido[] {
  const porOrden = new Map(items.map((it) => [it.orden, it]));
  const errores: string[] = [];
  const elegidas = new Map<number, number>();

  for (const [numero, letra] of Object.entries(respuestas)) {
    const orden = Number(numero);
    const item = porOrden.get(orden);
    if (!item) {
      errores.push(`La pregunta ${numero} no existe en este simulacro.`);
      continue;
    }
    const indice = parsearLetra(letra, item.nOpciones);
    if (indice === null) {
      errores.push(
        `Pregunta ${numero}: «${letra}» no es una alternativa válida (A–${LETRAS[item.nOpciones - 1]}).`,
      );
      continue;
    }
    elegidas.set(orden, indice);
  }
  if (errores.length > 0) throw new RespuestasInvalidas(errores.join(' '));

  return items.map((it) => {
    const respuesta = elegidas.get(it.orden) ?? null;
    return { orden: it.orden, respuesta, correcta: respuesta === it.clave };
  });
}
