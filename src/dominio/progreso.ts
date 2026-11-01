import type { ItemRespondido, ResumenSimulacro } from '../persistencia/repo.js';

export interface Rendimiento {
  nombre: string;
  respondidas: number;
  aciertos: number;
  porcentaje: number;
}

export interface Progreso {
  simulacros: number;
  respondidas: number;
  aciertos: number;
  porcentaje: number;
  porEspecialidad: Rendimiento[];
  /** Los temas con menor porcentaje, solo entre los que tienen al menos MIN_PARA_DEBIL respuestas */
  temasDebiles: (Rendimiento & { especialidad: string })[];
  ultimos: (ResumenSimulacro & { porcentaje: number })[];
}

export const MIN_PARA_DEBIL = 2;
const porcentaje = (aciertos: number, total: number) => (total ? Math.round((aciertos / total) * 100) : 0);

function agrupar(items: ItemRespondido[], clave: (it: ItemRespondido) => string) {
  const grupos = new Map<string, { respondidas: number; aciertos: number; muestra: ItemRespondido }>();
  for (const it of items) {
    const g = grupos.get(clave(it)) ?? { respondidas: 0, aciertos: 0, muestra: it };
    g.respondidas++;
    if (it.correcta) g.aciertos++;
    grupos.set(clave(it), g);
  }
  return grupos;
}

export function calcularProgreso(
  simulacros: ResumenSimulacro[],
  items: ItemRespondido[],
  { maxDebiles = 5, maxUltimos = 5 } = {},
): Progreso {
  const aciertos = items.filter((it) => it.correcta).length;

  const porEspecialidad = [...agrupar(items, (it) => it.especialidad)]
    .map(([nombre, g]) => ({ nombre, ...cifras(g) }))
    .sort((a, b) => a.porcentaje - b.porcentaje || b.respondidas - a.respondidas);

  const temasDebiles = [...agrupar(items, (it) => `${it.especialidad}\u0000${it.tema}`).values()]
    .filter((g) => g.respondidas >= MIN_PARA_DEBIL && g.aciertos < g.respondidas)
    .map((g) => ({ nombre: g.muestra.tema, especialidad: g.muestra.especialidad, ...cifras(g) }))
    .sort((a, b) => a.porcentaje - b.porcentaje || b.respondidas - a.respondidas)
    .slice(0, maxDebiles);

  return {
    simulacros: simulacros.length,
    respondidas: items.length,
    aciertos,
    porcentaje: porcentaje(aciertos, items.length),
    porEspecialidad,
    temasDebiles,
    ultimos: simulacros
      .slice(0, maxUltimos)
      .map((s) => ({ ...s, porcentaje: porcentaje(s.aciertos, s.total) })),
  };
}

function cifras(g: { respondidas: number; aciertos: number }) {
  return {
    respondidas: g.respondidas,
    aciertos: g.aciertos,
    porcentaje: porcentaje(g.aciertos, g.respondidas),
  };
}
