import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import type { Pregunta } from '../src/datos/esquema.js';
import type { FuenteBanco } from '../src/datos/fuentes.js';
import { SqliteProgresoRepo } from '../src/persistencia/sqlite.js';
import { crearServidor } from '../src/server.js';
import { pregunta } from './helpers.js';

const banco: Pregunta[] = [
  pregunta({
    id: 'N1',
    pregunta: 'Uno',
    especialidad: 'Nefrología',
    tema: 'Hipernatremia',
    respuestaCorrecta: 2,
  }),
  pregunta({
    id: 'N2',
    pregunta: 'Dos',
    especialidad: 'Nefrología',
    tema: 'GN postestreptocócica',
    respuestaCorrecta: 0,
  }),
  pregunta({
    id: 'C1',
    pregunta: 'Tres',
    especialidad: 'Cardiología',
    tema: 'Ritmo sinusal',
    respuestaCorrecta: 1,
  }),
];

const fuente: FuenteBanco = {
  origen: 'prueba',
  cursos: async () => ['med2_unt'],
  preguntas: async () => banco,
};

async function conectar() {
  const server = crearServidor(fuente, new SqliteProgresoRepo(':memory:'), { nuevoId: () => 'sim1' });
  const [lado1, lado2] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(lado1), client.connect(lado2)]);
  return client;
}

const textoDe = (r: { contents: unknown[] }) => (r.contents[0] as { text: string }).text;
const textoPrompt = (r: { messages: { content: unknown }[] }) =>
  (r.messages[0]!.content as { text: string }).text;

describe('recursos', () => {
  it('lista el recurso de cursos y la plantilla de temas por curso', async () => {
    const client = await conectar();
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toEqual(['banqueunt://cursos', 'banqueunt://cursos/med2_unt/temas']);
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map((t) => t.uriTemplate).sort()).toEqual([
      'banqueunt://cursos/{curso}/temas',
      'banqueunt://pregunta/{id}',
    ]);
  });

  it('banqueunt://cursos cuenta preguntas por especialidad', async () => {
    const client = await conectar();
    const datos = JSON.parse(textoDe(await client.readResource({ uri: 'banqueunt://cursos' })));
    expect(datos.cursos[0]).toMatchObject({ curso: 'med2_unt', preguntas: 3 });
    expect(datos.cursos[0].especialidades[0]).toEqual({ nombre: 'Nefrología', preguntas: 2 });
  });

  it('temas de un curso, agrupados por especialidad', async () => {
    const client = await conectar();
    const datos = JSON.parse(
      textoDe(await client.readResource({ uri: 'banqueunt://cursos/med2_unt/temas' })),
    );
    const nefro = datos.especialidades.find((e: { nombre: string }) => e.nombre === 'Nefrología');
    expect(nefro.temas.map((t: { nombre: string }) => t.nombre).sort()).toEqual([
      'GN postestreptocócica',
      'Hipernatremia',
    ]);
  });

  it('una pregunta en versión pública, sin clave, fundamento ni tema', async () => {
    const client = await conectar();
    const texto = textoDe(await client.readResource({ uri: 'banqueunt://pregunta/N1' }));
    expect(JSON.parse(texto).id).toBe('N1');
    for (const prohibido of ['respuestaCorrecta', 'fundamento', 'Hipernatremia']) {
      expect(texto).not.toContain(prohibido);
    }
    await expect(client.readResource({ uri: 'banqueunt://pregunta/NO_EXISTE' })).rejects.toThrow();
  });

  it('autocompleta el curso de la plantilla', async () => {
    const client = await conectar();
    const r = await client.complete({
      ref: { type: 'ref/resource', uri: 'banqueunt://cursos/{curso}/temas' },
      argument: { name: 'curso', value: 'med' },
    });
    expect(r.completion.values).toEqual(['med2_unt']);
  });
});

describe('prompts', () => {
  it('lista los dos prompts', async () => {
    const client = await conectar();
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual(['repasar_temas_debiles', 'sesion_de_repaso']);
  });

  it('autocompleta la especialidad sin importar tildes', async () => {
    const client = await conectar();
    const r = await client.complete({
      ref: { type: 'ref/prompt', name: 'sesion_de_repaso' },
      argument: { name: 'especialidad', value: 'nefro' },
    });
    expect(r.completion.values).toEqual(['Nefrología']);
  });

  it('sesion_de_repaso: una pregunta a la vez, con la especialidad y la cantidad pedidas', async () => {
    const client = await conectar();
    const texto = textoPrompt(
      await client.getPrompt({
        name: 'sesion_de_repaso',
        arguments: { especialidad: 'Nefrología', cantidad: '3' },
      }),
    );
    expect(texto).toContain('3 preguntas de Nefrología');
    expect(texto).toContain('cantidad: 1');
    expect(texto).toContain('especialidades: ["Nefrología"]');
    expect(texto).toContain('corregir_simulacro');
  });

  it('repasar_temas_debiles: sin progreso pide un simulacro primero', async () => {
    const client = await conectar();
    const texto = textoPrompt(await client.getPrompt({ name: 'repasar_temas_debiles', arguments: {} }));
    expect(texto).toContain('aún no he hecho simulacros');
  });

  it('repasar_temas_debiles: usa los temas fallados desde el primer simulacro', async () => {
    const client = await conectar();
    const sim = (await client.callTool({ name: 'generar_simulacro', arguments: { cantidad: 3 } }))
      .structuredContent as {
      preguntas: { numero: number; id: string }[];
    };
    // Acierta solo C1 (clave B)
    const respuestas = Object.fromEntries(
      sim.preguntas.map((q) => [String(q.numero), q.id === 'C1' ? 'B' : 'E']),
    );
    await client.callTool({ name: 'corregir_simulacro', arguments: { simulacro_id: 'sim1', respuestas } });

    const texto = textoPrompt(
      await client.getPrompt({ name: 'repasar_temas_debiles', arguments: { cantidad: '5' } }),
    );
    expect(texto).toContain('- Hipernatremia');
    expect(texto).toContain('- GN postestreptocócica');
    expect(texto).not.toContain('Ritmo sinusal');
    expect(texto).toContain('cantidad: 5');
  });
});
