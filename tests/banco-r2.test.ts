import { describe, expect, it } from 'vitest';
import { planDeSubida } from '../scripts/plan-subida.js';
import type { IndiceBancos } from '../src/datos/esquema.js';
import { huellaDeTexto, MuestraEmbebida } from '../src/datos/fuentes.js';
import { BancoR2, RECARGA_MS, SelectorBanco, type BucketBanco } from '../src/remoto/banco-r2.js';
import { pregunta } from './helpers.js';

/** Un bucket de R2 de mentira: claves → texto, con un etag que cambia en cada escritura */
function bucketFalso(objetos: Record<string, string> = {}) {
  const etags: Record<string, string> = {};
  let n = 0;
  const poner = (clave: string, texto: string) => {
    objetos[clave] = texto;
    etags[clave] = `etag-${++n}`;
  };
  for (const [k, v] of Object.entries(objetos)) poner(k, v);
  const lecturas: string[] = [];
  const bucket: BucketBanco = {
    async get(clave) {
      lecturas.push(clave);
      return clave in objetos ? { text: async () => objetos[clave]! } : null;
    },
    async head(clave) {
      return clave in objetos ? { etag: etags[clave]! } : null;
    },
  };
  return { bucket, poner, lecturas };
}

async function bancoSubido(huellaCorrecta = true): Promise<Record<string, string>> {
  const examen = JSON.stringify([pregunta({ id: 'R1' }), pregunta({ id: 'R2', pregunta: 'Otra' })]);
  const indice = {
    version: 1,
    categorias: {
      med2_unt: {
        preguntas: 2,
        archivos: ['data/med2_unt/examenes_2021.json'],
        versiones: {
          'data/med2_unt/examenes_2021.json': huellaCorrecta ? await huellaDeTexto(examen) : '000000000000',
        },
      },
    },
  };
  return { 'index.json': JSON.stringify(indice), 'med2_unt/examenes_2021.json': examen };
}

describe('BancoR2', () => {
  it('lee index.json y los archivos del curso desde el bucket', async () => {
    const { bucket } = bucketFalso(await bancoSubido());
    const fuente = new BancoR2(bucket, ['med2_unt']);
    expect(fuente.origen).toBe('r2');
    expect(await fuente.cursos()).toEqual(['med2_unt']);
    expect((await fuente.preguntas('med2_unt')).map((q) => q.id)).toEqual(['R1', 'R2']);
  });

  it('avisa si un archivo no coincide con su huella y falla si falta', async () => {
    const avisos: string[] = [];
    const objetos = await bancoSubido(false);
    expect(
      (
        await new BancoR2(bucketFalso(objetos).bucket, ['med2_unt'], (m) => avisos.push(m)).preguntas(
          'med2_unt',
        )
      ).length,
    ).toBe(2);
    expect(avisos).toHaveLength(1);

    delete objetos['med2_unt/examenes_2021.json'];
    await expect(
      new BancoR2(bucketFalso(objetos).bucket, ['med2_unt']).preguntas('med2_unt'),
    ).rejects.toThrow(/Falta med2_unt\/examenes_2021.json/);
  });
});

describe('SelectorBanco', () => {
  const muestra = () => new MuestraEmbebida([pregunta({ id: 'MUESTRA_1' })], ['med2_unt']);

  it('sin bucket o con el bucket vacío usa la muestra', async () => {
    expect((await new SelectorBanco(undefined, ['med2_unt'], muestra).banco()).origen).toBe('muestra');
    expect((await new SelectorBanco(bucketFalso().bucket, ['med2_unt'], muestra).banco()).origen).toBe(
      'muestra',
    );
  });

  it('usa R2 cuando hay banco subido y lo recarga solo si cambió index.json', async () => {
    let ahora = 1_000_000;
    const { bucket, poner } = bucketFalso();
    const selector = new SelectorBanco(bucket, ['med2_unt'], muestra, () => ahora);
    const primero = await selector.banco();
    expect(primero.origen).toBe('muestra');

    // Se sube el banco: hasta la próxima revisión sigue la muestra
    for (const [clave, texto] of Object.entries(await bancoSubido())) poner(clave, texto);
    expect(await selector.banco()).toBe(primero);
    ahora += RECARGA_MS;
    const r2 = await selector.banco();
    expect(r2.origen).toBe('r2');
    expect(await r2.unicas('med2_unt')).toHaveLength(2);

    // Sin cambios en el índice: el mismo Banco (con su caché)
    ahora += RECARGA_MS;
    expect(await selector.banco()).toBe(r2);

    // Índice nuevo: Banco nuevo
    poner('index.json', JSON.parse(JSON.stringify((await bancoSubido())['index.json'])));
    ahora += RECARGA_MS;
    expect(await selector.banco()).not.toBe(r2);
  });
});

