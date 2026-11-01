#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { crearFuente, leerConfiguracion } from './datos/fuentes.js';
import { crearServidor } from './server.js';

// Con stdio, stdout es el canal del protocolo: los mensajes para personas van a stderr.
const config = leerConfiguracion();
const fuente = crearFuente(config);
const server = crearServidor(fuente);

await server.connect(new StdioServerTransport());
console.error(
  `banqueunt-mcp listo (origen: ${fuente.origen}${config.carpetaDatos ? ` → ${config.carpetaDatos}` : ''}; ` +
    `cursos: ${config.cursosHabilitados.join(', ')})`,
);
