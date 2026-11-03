import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';
import type { FuenteBanco } from '../src/datos/fuentes.js';
import { inicioDelDia, leerTopeDiario, mensajeTope } from '../src/dominio/limites.js';
import { SqliteProgresoRepo } from '../src/persistencia/sqlite.js';
import { crearServidor, type OpcionesServidor } from '../src/server.js';
import { pregunta } from './helpers.js';

type Llamada = { isError?: boolean; structuredContent?: unknown; content?: unknown };

const banco = ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco'].map((texto, i) =>
  pregunta({ id: `P${i + 1}`, pregunta: texto }),
);

const fuente: FuenteBanco = {
  origen: 'prueba',
  cursos: async () => ['med2_unt'],
  preguntas: async () => banco,
};

async function conectar(opciones: OpcionesServidor = {}) {
  const repo = new SqliteProgresoRepo(':memory:');
  const server = crearServidor(fuente, repo, { nuevoId: () => 'sim1', ...opciones });
  const [lado1, lado2] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(lado1), client.connect(lado2)]);
  const llamar = (name: string, args: Record<string, unknown> = {}) =>
    client.callTool({ name, arguments: args }) as Promise<Llamada>;
  return { client, llamar, repo };
}

const texto = (r: Llamada) => JSON.stringify(r.content);

describe('inicioDelDia', () => {
  it('es la medianoche de Perú (05:00 UTC)', () => {
    expect(inicioDelDia(new Date('2026-11-01T15:00:00Z')).toISOString()).toBe('2026-11-01T05:00:00.000Z');
    // 23:59 del 1 de noviembre en Perú todavía es el 1
    expect(inicioDelDia(new Date('2026-11-02T04:59:00Z')).toISOString()).toBe('2026-11-01T05:00:00.000Z');
    expect(inicioDelDia(new Date('2026-11-02T05:00:00Z')).toISOString()).toBe('2026-11-02T05:00:00.000Z');
  });
});

describe('leerTopeDiario', () => {
  it('sin valor, vacío o 0 no hay tope', () => {
    expect(leerTopeDiario(undefined)).toBeNull();
    expect(leerTopeDiario('  ')).toBeNull();
    expect(leerTopeDiario('0')).toBeNull();
  });

  it('acepta enteros positivos y rechaza lo demás', () => {
    expect(leerTopeDiario(' 300 ')).toBe(300);
    expect(() => leerTopeDiario('mucho')).toThrow(/BANQUEUNT_TOPE_DIARIO/);
    expect(() => leerTopeDiario('2.5')).toThrow();
    expect(() => leerTopeDiario('-1')).toThrow();
  });
});

describe('mensajeTope', () => {
  it('dice cuántas quedan o cuándo se reinicia', () => {
    expect(mensajeTope(10, 7, 5)).toContain('quedan 3');
    expect(mensajeTope(10, 10, 1)).toContain('medianoche');
  });
});

describe('registro de llamadas en SQLite', () => {
  it('suma solo las llamadas ok del usuario desde la fecha pedida', async () => {
    const repo = new SqliteProgresoRepo(':memory:');
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
    await repo.registrarLlamada({
      ...base,
      usuario: 'ana',
      cantidad: 2,
      en: '2026-11-01T12:00:00Z',
      resultado: 'error',
    });
    await repo.registrarLlamada({ ...base, usuario: 'beto', cantidad: 20, en: '2026-11-01T10:00:00Z' });

    expect(await repo.preguntasServidas('ana', '2026-11-01T05:00:00Z')).toBe(3);
    expect(await repo.preguntasServidas('nadie', '2026-11-01T05:00:00Z')).toBe(0);
    expect(await repo.usoPorUsuario('2026-11-01T05:00:00Z')).toEqual([
      { usuario: 'beto', llamadas: 1, preguntas: 20, rechazadas: 0 },
      { usuario: 'ana', llamadas: 3, preguntas: 3, rechazadas: 1 },
    ]);
  });
});

describe('tope diario en el servidor', () => {
  it('sin tope (local) no limita, pero registra cada llamada', async () => {
    const { llamar, repo } = await conectar();
    for (let i = 0; i < 5; i++)
      expect((await llamar('buscar_preguntas', { limite: 20 })).isError).toBeFalsy();
    expect((await llamar('estadisticas_banco', { curso: 'residentado' })).isError).toBe(true);
    const [uso] = await repo.usoPorUsuario('2000-01-01T00:00:00Z');
    expect(uso).toEqual({ usuario: 'local', llamadas: 6, preguntas: 25, rechazadas: 0 });
  });

  it('corta al llegar al tope, deja corregir y repasar, y se reinicia a medianoche de Perú', async () => {
    let ahora = new Date('2026-11-01T15:00:00Z'); // 10:00 en Perú
    const { client, llamar, repo } = await conectar({ topeDiario: 4, ahora: () => ahora });

    expect((await llamar('buscar_preguntas', { limite: 2 })).isError).toBeFalsy();

    // Pide 3 cuando quedan 2: se rechaza sin guardar el simulacro
    const demasiado = await llamar('generar_simulacro', { cantidad: 3 });
    expect(demasiado.isError).toBe(true);
    expect(texto(demasiado)).toContain('quedan 2');
    expect(await repo.obtenerSimulacro('sim1', 'local')).toBeUndefined();

    const g = await llamar('generar_simulacro', { cantidad: 2, excluir_vistas: false });
    expect(g.isError).toBeFalsy();

    const agotado = await llamar('buscar_preguntas', { limite: 1 });
    expect(agotado.isError).toBe(true);
    expect(texto(agotado)).toContain('medianoche');
    await expect(client.readResource({ uri: 'banqueunt://pregunta/P1' })).rejects.toThrow(/Tope diario/);

    // Corregir y ver el progreso no entregan preguntas nuevas: siguen funcionando
    expect(
      (await llamar('corregir_simulacro', { simulacro_id: 'sim1', respuestas: { 1: 'A' } })).isError,
    ).toBeFalsy();
    expect((await llamar('mi_progreso')).isError).toBeFalsy();

    ahora = new Date('2026-11-02T04:59:00Z'); // 23:59 en Perú
    expect((await llamar('buscar_preguntas', { limite: 1 })).isError).toBe(true);
    ahora = new Date('2026-11-02T05:00:00Z'); // medianoche en Perú
    expect((await llamar('buscar_preguntas', { limite: 1 })).isError).toBeFalsy();

    expect(await repo.usoPorUsuario('2026-11-01T00:00:00Z')).toEqual([
      { usuario: 'local', llamadas: 9, preguntas: 5, rechazadas: 4 },
    ]);
  });
});
