import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { Banco, IndiceBancos, type Pregunta } from './esquema.js';

export interface FuenteBanco {
  /** 'muestra' | 'carpeta' (más adelante 'r2') */
  readonly origen: string;
  /** Cursos con preguntas en esta fuente, ya filtrados por los habilitados */
  cursos(): Promise<string[]>;
  /** Todas las preguntas publicadas de un curso (sin deduplicar) */
  preguntas(curso: string): Promise<Pregunta[]>;
}

export class CursoNoDisponible extends Error {
  constructor(
    public readonly curso: string,
    disponibles?: string[],
  ) {
    const lista = disponibles ? ` Cursos disponibles: ${disponibles.join(', ') || 'ninguno'}.` : '';
    super(
      curso ? `El curso «${curso}» no está disponible en este servidor.${lista}` : `Indica el curso.${lista}`,
    );
  }
}

// Misma huella que builder_banco.js (versionDeContenido): sha256 del texto con LF, 12 caracteres
export function huellaDeTexto(texto: string): string {
  return createHash('sha256').update(texto.replace(/\r\n/g, '\n')).digest('hex').slice(0, 12);
}

function describirError(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.')}: ${i.message}`)
    .join('; ');
}

function validarBanco(datos: unknown, origen: string): Pregunta[] {
  const r = Banco.safeParse(datos);
  if (!r.success) throw new Error(`${origen} no tiene el formato esperado: ${describirError(r.error)}`);
  return r.data;
}

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

/**
 * La carpeta data/ de examen-pwa. Los archivos de cada curso salen de
 * index.json → categorias[curso].archivos (nunca de nombres fijos en el código).
 */
export class CarpetaLocal implements FuenteBanco {
  readonly origen = 'carpeta';
  private indice?: Promise<IndiceBancos>;
  private readonly bancos = new Map<string, Promise<Pregunta[]>>();

  constructor(
    private readonly carpeta: string,
    private readonly habilitados: string[],
    private readonly avisar: (mensaje: string) => void = (m) => console.error(m),
  ) {}

  private leerIndice(): Promise<IndiceBancos> {
    this.indice ??= readFile(path.join(this.carpeta, 'index.json'), 'utf8').then((t) => {
      const r = IndiceBancos.safeParse(JSON.parse(t));
      if (!r.success) throw new Error(`index.json no tiene el formato esperado: ${describirError(r.error)}`);
      return r.data;
    });
    return this.indice;
  }

  async cursos(): Promise<string[]> {
    const { categorias } = await this.leerIndice();
    return this.habilitados.filter((c) => (categorias[c]?.archivos.length ?? 0) > 0);
  }

  preguntas(curso: string): Promise<Pregunta[]> {
    let banco = this.bancos.get(curso);
    if (!banco) {
      banco = this.cargarCurso(curso);
      banco.catch(() => this.bancos.delete(curso)); // un fallo no queda en caché
      this.bancos.set(curso, banco);
    }
    return banco;
  }

  private async cargarCurso(curso: string): Promise<Pregunta[]> {
    if (!(await this.cursos()).includes(curso)) throw new CursoNoDisponible(curso);
    const entrada = (await this.leerIndice()).categorias[curso]!;
    const partes = await Promise.all(
      entrada.archivos.map(async (archivo) => {
        // Las rutas del índice son relativas a la raíz de examen-pwa: «data/<curso>/<banco>.json»
        const relativa = archivo.replace(/^data\//, '');
        if (!relativa.startsWith(`${curso}/`)) {
          throw new Error(`${archivo} no está en la carpeta de su curso (data/${curso}/).`);
        }
        const texto = await readFile(path.join(this.carpeta, relativa), 'utf8');
        const esperada = entrada.versiones[archivo];
        if (esperada && huellaDeTexto(texto) !== esperada) {
          this.avisar(
            `⚠ ${archivo} no coincide con su versión en index.json (corre «node builder_banco.js --reindex»).`,
          );
        }
        const banco = validarBanco(JSON.parse(texto), archivo);
        const ajenas = banco.filter((q) => q.categoriaId !== curso);
        if (ajenas.length > 0)
          throw new Error(`${archivo} tiene preguntas de otro curso (${ajenas[0]!.id}).`);
        return banco;
      }),
    );
    return partes.flat();
  }
}

export interface Configuracion {
  carpetaDatos?: string;
  cursosHabilitados: string[];
}

export function leerConfiguracion(env: NodeJS.ProcessEnv = process.env): Configuracion {
  const cursos = (env.BANQUEUNT_CURSOS ?? 'med2_unt')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  return { carpetaDatos: env.BANQUEUNT_DATA?.trim() || undefined, cursosHabilitados: cursos };
}

export function crearFuente(config: Configuracion): FuenteBanco {
  return config.carpetaDatos
    ? new CarpetaLocal(config.carpetaDatos, config.cursosHabilitados)
    : new MuestraLocal(config.cursosHabilitados);
}
