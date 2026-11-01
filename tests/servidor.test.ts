import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import type { Pregunta } from '../src/datos/esquema.js';
import { MuestraLocal, type FuenteBanco } from '../src/datos/fuentes.js';
import { SqliteProgresoRepo } from '../src/persistencia/sqlite.js';
import { crearServidor, type OpcionesServidor } from '../src/server.js';
import { pregunta } from './helpers.js';

type Llamada = { isError?: boolean; structuredContent?: unknown; content?: unknown };

async function conectar(
  fuente: FuenteBanco = new MuestraLocal(['med2_unt']),
  opciones: OpcionesServidor = {},
) {
  const repo = new SqliteProgresoRepo(':memory:');
  const server = crearServidor(fuente, repo, opciones);
  const [lado1, lado2] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(lado1), client.connect(lado2)]);
  const llamar = (name: string, args: Record<string, unknown> = {}) =>
    client.callTool({ name, arguments: args }) as Promise<Llamada>;
  return { client, llamar, repo };
}

/** Fuente en memoria para controlar exactamente qué hay en el banco */
function fuenteDe(preguntas: Pregunta[]): FuenteBanco {
  return {
    origen: 'prueba',
    cursos: async () => ['med2_unt'],
    preguntas: async () => preguntas,
  };
}

const banco = [
  pregunta({
    id: 'Q1',
    pregunta: 'Uno',
    respuestaCorrecta: 0,
    tema: 'Tema secreto A',
    especialidad: 'Cardiología',
  }),
  pregunta({
    id: 'Q2',
    pregunta: 'Dos',
    respuestaCorrecta: 1,
    tema: 'Tema secreto B',
    especialidad: 'Cardiología',
  }),
  pregunta({
    id: 'Q3',
    pregunta: 'Tres',
    respuestaCorrecta: 3,
    tema: 'Tema secreto C',
    especialidad: 'Nefrología',
    claveOficial: false,
    fundamentoGenerado: true,
    fundamentoDetallado: {
      idea: 'Idea secreta',
      correcta: 'Fundamento secreto',
      alternativas: ['Motivo A', 'Motivo B', 'Motivo C', '', 'Motivo E'],
      recordar: 'Recordar secreto',
      referencia: 'Harrison',
      otraPosible: { opcion: 4, motivo: 'Motivo otra' },
    },
  }),
  // Misma pregunta que Q1 publicada en otro examen: nunca deben salir las dos juntas
  pregunta({
    id: 'Q1_BIS',
    pregunta: 'Uno',
    respuestaCorrecta: 0,
    tema: 'Tema secreto A',
    especialidad: 'Cardiología',
  }),
];

/** Nada que permita deducir la clave: campos, letras de clave, fundamentos ni temas */
function expectSinRespuestas(r: Llamada) {
  const serializado = JSON.stringify(r);
  for (const prohibido of [
    'respuestaCorrecta',
    'fundamento',
    'clave',
    'Fundamento secreto',
    'Idea secreta',
    'Recordar secreto',
    'Motivo otra',
    'Tema secreto',
    'Porque sí.',
  ]) {
    expect(serializado).not.toContain(prohibido);
  }
}

describe('lista de herramientas', () => {
  it('expone las cinco herramientas con su esquema de salida', async () => {
    const { client } = await conectar();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'buscar_preguntas',
      'corregir_simulacro',
      'estadisticas_banco',
      'explicar_pregunta',
      'generar_simulacro',
      'mi_progreso',
    ]);
    for (const t of tools) expect(t.outputSchema).toBeDefined();
  });
});

describe('estadisticas_banco', () => {
  it('cuenta por especialidad y por tema sin devolver preguntas', async () => {
    const { llamar } = await conectar();
    const r = await llamar('estadisticas_banco', { especialidad: 'cardiología' });
    expect(r.isError).toBeFalsy();
    const salida = r.structuredContent as {
      origen: string;
      cursos: {
        curso: string;
        unicas: number;
        porEspecialidad: { preguntas: number }[];
        porTema?: unknown[];
      }[];
    };
    expect(salida.origen).toBe('muestra');
    const [med2] = salida.cursos;
    expect(med2?.porEspecialidad.reduce((s, e) => s + e.preguntas, 0)).toBe(med2?.unicas);
    expect(med2?.porTema?.length).toBeGreaterThan(0);
    for (const p of ['respuestaCorrecta', 'fundamento', 'opciones'])
      expect(JSON.stringify(r)).not.toContain(p);
  });

  it('error claro con un curso que no está disponible', async () => {
    const { llamar } = await conectar();
    const r = await llamar('estadisticas_banco', { curso: 'residentado' });
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.content)).toContain('med2_unt');
  });
});

