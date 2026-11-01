// Uso por usuario en los últimos días, para detectar una extracción masiva: npm run uso -- [días]
// Lee BANQUEUNT_DB (por defecto, la base de progreso local). Por defecto, el último día.
import { rutaPorDefecto, SqliteProgresoRepo } from '../src/persistencia/sqlite.js';

const dias = Number(process.argv[2] ?? 1);
if (!Number.isFinite(dias) || dias <= 0) throw new Error(`Número de días inválido: «${process.argv[2]}»`);

const ruta = process.env.BANQUEUNT_DB?.trim() || rutaPorDefecto();
const repo = new SqliteProgresoRepo(ruta);
const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
const uso = await repo.usoPorUsuario(desde);
repo.cerrar();

console.log(`${ruta}\nDesde ${desde} (${dias} día${dias === 1 ? '' : 's'})\n`);
if (uso.length === 0) console.log('Sin llamadas.');
else console.table(uso);
