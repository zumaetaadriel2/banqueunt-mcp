/**
 * Genera data/muestra.json (lo único del banco que va al repo público) desde examen-pwa/data.
 *
 * Reglas:
 *  - solo bancos de exámenes antiguos con año: data/<curso>/examenes_<año>.json
 *  - nunca contenido de pago: nada de prioritarias_* ni preguntas con prioritaria: true, ni
 *    preguntas cuyo enunciado también esté en una prioritaria
 *  - solo con clave oficial (sin claveOficial: false)
 *  - especialidades variadas y, si hay, algunas con el formato ampliado de fundamento
 *
 * Uso: BANQUEUNT_DATA=C:\...\examen-pwa\data npm run muestra -- [--curso=med2_unt] [--n=30]
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Banco, IndiceBancos, type Pregunta } from '../src/datos/esquema.js';
import { firmaPregunta } from '../src/datos/firma.js';

const args = process.argv.slice(2);
const opcion = (nombre: string) => args.find((a) => a.startsWith(`--${nombre}=`))?.split('=')[1];
const curso = opcion('curso') ?? 'med2_unt';
const total = Number(opcion('n') ?? 30);
const carpeta = process.env.BANQUEUNT_DATA;
if (!carpeta) {
  console.error('✖ Define BANQUEUNT_DATA con la carpeta data/ de examen-pwa.');
  process.exit(1);
}

const EXAMEN_ANTIGUO = /\/examenes_\d{4}\.json$/;
const PRIORITARIAS = /\/prioritarias_[^/]+\.json$/;

const indice = IndiceBancos.parse(JSON.parse(await readFile(path.join(carpeta, 'index.json'), 'utf8')));
const entrada = indice.categorias[curso];
if (!entrada) throw new Error(`El curso «${curso}» no está en index.json.`);

async function leer(archivo: string): Promise<Pregunta[]> {
  const texto = await readFile(path.join(carpeta!, archivo.replace(/^data\//, '')), 'utf8');
  return Banco.parse(JSON.parse(texto));
}

const firmasPrioritarias = new Set<string>();
for (const archivo of entrada.archivos.filter((a) => PRIORITARIAS.test(a))) {
  (await leer(archivo)).forEach((q) => firmasPrioritarias.add(firmaPregunta(q)));
}

const candidatas: Pregunta[] = [];
const firmas = new Set<string>();
for (const archivo of entrada.archivos.filter((a) => EXAMEN_ANTIGUO.test(a))) {
  for (const q of await leer(archivo)) {
    const firma = firmaPregunta(q);
    if (q.claveOficial === false || q.prioritaria === true) continue;
    if (firmasPrioritarias.has(firma) || firmas.has(firma)) continue;
    firmas.add(firma);
    candidatas.push(q);
  }
}

// Reparto determinista: por especialidad, en turnos, las ampliadas primero dentro de cada una
const porEspecialidad = new Map<string, Pregunta[]>();
for (const q of [...candidatas].sort((a, b) => a.id.localeCompare(b.id))) {
  const lista = porEspecialidad.get(q.especialidad) ?? [];
  lista.push(q);
  porEspecialidad.set(q.especialidad, lista);
}
for (const lista of porEspecialidad.values()) {
  lista.sort((a, b) => Number('idea' in b.fundamentoDetallado) - Number('idea' in a.fundamentoDetallado));
}

const muestra: Pregunta[] = [];
while (muestra.length < total && [...porEspecialidad.values()].some((l) => l.length > 0)) {
  for (const lista of porEspecialidad.values()) {
    const q = lista.shift();
    if (q && muestra.length < total) muestra.push(q);
  }
}

const destino = fileURLToPath(new URL('../data/muestra.json', import.meta.url));
await writeFile(destino, JSON.stringify(muestra, null, 2) + '\n', 'utf8');
const ampliadas = muestra.filter((q) => 'idea' in q.fundamentoDetallado).length;
console.log(
  `✔ ${muestra.length} preguntas de ${new Set(muestra.map((q) => q.especialidad)).size} especialidades ` +
    `(${ampliadas} con fundamento ampliado) de ${candidatas.length} candidatas → data/muestra.json`,
);
