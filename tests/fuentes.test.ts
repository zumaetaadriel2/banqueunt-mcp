import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CarpetaLocal, MuestraLocal } from '../src/datos/fuentes-node.js';
import { CursoNoDisponible, huellaDeTexto, rutaEnData } from '../src/datos/fuentes.js';
import { pregunta } from './helpers.js';

async function carpetaDePrueba(versionCorrecta = true) {
  const raiz = await mkdtemp(path.join(tmpdir(), 'banqueunt-'));
  await mkdir(path.join(raiz, 'med2_unt'));
  const archivos = {
    'data/med2_unt/examenes_2021.json': [pregunta({ id: 'A1' }), pregunta({ id: 'A2', pregunta: 'Otra' })],
    // Nombre cualquiera: el código no fija nombres, los lee del índice
    'data/med2_unt/prioritarias_algo_nuevo.json': [pregunta({ id: 'P1', prioritaria: true })],
  };
  const versiones: Record<string, string> = {};
  for (const [archivo, contenido] of Object.entries(archivos)) {
    const texto = JSON.stringify(contenido);
    await writeFile(path.join(raiz, archivo.replace(/^data\//, '')), texto);
    versiones[archivo] = versionCorrecta ? await huellaDeTexto(texto) : '000000000000';
  }
  const indice = {
    version: 1,
    categorias: {
      med2_unt: { preguntas: 3, examenes: 2, archivos: Object.keys(archivos), versiones, imagenes: [] },
      encib: { preguntas: 0, examenes: 0, archivos: [], versiones: {}, imagenes: [] },
    },
  };
  await writeFile(path.join(raiz, 'index.json'), JSON.stringify(indice));
  return raiz;
}

describe('CarpetaLocal', () => {
  it('carga los archivos que dice index.json', async () => {
    const fuente = new CarpetaLocal(await carpetaDePrueba(), ['med2_unt']);
    expect(await fuente.cursos()).toEqual(['med2_unt']);
    expect((await fuente.preguntas('med2_unt')).map((q) => q.id)).toEqual(['A1', 'A2', 'P1']);
  });

  it('solo ofrece cursos habilitados y con archivos', async () => {
    const fuente = new CarpetaLocal(await carpetaDePrueba(), ['encib', 'residentado']);
    expect(await fuente.cursos()).toEqual([]);
    await expect(fuente.preguntas('med2_unt')).rejects.toBeInstanceOf(CursoNoDisponible);
  });

  it('avisa si un archivo no coincide con su huella', async () => {
    const avisos: string[] = [];
    const fuente = new CarpetaLocal(await carpetaDePrueba(false), ['med2_unt'], (m) => avisos.push(m));
    await fuente.preguntas('med2_unt');
    expect(avisos).toHaveLength(2);
  });
});

describe('huellaDeTexto', () => {
  it('no depende de los finales de línea', async () => {
    expect(await huellaDeTexto('a\r\nb')).toBe(await huellaDeTexto('a\nb'));
    expect(await huellaDeTexto('a\nb')).toHaveLength(12);
  });

  it('es la misma que la de builder_banco.js (sha256 hex de 12 caracteres)', async () => {
    const texto = '[{"id":"X"}]\n';
    expect(await huellaDeTexto(texto)).toBe(createHash('sha256').update(texto).digest('hex').slice(0, 12));
  });
});

describe('rutaEnData', () => {
  it('quita data/ y exige la carpeta del curso', () => {
    expect(rutaEnData('data/med2_unt/examenes_2021.json', 'med2_unt')).toBe('med2_unt/examenes_2021.json');
    expect(() => rutaEnData('data/encib/x.json', 'med2_unt')).toThrow(/carpeta de su curso/);
    expect(() => rutaEnData('data/med2_unt/../encib/x.json', 'med2_unt')).toThrow();
  });
});

describe('data/muestra.json (repo público)', () => {
  it('solo trae preguntas de med2_unt con clave oficial y sin contenido prioritario', async () => {
    const fuente = new MuestraLocal(['med2_unt']);
    const muestra = await fuente.preguntas('med2_unt');
    expect(muestra.length).toBeGreaterThanOrEqual(20);
    expect(muestra.length).toBeLessThanOrEqual(40);
    for (const q of muestra) {
      expect(q.claveOficial).not.toBe(false);
      expect(q.prioritaria).not.toBe(true);
      expect(q.id).toMatch(/^MED2_\d{4}_/);
    }
  });
});
