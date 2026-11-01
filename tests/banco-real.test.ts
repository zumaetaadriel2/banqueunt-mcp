// Valida el banco real de examen-pwa. Solo corre en local: BANQUEUNT_DATA=C:\...\examen-pwa\data npm test
import { describe, expect, it } from 'vitest';
import { CarpetaLocal } from '../src/datos/fuentes.js';
import { estadisticasCurso } from '../src/dominio/estadisticas.js';

const carpeta = process.env.BANQUEUNT_DATA;

describe.skipIf(!carpeta)('banco real (BANQUEUNT_DATA)', () => {
  it('todas las preguntas de med2_unt cumplen el esquema y calzan con index.json', async () => {
    const avisos: string[] = [];
    const fuente = new CarpetaLocal(carpeta!, ['med2_unt'], (m) => avisos.push(m));
    const preguntas = await fuente.preguntas('med2_unt');
    expect(preguntas.length).toBeGreaterThan(1000);
    expect(new Set(preguntas.map((q) => q.id)).size).toBe(preguntas.length);
    expect(avisos).toEqual([]);

    const stats = estadisticasCurso('med2_unt', preguntas);
    expect(stats.unicas).toBeLessThanOrEqual(stats.publicadas);
  });
});