describe('planDeSubida', () => {
  const indice = (
    archivos: Record<string, string>,
    otros: IndiceBancos['categorias'] = {},
  ): IndiceBancos => ({
    version: 3,
    categorias: {
      med2_unt: { preguntas: 10, archivos: Object.keys(archivos), versiones: archivos },
      ...otros,
    },
  });
  const encib = {
    encib: {
      preguntas: 5,
      archivos: ['data/encib/x.json'],
      versiones: { 'data/encib/x.json': 'eeeeeeeeeeee' },
    },
  };

  it('la primera vez sube todo, y el índice solo lleva los cursos habilitados', () => {
    const local = indice(
      { 'data/med2_unt/a.json': 'aaaaaaaaaaaa', 'data/med2_unt/b.json': 'bbbbbbbbbbbb' },
      encib,
    );
    const plan = planDeSubida(
      local,
      ['med2_unt'],
      { 'data/med2_unt/a.json': 'aaaaaaaaaaaa', 'data/med2_unt/b.json': 'bbbbbbbbbbbb' },
      null,
    );
    expect(plan.errores).toEqual([]);
    expect(plan.subir.map((s) => s.clave)).toEqual(['med2_unt/a.json', 'med2_unt/b.json']);
    expect(plan.borrar).toEqual([]);
    expect(Object.keys(plan.indice.categorias)).toEqual(['med2_unt']);
    expect(plan.sinCambios).toBe(false);
  });

  it('después sube solo lo que cambió y borra lo que salió del índice', () => {
    const remoto = indice({
      'data/med2_unt/a.json': 'aaaaaaaaaaaa',
      'data/med2_unt/viejo.json': 'vvvvvvvvvvvv',
    });
    const local = indice({
      'data/med2_unt/a.json': 'a2a2a2a2a2a2',
      'data/med2_unt/nuevo.json': 'nnnnnnnnnnnn',
    });
    const plan = planDeSubida(
      local,
      ['med2_unt'],
      { 'data/med2_unt/a.json': 'a2a2a2a2a2a2', 'data/med2_unt/nuevo.json': 'nnnnnnnnnnnn' },
      remoto,
    );
    expect(plan.subir.map((s) => s.clave)).toEqual(['med2_unt/a.json', 'med2_unt/nuevo.json']);
    expect(plan.borrar).toEqual(['med2_unt/viejo.json']);
  });

  it('sin cambios no hace nada', () => {
    const local = indice({ 'data/med2_unt/a.json': 'aaaaaaaaaaaa' });
    const plan = planDeSubida(
      local,
      ['med2_unt'],
      { 'data/med2_unt/a.json': 'aaaaaaaaaaaa' },
      structuredClone(local),
    );
    expect(plan).toMatchObject({ subir: [], borrar: [], sinCambios: true });
  });

  it('se detiene si el índice local está desfasado, falta un archivo o no hay curso', () => {
    const local = indice({ 'data/med2_unt/a.json': 'aaaaaaaaaaaa', 'data/med2_unt/b.json': 'bbbbbbbbbbbb' });
    const plan = planDeSubida(
      local,
      ['med2_unt', 'residentado'],
      { 'data/med2_unt/a.json': 'distinta0000' },
      null,
    );
    expect(plan.errores).toHaveLength(3);
    expect(plan.errores.join('\n')).toMatch(/a.json no coincide[\s\S]*b.json no existe[\s\S]*residentado/);
  });
});
