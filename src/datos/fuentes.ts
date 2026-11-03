import { z } from 'zod';
import { Banco, IndiceBancos, type Pregunta } from './esquema.js';

// Lo de este archivo corre en Node y en Cloudflare Workers; lo que lee del disco está en fuentes-node.ts.

export interface FuenteBanco {
  /** 'muestra' | 'carpeta' | 'r2' */
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

export function describirError(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.')}: ${i.message}`)
    .join('; ');
}

export function validarBanco(datos: unknown, origen: string): Pregunta[] {
  const r = Banco.safeParse(datos);
  if (!r.success) throw new Error(`${origen} no tiene el formato esperado: ${describirError(r.error)}`);
  return r.data;
}

/** Preguntas ya cargadas en memoria (en el Worker, la muestra importada como JSON). Se validan una vez. */
export class MuestraEmbebida implements FuenteBanco {
  readonly origen = 'muestra';
  private cache?: Pregunta[];

  constructor(
    private readonly datos: unknown,
    private readonly habilitados: string[],
  ) {}

  private todas(): Pregunta[] {
    this.cache ??= validarBanco(this.datos, 'data/muestra.json');
    return this.cache;
  }

  async cursos(): Promise<string[]> {
    const ids = new Set(this.todas().map((q) => q.categoriaId));
    return this.habilitados.filter((c) => ids.has(c));
  }

  async preguntas(curso: string): Promise<Pregunta[]> {
    if (!(await this.cursos()).includes(curso)) throw new CursoNoDisponible(curso);
    return this.todas().filter((q) => q.categoriaId === curso);
  }
}

/**
 * Misma huella que builder_banco.js (versionDeContenido): sha256 del texto con LF, 12 caracteres.
 * Con Web Crypto, que existe en Node y en Workers.
 */
export async function huellaDeTexto(texto: string): Promise<string> {
  const datos = new TextEncoder().encode(texto.replace(/\r\n/g, '\n'));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', datos));
  return Array.from(hash, (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 12);
}

/**
 * Un banco con la estructura de data/ de examen-pwa: index.json y, por curso, los archivos de
 * index.json → categorias[curso].archivos (nunca nombres fijos en el código). Las subclases solo dicen
 * cómo leer un archivo por su ruta relativa a data/ («index.json», «med2_unt/examenes_2021.json»).
 */
export abstract class FuenteIndexada implements FuenteBanco {
  abstract readonly origen: string;
  private indice?: Promise<IndiceBancos>;
  private readonly bancos = new Map<string, Promise<Pregunta[]>>();

  constructor(
    protected readonly habilitados: string[],
    protected readonly avisar: (mensaje: string) => void = (m) => console.error(m),
  ) {}

  /** El texto del archivo, o un error si no existe */
  protected abstract leerTexto(relativa: string): Promise<string>;

  leerIndice(): Promise<IndiceBancos> {
    if (!this.indice) {
      this.indice = this.leerTexto('index.json').then((t) => {
        const r = IndiceBancos.safeParse(JSON.parse(t));
        if (!r.success)
          throw new Error(`index.json no tiene el formato esperado: ${describirError(r.error)}`);
        return r.data;
      });
      this.indice.catch(() => (this.indice = undefined)); // un fallo no queda en caché
    }
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
        const relativa = rutaEnData(archivo, curso);
        const texto = await this.leerTexto(relativa);
        const esperada = entrada.versiones[archivo];
        if (esperada && (await huellaDeTexto(texto)) !== esperada) {
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

/**
 * Las rutas del índice son relativas a la raíz de examen-pwa («data/<curso>/<banco>.json»); se usan
 * relativas a data/ y tienen que estar en la carpeta de su curso.
 */
export function rutaEnData(archivo: string, curso: string): string {
  const relativa = archivo.replace(/^data\//, '');
  if (!relativa.startsWith(`${curso}/`) || relativa.includes('..')) {
    throw new Error(`${archivo} no está en la carpeta de su curso (data/${curso}/).`);
  }
  return relativa;
}

/** BANQUEUNT_CURSOS: ids separados por comas; por defecto, med2_unt */
export function leerCursos(valor: string | undefined): string[] {
  return (valor ?? 'med2_unt')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
}
