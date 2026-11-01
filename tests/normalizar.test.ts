import { describe, expect, it } from 'vitest';
import { Pregunta } from '../src/datos/esquema.js';
import { AVISO_CLAVE_NO_OFICIAL, AVISO_GENERADO_IA, normalizarExplicacion } from '../src/datos/normalizar.js';
import { pregunta } from './helpers.js';

const ampliado = {
  idea: 'La idea.',
  correcta: 'C es la clave.',
  alternativas: ['A no.', 'B no.', '', 'D no.', ''],
  recordar: ['Dato 1', 'Dato 2'],
  referencia: 'Harrison',
};

describe('normalizarExplicacion', () => {
  it('formato antiguo: conserva el párrafo de descarte', () => {
    const e = normalizarExplicacion(pregunta());
    expect(e).toMatchObject({
      formato: 'antiguo',
      clave: 'C',
      correcta: 'Porque sí.',
      descarte: 'A: no. B: tampoco.',
    });
    expect(e.alternativas).toEqual([]);
    expect(e.recordar).toEqual([]);
  });

  it('formato ampliado: alternativas con su letra original, sin la clave ni las vacías', () => {
    const e = normalizarExplicacion(pregunta({ fundamentoDetallado: ampliado }));
    expect(e.formato).toBe('ampliado');
    expect(e.idea).toBe('La idea.');
    expect(e.alternativas).toEqual([
      { letra: 'A', motivo: 'A no.' },
      { letra: 'B', motivo: 'B no.' },
      { letra: 'D', motivo: 'D no.' },
    ]);
    expect(e.recordar).toEqual(['Dato 1', 'Dato 2']);
    expect(e.referencia).toBe('Harrison');
  });

  it('recordar como texto se convierte en lista', () => {
    const e = normalizarExplicacion(
      pregunta({ fundamentoDetallado: { ...ampliado, recordar: 'Un solo dato' } }),
    );
    expect(e.recordar).toEqual(['Un solo dato']);
  });

  it('otraPosible usa el índice original de la opción', () => {
    const e = normalizarExplicacion(
      pregunta({ fundamentoDetallado: { ...ampliado, otraPosible: { opcion: 3, motivo: 'Según la OMS.' } } }),
    );
    expect(e.otraPosible).toEqual({ letra: 'D', motivo: 'Según la OMS.' });
  });

  it('avisos de clave no oficial y explicación con IA', () => {
    expect(normalizarExplicacion(pregunta()).avisos).toEqual([]);
    expect(normalizarExplicacion(pregunta({ claveOficial: true })).avisos).toEqual([]);
    expect(normalizarExplicacion(pregunta({ claveOficial: false, fundamentoGenerado: true })).avisos).toEqual(
      [AVISO_CLAVE_NO_OFICIAL, AVISO_GENERADO_IA],
    );
  });
});

describe('esquema Pregunta', () => {
  it('acepta los dos formatos de fundamento', () => {
    expect(Pregunta.safeParse(pregunta()).success).toBe(true);
    expect(Pregunta.safeParse(pregunta({ fundamentoDetallado: ampliado })).success).toBe(true);
  });

  it('rechaza una clave fuera de rango', () => {
    expect(Pregunta.safeParse(pregunta({ respuestaCorrecta: 5 })).success).toBe(false);
  });

  it('rechaza alternativas que no calzan con las opciones', () => {
    const r = Pregunta.safeParse(
      pregunta({ fundamentoDetallado: { ...ampliado, alternativas: ['A no.', ''] } }),
    );
    expect(r.success).toBe(false);
  });

  it('rechaza un fundamento con campos desconocidos', () => {
    const r = Pregunta.safeParse(
      pregunta({ fundamentoDetallado: { correcta: 'x', descarte: 'y', extra: 1 } as never }),
    );
    expect(r.success).toBe(false);
  });
});