describe('buscar_preguntas', () => {
  it('filtra sin tildes, deduplica y nunca devuelve la respuesta', async () => {
    const { llamar } = await conectar(fuenteDe(banco));
    const r = await llamar('buscar_preguntas', { especialidad: 'cardiologia' });
    const salida = r.structuredContent as { total: number; preguntas: { id: string }[] };
    expect(salida.total).toBe(2);
    expect(salida.preguntas.map((q) => q.id)).toEqual(['Q1', 'Q2']);
    expectSinRespuestas(r);
  });

  it('pagina con cursor', async () => {
    const { llamar } = await conectar(fuenteDe(banco));
    const p1 = (await llamar('buscar_preguntas', { limite: 2 })).structuredContent as {
      preguntas: { id: string }[];
      siguiente?: string;
    };
    expect(p1.preguntas).toHaveLength(2);
    const p2 = (await llamar('buscar_preguntas', { limite: 2, cursor: p1.siguiente })).structuredContent as {
      preguntas: { id: string }[];
      siguiente?: string;
    };
    expect(p2.preguntas.map((q) => q.id)).toEqual(['Q3']);
    expect(p2.siguiente).toBeUndefined();
  });

  it('no acepta más de 20 por página', async () => {
    const { llamar } = await conectar(fuenteDe(banco));
    expect((await llamar('buscar_preguntas', { limite: 50 })).isError).toBe(true);
  });
});

