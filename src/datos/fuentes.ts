import { z } from 'zod';
import { Banco, type Pregunta } from './esquema.js';

// Lo de este archivo corre en Node y en Cloudflare Workers; lo que lee del disco está en fuentes-node.ts.

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

/** BANQUEUNT_CURSOS: ids separados por comas; por defecto, med2_unt */
export function leerCursos(valor: string | undefined): string[] {
  return (valor ?? 'med2_unt')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
}
