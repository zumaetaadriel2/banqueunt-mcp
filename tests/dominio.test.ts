import { describe, expect, it } from 'vitest';
import { filtrar, normalizarTexto, paginar } from '../src/dominio/busqueda.js';
import { calcularProgreso } from '../src/dominio/progreso.js';
import { aPreguntaPublica } from '../src/dominio/publico.js';
import { corregir, elegirAlAzar, parsearLetra, RespuestasInvalidas } from '../src/dominio/simulacro.js';
import type { ItemRespondido } from '../src/persistencia/repo.js';
import { pregunta } from './helpers.js';

describe('aPreguntaPublica', () => {
  it('solo deja campos sin información de la respuesta', () => {
    const publica = aPreguntaPublica(pregunta({ examen: 'Final', prioritaria: true, claveOficial: false }));
    expect(Object.keys(publica).sort()).toEqual(
      ['anio', 'curso', 'dificultad', 'especialidad', 'examen', 'id', 'opciones', 'pregunta'].sort(),
    );
  });
});

describe('filtrar', () => {
  const lista = [
    pregunta({ id: 'a', especialidad: 'Cardiología', tema: 'Insuficiencia cardíaca', anio: '2021' }),
    pregunta({
      id: 'b',
      especialidad: 'Nefrología',
      tema: 'Síndrome nefrótico',
      anio: '2020',
      prioritaria: true,
    }),
    pregunta({
      id: 'c',
      especialidad: 'Nefrología',
      tema: 'Glomerulonefritis',
      pregunta: 'Niño con edema facial',
    }),
  ];
  const ids = (f: Parameters<typeof filtrar>[1]) => filtrar(lista, f).map((q) => q.id);

  it('por especialidad, tema, año y prioritarias', () => {
    expect(ids({ especialidades: ['NEFROLOGIA'] })).toEqual(['b', 'c']);
    expect(ids({ temas: ['nefrotico', 'cardiaca'] })).toEqual(['a', 'b']);
    expect(ids({ anios: ['2020'] })).toEqual(['b']);
    expect(ids({ soloPrioritarias: true })).toEqual(['b']);
  });

  it('texto libre: todas las palabras, sin tildes', () => {
    expect(ids({ texto: 'niño EDEMA' })).toEqual(['c']);
    expect(ids({ texto: 'edema torax' })).toEqual([]);
  });

  it('normalizarTexto', () => {
    expect(normalizarTexto('  Ántrax   POR inhalación ')).toBe('antrax por inhalacion');
  });
});

describe('paginar', () => {
  it('avanza con el cursor y termina', () => {
    const p1 = paginar([1, 2, 3, 4, 5], 2);
    const p2 = paginar([1, 2, 3, 4, 5], 2, p1.siguiente);
    const p3 = paginar([1, 2, 3, 4, 5], 2, p2.siguiente);
    expect([p1.pagina, p2.pagina, p3.pagina]).toEqual([[1, 2], [3, 4], [5]]);
    expect(p3.siguiente).toBeUndefined();
  });

  it('rechaza un cursor inválido', () => {
    expect(() => paginar([1], 1, '!!')).toThrow();
  });
});

describe('elegirAlAzar', () => {
  it('no repite y respeta el máximo', () => {
    const r = elegirAlAzar([1, 2, 3, 4, 5], 3);
    expect(new Set(r).size).toBe(3);
    expect(elegirAlAzar([1, 2], 5)).toHaveLength(2);
  });

  it('es determinista con un rng fijo', () => {
    expect(elegirAlAzar([1, 2, 3], 3, () => 0)).toEqual([1, 2, 3]);
  });
});

describe('corregir', () => {
  const items = [
    { orden: 1, clave: 0, nOpciones: 5 },
    { orden: 2, clave: 3, nOpciones: 4 },
  ];

  it('acepta letras en cualquier forma y cuenta las faltantes como incorrectas', () => {
    expect(parsearLetra(' b) ', 5)).toBe(1);
    expect(corregir(items, { 1: 'a.' })).toEqual([
      { orden: 1, respuesta: 0, correcta: true },
      { orden: 2, respuesta: null, correcta: false },
    ]);
  });

  it('rechaza una E en una pregunta de cuatro alternativas', () => {
    expect(() => corregir(items, { 2: 'E' })).toThrow(RespuestasInvalidas);
  });
});

describe('calcularProgreso', () => {
  const item = (tema: string, correcta: boolean, especialidad = 'Cardiología'): ItemRespondido => ({
    simulacroId: 's1',
    curso: 'med2_unt',
    preguntaId: `${tema}-${Math.random()}`,
    especialidad,
    tema,
    correcta,
  });

  it('temas débiles: menor porcentaje primero y con al menos 2 respuestas', () => {
    const p = calcularProgreso(
      [{ id: 's1', curso: 'med2_unt', creadoEn: 'x', corregidoEn: 'x', aciertos: 3, total: 7 }],
      [
        item('IC', false),
        item('IC', false),
        item('HTA', true),
        item('HTA', false),
        item('Arritmias', true),
        item('Arritmias', true),
        item('Una sola', false, 'Nefrología'),
      ],
    );
    expect(p.temasDebiles.map((t) => t.nombre)).toEqual(['IC', 'HTA']);
    expect(p.porcentaje).toBe(43);
    expect(p.porEspecialidad[0]?.nombre).toBe('Nefrología');
  });
});
