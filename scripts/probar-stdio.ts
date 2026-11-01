// Prueba rápida del servidor compilado por stdio, como lo usaría Claude: npx tsx scripts/probar-stdio.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['dist/index.js'],
  env: { ...process.env } as Record<string, string>,
  stderr: 'inherit',
});
const client = new Client({ name: 'probar-stdio', version: '0.0.0' });
await client.connect(transport);
const r = await client.callTool({ name: 'estadisticas_banco', arguments: {} });
const contenido = r.content as { type: string; text: string }[];
console.log(contenido[0]?.text);
await client.close();
