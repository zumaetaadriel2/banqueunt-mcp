/**
 * Tope diario de preguntas servidas por usuario, para que nadie pueda copiarse el banco a punta de
 * llamadas. El día va de medianoche a medianoche en hora de Perú (UTC−5, sin horario de verano).
 */

const DESFASE_PERU_MS = -5 * 60 * 60 * 1000;

/** Medianoche de hoy en Perú, como instante UTC */
export function inicioDelDia(ahora: Date): Date {
  const peru = new Date(ahora.getTime() + DESFASE_PERU_MS);
  peru.setUTCHours(0, 0, 0, 0);
  return new Date(peru.getTime() - DESFASE_PERU_MS);
}

/** Lee BANQUEUNT_TOPE_DIARIO: un entero positivo, o null (sin tope) si falta, está vacío o es 0 */
export function leerTopeDiario(valor: string | undefined): number | null {
  const v = valor?.trim();
  if (!v || v === '0') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`BANQUEUNT_TOPE_DIARIO debe ser un entero positivo (o 0 para no tener tope), no «${v}».`);
  }
  return n;
}

export function mensajeTope(tope: number, servidas: number, pedidas: number): string {
  const quedan = Math.max(tope - servidas, 0);
  return (
    `Tope diario alcanzado: se pueden recibir ${tope} preguntas al día y hoy ya van ${servidas}. ` +
    (quedan > 0
      ? `Esta llamada pedía ${pedidas}; quedan ${quedan} para hoy, así que pide menos.`
      : 'Se reinicia a medianoche, hora de Perú. Mientras tanto puedes corregir, repasar con ' +
        'explicar_pregunta o ver mi_progreso.')
  );
}
