#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
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

// serveStdio decide en el primer mensaje qué revisión del protocolo habla el cliente (la de 2025 con
// `initialize` o la de 2026 sin estado) y llama a la fábrica una sola vez para toda la conexión.
const conexion = serveStdio(() => crearServidor(fuente, repo, { topeDiario }));

const cerrar = async () => {
  await conexion.close();
  repo.cerrar();
  process.exit(0);
};
process.on('SIGINT', cerrar);
process.on('SIGTERM', cerrar);

console.error(
  `banqueunt-mcp listo (origen: ${fuente.origen}${config.carpetaDatos ? ` → ${config.carpetaDatos}` : ''}; ` +
    `cursos: ${config.cursosHabilitados.join(', ')}; progreso: ${rutaDb}; ` +
    `tope diario: ${topeDiario ?? 'sin tope'})`,
);
