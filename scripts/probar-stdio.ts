// Prueba rápida del servidor compilado por stdio, como lo usaría Claude: npx tsx scripts/probar-stdio.ts
// Usa BANQUEUNT_DATA y BANQUEUNT_DB del entorno (apunta BANQUEUNT_DB a un archivo de prueba
// para no mezclar este simulacro con tu progreso real).
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

type Texto = { type: string; text: string }[];

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['dist/index.js'],
  env: { ...process.env } as Record<string, string>,
  stderr: 'inherit',
});
const client = new Client({ name: 'probar-stdio', version: '0.0.0' });
await client.connect(transport);

const llamar = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const texto = (r.content as Texto)[0]?.text;
  console.log(`\n===== ${name} ${JSON.stringify(args)}${r.isError ? ' (ERROR)' : ''}\n${texto}`);
  return r.structuredContent as Record<string, unknown>;
};

const sim = await llamar('generar_simulacro', { cantidad: 3, especialidades: ['Cardiología'] });
const preguntas = sim.preguntas as { numero: number }[];
await llamar('corregir_simulacro', {
  simulacro_id: sim.simulacro_id,
  respuestas: Object.fromEntries(preguntas.map((q) => [String(q.numero), 'A'])),
});
await llamar('mi_progreso');
await client.close();
