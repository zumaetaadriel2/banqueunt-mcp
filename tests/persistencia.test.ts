import { readdir, readFile } from 'node:fs/promises';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';
import { MuestraLocal } from '../src/datos/fuentes-node.js';
import { D1ProgresoRepo } from '../src/persistencia/d1.js';
import type { ItemSimulacro, ProgresoRepo, Simulacro } from '../src/persistencia/repo.js';
import { ESQUEMA, ESQUEMA_REMOTO } from '../src/persistencia/sql.js';
import { SqliteProgresoRepo } from '../src/persistencia/sqlite.js';
import { crearServidor } from '../src/server.js';
import { d1EnMemoria } from './d1-falso.js';

const item = (orden: number, extra: Partial<ItemSimulacro> = {}): ItemSimulacro => ({
  orden,
  preguntaId: `Q${orden}`,
  firma: `firma-${orden}`,
  especialidad: orden % 2 ? 'Cardiología' : 'Nefrología',
  tema: `Tema ${orden}`,
  clave: 0,
  nOpciones: 5,
  respuesta: null,
  correcta: null,
  ...extra,
});

const simulacro = (id: string, extra: Partial<Simulacro> = {}): Simulacro => ({
  id,
  usuario: 'ana',
  curso: 'med2_unt',
  creadoEn: '2026-11-01T10:00:00.000Z',
  expiraEn: '2026-11-02T10:00:00.000Z',
  corregidoEn: null,
  aciertos: null,
  items: [item(1), item(2), item(3)],
  ...extra,
});

// El mismo contrato para las dos implementaciones: lo que pase en local tiene que pasar en el Worker
const implementaciones: [string, () => ProgresoRepo][] = [
  ['SQLite', () => new SqliteProgresoRepo(':memory:')],
  ['D1', () => new D1ProgresoRepo(d1EnMemoria())],
];