describe('simulacro de punta a punta', () => {
  it('genera sin respuestas, corrige con explicación y registra el progreso', async () => {
    let id = 0;
    const { llamar } = await conectar(fuenteDe(banco), { nuevoId: () => `sim${++id}` });

    const g = await llamar('generar_simulacro', { cantidad: 10 });
    expect(g.isError).toBeFalsy();
    expectSinRespuestas(g);
    const sim = g.structuredContent as {
      simulacro_id: string;
      total: number;
      preguntas: { numero: number; id: string }[];
    };
    expect(sim.total).toBe(3); // Q1 y Q1_BIS cuentan como una sola
    const ids = sim.preguntas.map((q) => q.id);
    expect(ids.filter((x) => x.startsWith('Q1'))).toHaveLength(1);

    // Respuestas: acierta Q2, falla Q3 marcando A, deja la otra sin responder
    const numero = (prefijo: string) => sim.preguntas.find((q) => q.id.startsWith(prefijo))!.numero;
    const c = await llamar('corregir_simulacro', {
      simulacro_id: sim.simulacro_id,
      respuestas: { [numero('Q2')]: 'b', [numero('Q3')]: 'A.' },
    });
    expect(c.isError).toBeFalsy();
    const corr = c.structuredContent as {
      aciertos: number;
      total: number;
      items: {
        pregunta_id: string;
        respuesta: string | null;
        clave: string;
        correcta: boolean;
        avisos: string[];
      }[];
      falladas: {
        pregunta_id: string;
        explicacion?: { otraPosible?: { letra: string }; recordar: string[] };
      }[];
    };
    expect(corr.aciertos).toBe(1);
    expect(corr.total).toBe(3);
    const q3 = corr.items.find((it) => it.pregunta_id === 'Q3')!;
    expect(q3).toMatchObject({ respuesta: 'A', clave: 'D', correcta: false });
    expect(q3.avisos).toEqual(['Clave no oficial', 'Explicación elaborada con IA']);
    expect(corr.items.find((it) => it.pregunta_id.startsWith('Q1'))?.respuesta).toBeNull();
    const f3 = corr.falladas.find((f) => f.pregunta_id === 'Q3')!;
    expect(f3.explicacion?.otraPosible?.letra).toBe('E');
    expect(f3.explicacion?.recordar).toEqual(['Recordar secreto']);
    const texto = JSON.stringify(c.content);
    expect(texto).toContain('Por qué no A: Motivo A');

    // No se corrige dos veces
    const otraVez = await llamar('corregir_simulacro', {
      simulacro_id: sim.simulacro_id,
      respuestas: { 1: 'A' },
    });
    expect(otraVez.isError).toBe(true);

    // explicar_pregunta solo para preguntas ya corregidas
    expect((await llamar('explicar_pregunta', { pregunta_id: 'Q3' })).isError).toBeFalsy();
    expect((await llamar('explicar_pregunta', { pregunta_id: 'NO_VISTA' })).isError).toBe(true);

    const p = (await llamar('mi_progreso')).structuredContent as {
      simulacros: number;
      respondidas: number;
      aciertos: number;
      porEspecialidad: { nombre: string; respondidas: number; aciertos: number }[];
    };
    expect(p).toMatchObject({ simulacros: 1, respondidas: 3, aciertos: 1 });
    expect(p.porEspecialidad.find((e) => e.nombre === 'Nefrología')).toMatchObject({
      respondidas: 1,
      aciertos: 0,
    });
  });

  it('prioriza las no vistas y completa con vistas si no alcanzan', async () => {
    const { llamar } = await conectar(fuenteDe(banco));
    const a = (await llamar('generar_simulacro', { cantidad: 2 })).structuredContent as {
      preguntas: { id: string }[];
    };
    const b = (await llamar('generar_simulacro', { cantidad: 2 })).structuredContent as {
      nuevas: number;
      repetidas: number;
      preguntas: { id: string }[];
    };
    expect(b).toMatchObject({ nuevas: 1, repetidas: 1 });
    const primeraNueva = b.preguntas[0]!.id;
    expect(a.preguntas.map((q) => q.id)).not.toContain(primeraNueva);
  });

  it('rechaza letras fuera de rango y números inexistentes sin corregir', async () => {
    const { llamar } = await conectar(fuenteDe(banco), { nuevoId: () => 'fijo' });
    await llamar('generar_simulacro', { cantidad: 3 });
    const malo = await llamar('corregir_simulacro', { simulacro_id: 'fijo', respuestas: { 1: 'Z', 9: 'A' } });
    expect(malo.isError).toBe(true);
    expect(JSON.stringify(malo.content)).toContain('no existe');
    // Sigue sin corregir: se puede corregir bien después
    const bien = await llamar('corregir_simulacro', { simulacro_id: 'fijo', respuestas: { 1: 'A' } });
    expect(bien.isError).toBeFalsy();
  });

  it('no corrige un simulacro vencido', async () => {
    let ahora = new Date('2026-11-01T10:00:00Z');
    const { llamar } = await conectar(fuenteDe(banco), {
      nuevoId: () => 'viejo',
      ahora: () => ahora,
      vigenciaSimulacroMs: 60_000,
    });
    await llamar('generar_simulacro', { cantidad: 1 });
    ahora = new Date('2026-11-01T10:05:00Z');
    const r = await llamar('corregir_simulacro', { simulacro_id: 'viejo', respuestas: { 1: 'A' } });
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.content)).toContain('venció');
  });

  it('error si los filtros no dejan preguntas', async () => {
    const { llamar } = await conectar(fuenteDe(banco));
    const r = await llamar('generar_simulacro', { especialidades: ['Dermatología'] });
    expect(r.isError).toBe(true);
  });

  it('con la muestra real: ninguna salida previa a corregir contiene claves ni fundamentos', async () => {
    const fuente = new MuestraLocal(['med2_unt']);
    const { llamar } = await conectar(fuente);
    const preguntas = await fuente.preguntas('med2_unt');
    const salidas = [
      await llamar('generar_simulacro', { cantidad: 30 }),
      await llamar('buscar_preguntas', { limite: 20 }),
      await llamar('estadisticas_banco'),
    ];
    for (const r of salidas) {
      const serializado = JSON.stringify(r);
      expect(serializado).not.toContain('respuestaCorrecta');
      for (const q of preguntas) {
        expect(serializado).not.toContain(JSON.stringify(q.fundamentoDetallado.correcta).slice(1, -1));
      }
    }
  });
});
