import type { Pregunta } from '../datos/esquema.js';
import { deduplicar } from '../datos/firma.js';
import { CursoNoDisponible, type FuenteBanco } from '../datos/fuentes.js';

interface Caches {
  unicas: Map<string, Promise<Pregunta[]>>;
  porId: Map<string, Promise<Map<string, Pregunta>>>;
}

/** Acceso al banco ya cargado: preguntas sin repetir y búsqueda por id, con caché por curso. */
export class Banco {
  constructor(
    private readonly fuente: FuenteBanco,
    /** Cursos que puede ver quien usa este Banco; sin él, todos los de la fuente */
    private readonly permitidos?: readonly string[],
    private readonly caches: Caches = { unicas: new Map(), porId: new Map() },
  ) {}

  /**
   * El mismo banco limitado a unos cursos (los de mis_cursos() del alumno). Comparte la caché, así
   * el Worker deduplica cada curso una sola vez para todos los alumnos.
   */
  restringido(cursos: readonly string[]): Banco {
    const permitidos = this.permitidos ? cursos.filter((c) => this.permitidos!.includes(c)) : cursos;
    return new Banco(this.fuente, permitidos, this.caches);
  }

  get origen(): string {
    return this.fuente.origen;
  }

  async cursos(): Promise<string[]> {
    const todos = await this.fuente.cursos();
    return this.permitidos ? todos.filter((c) => this.permitidos!.includes(c)) : todos;
  }

  /** Todas las publicadas, con las repetidas entre exámenes */
  async publicadas(curso: string): Promise<Pregunta[]> {
    if (this.permitidos && !this.permitidos.includes(curso)) {
      throw new CursoNoDisponible(curso, await this.cursos());
    }
    return this.fuente.preguntas(curso);
  }

  /** Una sola vez cada pregunta, aunque esté en varios exámenes */
  unicas(curso: string): Promise<Pregunta[]> {
    return this.memo(this.caches.unicas, curso, async () => deduplicar(await this.publicadas(curso)));
  }

  async buscarPorId(curso: string, id: string): Promise<Pregunta | undefined> {
    const indice = await this.memo(
      this.caches.porId,
      curso,
      async () => new Map((await this.publicadas(curso)).map((q) => [q.id, q])),
    );
    return indice.get(id);
  }

  /** Busca una pregunta por id en todos los cursos disponibles */
  async buscarEnCursos(id: string): Promise<Pregunta | undefined> {
    for (const curso of await this.cursos()) {
      const q = await this.buscarPorId(curso, id);
      if (q) return q;
    }
    return undefined;
  }

  /**
   * Curso a usar cuando la herramienta lo deja opcional: el indicado (si está disponible) o el
   * único disponible. Con varios cursos y ninguno indicado, hay que elegir.
   */
  async resolverCurso(curso?: string): Promise<string> {
    const disponibles = await this.cursos();
    if (curso) {
      if (!disponibles.includes(curso)) throw new CursoNoDisponible(curso, disponibles);
      return curso;
    }
    if (disponibles.length === 1) return disponibles[0]!;
    throw new CursoNoDisponible('', disponibles);
  }

  private memo<T>(mapa: Map<string, Promise<T>>, curso: string, cargar: () => Promise<T>): Promise<T> {
    let valor = mapa.get(curso);
    if (!valor) {
      valor = cargar();
      valor.catch(() => mapa.delete(curso));
      mapa.set(curso, valor);
    }
    return valor;
  }
}
