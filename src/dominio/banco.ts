import type { Pregunta } from '../datos/esquema.js';
import { deduplicar } from '../datos/firma.js';
import { CursoNoDisponible, type FuenteBanco } from '../datos/fuentes.js';

/** Acceso al banco ya cargado: preguntas sin repetir y búsqueda por id, con caché por curso. */
export class Banco {
  private readonly unicasPorCurso = new Map<string, Promise<Pregunta[]>>();
  private readonly porIdPorCurso = new Map<string, Promise<Map<string, Pregunta>>>();

  constructor(private readonly fuente: FuenteBanco) {}

  get origen(): string {
    return this.fuente.origen;
  }

  cursos(): Promise<string[]> {
    return this.fuente.cursos();
  }

  /** Todas las publicadas, con las repetidas entre exámenes */
  publicadas(curso: string): Promise<Pregunta[]> {
    return this.fuente.preguntas(curso);
  }

  /** Una sola vez cada pregunta, aunque esté en varios exámenes */
  unicas(curso: string): Promise<Pregunta[]> {
    return this.memo(this.unicasPorCurso, curso, async () => deduplicar(await this.publicadas(curso)));
  }

  async buscarPorId(curso: string, id: string): Promise<Pregunta | undefined> {
    const indice = await this.memo(
      this.porIdPorCurso,
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
