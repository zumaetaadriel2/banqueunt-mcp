// Sube el banco real (la carpeta data/ de examen-pwa) al bucket privado de R2 del Worker:
//   npm run subir-banco                       al R2 local de `wrangler dev` (para probar)
//   npm run subir-banco -- --simular          solo muestra el plan
//   npm run subir-banco -- --remoto           al bucket de producción (requiere `npx wrangler login`)
// Lee BANQUEUNT_DATA y BANQUEUNT_CURSOS (por defecto med2_unt). Sube solo los archivos cuya huella cambió,
// después index.json (con solo los cursos habilitados) y al final borra los que ya no están en el índice.
// Se detiene sin subir nada si el índice local no coincide con sus archivos.
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { IndiceBancos } from '../src/datos/esquema.js';
import { huellaDeTexto, leerCursos, rutaEnData } from '../src/datos/fuentes.js';
import { planDeSubida } from './plan-subida.js';

/** Tiene que coincidir con r2_buckets[].bucket_name de wrangler.jsonc */
const BUCKET = 'banqueunt-mcp-bancos';

const remoto = process.argv.includes('--remoto');
const simular = process.argv.includes('--simular');
const destino = remoto ? '--remote' : '--local';

const carpeta = process.env.BANQUEUNT_DATA?.trim();
if (!carpeta) throw new Error('Falta BANQUEUNT_DATA: la carpeta data/ de examen-pwa.');
const cursos = leerCursos(process.env.BANQUEUNT_CURSOS);

const wrangler = path.join(
  path.dirname(createRequire(import.meta.url).resolve('wrangler/package.json')),
  'bin',
  'wrangler.js',
);
function correrWrangler(args: string[]): { ok: boolean; salida: string; error: string } {
  const r = spawnSync(process.execPath, [wrangler, ...args], {
    encoding: 'utf8',
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    maxBuffer: 256 * 1024 * 1024,
  });
  return { ok: r.status === 0, salida: r.stdout, error: r.stderr };
}

const leerIndice = (texto: string) => IndiceBancos.parse(JSON.parse(texto));

const local = leerIndice(await readFile(path.join(carpeta, 'index.json'), 'utf8'));
const huellas: Record<string, string> = {};
for (const curso of cursos) {
  for (const archivo of local.categorias[curso]?.archivos ?? []) {
    try {
      huellas[archivo] = await huellaDeTexto(
        await readFile(path.join(carpeta, rutaEnData(archivo, curso)), 'utf8'),
      );
    } catch {
      // planDeSubida informa del archivo que falta o está fuera de su carpeta
    }
  }
}

const actual = correrWrangler(['r2', 'object', 'get', `${BUCKET}/index.json`, '--pipe', destino]);
const indiceRemoto = actual.ok ? leerIndice(actual.salida) : null;
if (!actual.ok && !/not found|does not exist|NoSuchKey|404/i.test(actual.error)) {
  throw new Error(`No se pudo leer index.json del bucket:\n${actual.error}`);
}

const plan = planDeSubida(local, cursos, huellas, indiceRemoto);
console.log(
  `Bucket ${BUCKET} (${remoto ? 'producción' : 'local de wrangler dev'}) · cursos: ${cursos.join(', ')}`,
);
if (plan.errores.length > 0) {
  console.error(`\nNo se sube nada:\n- ${plan.errores.join('\n- ')}`);
  process.exit(1);
}
if (plan.sinCambios) {
  console.log('El bucket ya está al día.');
  process.exit(0);
}
console.log(`Subir: ${plan.subir.length} · borrar: ${plan.borrar.length} · index.json: sí`);
for (const { clave } of plan.subir) console.log(`  + ${clave}`);
for (const clave of plan.borrar) console.log(`  - ${clave}`);
if (simular) process.exit(0);

const subir = (clave: string, archivo: string) => {
  const r = correrWrangler([
    'r2',
    'object',
    'put',
    `${BUCKET}/${clave}`,
    '--file',
    archivo,
    '--content-type',
    'application/json',
    destino,
  ]);
  if (!r.ok) throw new Error(`No se pudo subir ${clave}:\n${r.error}`);
};

// Primero los archivos, luego el índice que los nombra y al final lo que sobra: el Worker nunca ve un
// índice que apunte a un archivo que aún no está.
for (const { clave } of plan.subir) subir(clave, path.join(carpeta, clave));
const temporal = await mkdtemp(path.join(tmpdir(), 'banqueunt-indice-'));
try {
  const rutaIndice = path.join(temporal, 'index.json');
  await writeFile(rutaIndice, JSON.stringify(plan.indice));
  subir('index.json', rutaIndice);
} finally {
  await rm(temporal, { recursive: true, force: true });
}
for (const clave of plan.borrar) {
  const r = correrWrangler(['r2', 'object', 'delete', `${BUCKET}/${clave}`, destino]);
  if (!r.ok) console.error(`⚠ No se pudo borrar ${clave}: ${r.error}`);
}
console.log('Listo. El Worker lo verá en menos de 5 minutos.');
