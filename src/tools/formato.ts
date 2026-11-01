import type { Explicacion } from '../datos/normalizar.js';

/** Explicación legible; si se pasa la letra que marcó el alumno, destaca por qué esa no era. */
export function textoExplicacion(e: Explicacion, respuesta?: string | null): string {
  const lineas: string[] = [`Clave: ${e.clave}`];
  if (e.avisos.length) lineas.push(`(${e.avisos.join(' · ')})`);
  if (e.idea) lineas.push(`Idea: ${e.idea}`);
  lineas.push(`Por qué ${e.clave}: ${e.correcta}`);
  const motivoElegida = respuesta ? e.alternativas.find((a) => a.letra === respuesta)?.motivo : undefined;
  if (motivoElegida) lineas.push(`Por qué no ${respuesta}: ${motivoElegida}`);
  const otras = e.alternativas.filter((a) => a.letra !== respuesta);
  if (otras.length) lineas.push('Las demás:', ...otras.map((a) => `  ${a.letra}: ${a.motivo}`));
  if (e.descarte) lineas.push(`Descarte: ${e.descarte}`);
  if (e.otraPosible) lineas.push(`También defendible, ${e.otraPosible.letra}: ${e.otraPosible.motivo}`);
  if (e.recordar.length) lineas.push('Para recordar:', ...e.recordar.map((r) => `  - ${r}`));
  if (e.referencia) lineas.push(`Referencia: ${e.referencia}`);
  return lineas.join('\n');
}
