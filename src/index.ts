#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { crearFuente, leerConfiguracion } from './datos/fuentes.js';
import { leerTopeDiario } from './dominio/limites.js';
import { rutaPorDefecto, SqliteProgresoRepo } from './persistencia/sqlite.js';
import { crearServidor } from './server.js';

// Con stdio, stdout es el canal del protocolo: los mensajes para personas van a stderr.
const config = leerConfiguracion();
const fuente = crearFuente(config);
const rutaDb = process.env.BANQUEUNT_DB?.trim() || rutaPorDefecto();
const topeDiario = leerTopeDiario(process.env.BANQUEUNT_TOPE_DIARIO);
const repo = new SqliteProgresoRepo(rutaDb);
const server = crearServidor(fuente, repo, { topeDiario });

const cerrar = () => {
  repo.cerrar();
  process.exit(0);
};
process.on('SIGINT', cerrar);
process.on('SIGTERM', cerrar);

await server.connect(new StdioServerTransport());
console.error(
  `banqueunt-mcp listo (origen: ${fuente.origen}${config.carpetaDatos ? ` → ${config.carpetaDatos}` : ''}; ` +
    `cursos: ${config.cursosHabilitados.join(', ')}; progreso: ${rutaDb}; ` +
    `tope diario: ${topeDiario ?? 'sin tope'})`,
);
