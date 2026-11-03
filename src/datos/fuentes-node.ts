import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pregunta } from './esquema.js';
import { CursoNoDisponible, FuenteIndexada, leerCursos, validarBanco, type FuenteBanco } from './fuentes.js';

// Fuentes que leen del disco: solo para la versión local (stdio). El Worker usa fuentes.ts.

const RUTA_MUESTRA = fileURLToPath(new URL('../../data/muestra.json', import.meta.url));

/** data/muestra.json: un array de preguntas públicas; sirve sin credenciales ni banco real. */
export class MuestraLocal implements FuenteBanco {
  readonly origen = 'muestra';
  private cache?: Promise<Pregunta[]>;

  constructor(
    private readonly habilitados: string[],
    private readonly ruta = RUTA_MUESTRA,
  ) {}

  private todas(): Promise<Pregunta[]> {
    this.cache ??= readFile(this.ruta, 'utf8').then((t) => validarBanco(JSON.parse(t), 'data/muestra.json'));
    return this.cache;
  }

  async cursos(): Promise<string[]> {
    const ids = new Set((await this.todas()).map((q) => q.categoriaId));
    return this.habilitados.filter((c) => ids.has(c));
  }

  async preguntas(curso: string): Promise<Pregunta[]> {
    if (!(await this.cursos()).includes(curso)) throw new CursoNoDisponible(curso);
    return (await this.todas()).filter((q) => q.categoriaId === curso);
  }
}

/** La carpeta data/ de examen-pwa (uso diario en local) */
export class CarpetaLocal extends FuenteIndexada {
  readonly origen = 'carpeta';

  constructor(
    private readonly carpeta: string,
    habilitados: string[],
    avisar?: (mensaje: string) => void,
  ) {
    super(habilitados, avisar);
  }

  protected leerTexto(relativa: string): Promise<string> {
    return readFile(path.join(this.carpeta, relativa), 'utf8');
  }
}

export interface Configuracion {
  carpetaDatos?: string;
  cursosHabilitados: string[];
}

export function leerConfiguracion(env: NodeJS.ProcessEnv = process.env): Configuracion {
  return {
    carpetaDatos: env.BANQUEUNT_DATA?.trim() || undefined,
    cursosHabilitados: leerCursos(env.BANQUEUNT_CURSOS),
  };
}

export function crearFuente(config: Configuracion): FuenteBanco {
  return config.carpetaDatos
    ? new CarpetaLocal(config.carpetaDatos, config.cursosHabilitados)
    : new MuestraLocal(config.cursosHabilitados);
}
