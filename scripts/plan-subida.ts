import type { IndiceBancos } from '../src/datos/esquema.js';
import { rutaEnData } from '../src/datos/fuentes.js';

/**
 * Qué hay que subir y borrar en el bucket para que refleje la carpeta data/ local. Lógica pura (sin red
 * ni disco) para poder probarla; scripts/subir-banco.ts la ejecuta con wrangler.
 */
export interface PlanSubida {
  /** Si hay alguno, no se sube nada: el índice local no coincide con sus archivos */
  errores: string[];
  /** Archivos nuevos o cambiados: ruta en el índice («data/med2_unt/x.json») y clave en el bucket */
  subir: { archivo: string; clave: string }[];
  /** Claves que ya no están en el índice */
  borrar: string[];
  /** El index.json que se sube: solo con los cursos habilitados */
  indice: IndiceBancos;
  sinCambios: boolean;
}

export function planDeSubida(
  local: IndiceBancos,
  cursos: string[],
  /** Huella real (huellaDeTexto) de cada archivo local de los cursos habilitados, por su ruta en el índice */
  huellas: Record<string, string>,
  remoto: IndiceBancos | null,
): PlanSubida {
  const errores: string[] = [];
  const categorias: IndiceBancos['categorias'] = {};

  for (const curso of cursos) {
    const entrada = local.categorias[curso];
    if (!entrada || entrada.archivos.length === 0) {
      errores.push(`El curso ${curso} no tiene archivos en index.json.`);
      continue;
    }
    for (const archivo of entrada.archivos) {
      try {
        rutaEnData(archivo, curso);
      } catch (e) {
        errores.push((e as Error).message);
        continue;
      }
      const esperada = entrada.versiones[archivo];
      if (!esperada) errores.push(`${archivo} no tiene versión en index.json.`);
      else if (huellas[archivo] === undefined) errores.push(`${archivo} no existe en la carpeta local.`);
      else if (huellas[archivo] !== esperada) {
        errores.push(
          `${archivo} no coincide con su versión en index.json (corre «node builder_banco.js --reindex»).`,
        );
      }
    }
    categorias[curso] = entrada;
  }

  const indice: IndiceBancos = { ...local, categorias };
  const clave = (archivo: string) => archivo.replace(/^data\//, '');
  const versionRemota = (archivo: string) => {
    for (const entrada of Object.values(remoto?.categorias ?? {})) {
      if (entrada.archivos.includes(archivo)) return entrada.versiones[archivo];
    }
    return undefined;
  };

  const nuevos = Object.values(categorias).flatMap((e) => e.archivos.map((archivo) => ({ archivo, e })));
  const subir = nuevos
    .filter(({ archivo, e }) => versionRemota(archivo) !== e.versiones[archivo])
    .map(({ archivo }) => ({ archivo, clave: clave(archivo) }));

  const quedan = new Set(nuevos.map(({ archivo }) => archivo));
  const borrar = Object.values(remoto?.categorias ?? {})
    .flatMap((e) => e.archivos)
    .filter((archivo) => !quedan.has(archivo))
    .map(clave);

  const sinCambios =
    remoto !== null &&
    subir.length === 0 &&
    borrar.length === 0 &&
    JSON.stringify(remoto) === JSON.stringify(indice);
  return { errores, subir, borrar, indice, sinCambios };
}
