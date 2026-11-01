import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { MuestraLocal } from '../src/datos/fuentes.js';
import { crearServidor } from '../src/server.js';

async function conectar() {
  const server = crearServidor(new MuestraLocal(['med2_unt']));
  const [lado1, lado2] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(lado1), client.connect(lado2)]);
  return client;
}

describe('estadisticas_banco (MCP de punta a punta)', () => {
  it('se lista con su esquema de salida', async () => {
    const client = await conectar();
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'estadisticas_banco');
    expect(tool?.outputSchema).toBeDefined();
    expect(tool?.annotations?.readOnlyHint).toBe(true);
  });

  it('cuenta por especialidad y nunca devuelve respuestas ni fundamentos', async () => {
    const client = await conectar();
    const r = await client.callTool({
      name: 'estadisticas_banco',
      arguments: { especialidad: 'cardiología' },
    });
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
    expect(med2?.curso).toBe('med2_unt');
    expect(med2?.porEspecialidad.reduce((s, e) => s + e.preguntas, 0)).toBe(med2?.unicas);
    expect(med2?.porTema?.length).toBeGreaterThan(0);

    const serializado = JSON.stringify(r);
    for (const prohibido of ['respuestaCorrecta', 'fundamento', 'descarte', 'opciones']) {
      expect(serializado).not.toContain(prohibido);
    }
  });

  it('error claro con un curso que no está disponible', async () => {
    const client = await conectar();
    const r = await client.callTool({ name: 'estadisticas_banco', arguments: { curso: 'residentado' } });
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.content)).toContain('med2_unt');
  });
});