describe.each(implementaciones)('ProgresoRepo con %s', (_nombre, crear) => {
  it('guarda y lee un simulacro solo para su usuario', async () => {
    const repo = crear();
    await repo.crearSimulacro(simulacro('s1'));
    const leido = await repo.obtenerSimulacro('s1', 'ana');
    expect(leido).toEqual(simulacro('s1'));
    expect(await repo.obtenerSimulacro('s1', 'beto')).toBeUndefined();
  });

  it('crear un simulacro es todo o nada', async () => {
    const repo = crear();
    // Dos ítems con el mismo orden violan la clave primaria: no debe quedar el simulacro a medias
    await expect(repo.crearSimulacro(simulacro('roto', { items: [item(1), item(1)] }))).rejects.toThrow();
    expect(await repo.obtenerSimulacro('roto', 'ana')).toBeUndefined();
  });

  it('corrige una sola vez y no pisa la primera corrección', async () => {
    const repo = crear();
    await repo.crearSimulacro(simulacro('s1'));
    await repo.guardarCorreccion('s1', 'ana', '2026-11-01T11:00:00.000Z', [
      { orden: 1, respuesta: 0, correcta: true },
      { orden: 2, respuesta: 3, correcta: false },
      { orden: 3, respuesta: null, correcta: false },
    ]);
    await expect(
      repo.guardarCorreccion('s1', 'ana', '2026-11-01T12:00:00.000Z', [
        { orden: 1, respuesta: 4, correcta: false },
      ]),
    ).rejects.toThrow(/ya fue corregido/);
    await expect(repo.guardarCorreccion('s1', 'beto', '2026-11-01T12:00:00.000Z', [])).rejects.toThrow();

    const s = await repo.obtenerSimulacro('s1', 'ana');
    expect(s).toMatchObject({ corregidoEn: '2026-11-01T11:00:00.000Z', aciertos: 1 });
    expect(s?.items.map((it) => [it.respuesta, it.correcta])).toEqual([
      [0, true],
      [3, false],
      [null, false],
    ]);
  });

  it('firmas vistas, resúmenes, ítems respondidos y preguntas corregidas', async () => {
    const repo = crear();
    await repo.crearSimulacro(simulacro('viejo'));
    await repo.crearSimulacro(simulacro('nuevo', { items: [item(4)] }));
    await repo.crearSimulacro(simulacro('otro-curso', { curso: 'encib', items: [item(9)] }));
    await repo.crearSimulacro(simulacro('de-beto', { usuario: 'beto', items: [item(7)] }));
    await repo.guardarCorreccion('viejo', 'ana', '2026-11-01T11:00:00.000Z', [
      { orden: 1, respuesta: 0, correcta: true },
      { orden: 2, respuesta: 1, correcta: false },
      { orden: 3, respuesta: 0, correcta: true },
    ]);
    await repo.guardarCorreccion('nuevo', 'ana', '2026-11-01T12:00:00.000Z', [
      { orden: 4, respuesta: 2, correcta: false },
    ]);

    expect([...(await repo.firmasVistas('ana', 'med2_unt'))].sort()).toEqual([
      'firma-1',
      'firma-2',
      'firma-3',
      'firma-4',
    ]);
    expect(await repo.simulacrosCorregidos('ana', 'med2_unt')).toEqual([
      {
        id: 'nuevo',
        curso: 'med2_unt',
        creadoEn: '2026-11-01T10:00:00.000Z',
        corregidoEn: '2026-11-01T12:00:00.000Z',
        aciertos: 0,
        total: 1,
      },
      {
        id: 'viejo',
        curso: 'med2_unt',
        creadoEn: '2026-11-01T10:00:00.000Z',
        corregidoEn: '2026-11-01T11:00:00.000Z',
        aciertos: 2,
        total: 3,
      },
    ]);
    const items = await repo.itemsRespondidos('ana');
    expect(items.map((it) => [it.preguntaId, it.correcta])).toEqual([
      ['Q4', false],
      ['Q1', true],
      ['Q2', false],
      ['Q3', true],
    ]);
    expect(await repo.preguntaCorregida('ana', 'Q2')).toEqual({ curso: 'med2_unt' });
    expect(await repo.preguntaCorregida('ana', 'Q9')).toBeUndefined(); // salió, pero sin corregir
    expect(await repo.preguntaCorregida('beto', 'Q2')).toBeUndefined();
  });

  it('registro de llamadas: suma solo las ok del usuario desde la fecha', async () => {
    const repo = crear();
    const base = { herramienta: 'buscar_preguntas', resultado: 'ok' as const };
    await repo.registrarLlamada({ ...base, usuario: 'ana', cantidad: 5, en: '2026-11-01T04:00:00Z' });
    await repo.registrarLlamada({ ...base, usuario: 'ana', cantidad: 3, en: '2026-11-01T10:00:00Z' });
    await repo.registrarLlamada({
      ...base,
      usuario: 'ana',
      cantidad: 9,
      en: '2026-11-01T11:00:00Z',
      resultado: 'limite',
    });
    await repo.registrarLlamada({ ...base, usuario: 'beto', cantidad: 20, en: '2026-11-01T10:00:00Z' });

    expect(await repo.preguntasServidas('ana', '2026-11-01T05:00:00Z')).toBe(3);
    expect(await repo.preguntasServidas('nadie', '2026-11-01T05:00:00Z')).toBe(0);
    expect(await repo.usoPorUsuario('2026-11-01T05:00:00Z')).toEqual([
      { usuario: 'beto', llamadas: 1, preguntas: 20, rechazadas: 0 },
      { usuario: 'ana', llamadas: 2, preguntas: 3, rechazadas: 1 },
    ]);
  });
});

describe('migraciones de D1', () => {
  const leer = async (archivo: string) =>
    (await readFile(new URL(`../migrations/${archivo}`, import.meta.url), 'utf8'))
      .replace(/^--.*$/gm, '')
      .replace(/\r\n/g, '\n')
      .trim();

  it('0001_inicial.sql coincide con el esquema de SQLite', async () => {
    expect(await leer('0001_inicial.sql')).toBe(ESQUEMA.trim());
  });

  it('0002_intentos_login.sql coincide con el esquema solo remoto', async () => {
    expect(await leer('0002_intentos_login.sql')).toBe(ESQUEMA_REMOTO.trim());
  });

  it('no hay migraciones sin revisar', async () => {
    expect((await readdir(new URL('../migrations/', import.meta.url))).sort()).toEqual([
      '0001_inicial.sql',
      '0002_intentos_login.sql',
    ]);
  });
});

describe('servidor con D1', () => {
  it('genera, corrige y muestra el progreso igual que con SQLite', async () => {
    const server = crearServidor(new MuestraLocal(['med2_unt']), new D1ProgresoRepo(d1EnMemoria()), {
      nuevoId: () => 'sim-d1',
    });
    const [lado1, lado2] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([server.connect(lado1), client.connect(lado2)]);

    const g = await client.callTool({ name: 'generar_simulacro', arguments: { cantidad: 2 } });
    expect(g.isError).toBeFalsy();
    const c = await client.callTool({
      name: 'corregir_simulacro',
      arguments: { simulacro_id: 'sim-d1', respuestas: { 1: 'A', 2: 'B' } },
    });
    expect(c.isError).toBeFalsy();
    const p = await client.callTool({ name: 'mi_progreso', arguments: {} });
    expect(p.structuredContent).toMatchObject({ simulacros: 1, respondidas: 2 });
  });
});
