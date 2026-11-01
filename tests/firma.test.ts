import { describe, expect, it } from 'vitest';
import { deduplicar, firmaPregunta } from '../src/datos/firma.js';
import { pregunta } from './helpers.js';

describe('firmaPregunta', () => {
  it('ignora tildes, mayúsculas, signos, la letra y el orden de las opciones', () => {
    const a = pregunta({
      pregunta: '¿Cuál es el fármaco?',
      opciones: ['A. Ácido', 'B. Beta', 'C. Gamma', 'D. Delta'],
    });
    const b = pregunta({
      pregunta: 'cual es el farmaco',
      opciones: ['A. gamma', 'B. delta', 'C. acido', 'D. BETA'],
    });
    expect(firmaPregunta(a)).toBe(firmaPregunta(b));
  });

  it('distingue preguntas con opciones distintas', () => {
    const a = pregunta();
    const b = pregunta({ opciones: ['A. Uno', 'B. Dos', 'C. Tres', 'D. Cuatro', 'E. Seis'] });
    expect(firmaPregunta(a)).not.toBe(firmaPregunta(b));
  });
});

describe('deduplicar', () => {
  it('deja la primera aparición', () => {
    const lista = [pregunta({ id: 'X1' }), pregunta({ id: 'X2' }), pregunta({ id: 'X3', pregunta: 'Otra' })];
    expect(deduplicar(lista).map((q) => q.id)).toEqual(['X1', 'X3']);
  });
});
