import type {
  ItemRespondido,
  Llamada,
  ProgresoRepo,
  ResumenSimulacro,
  Simulacro,
  UsoUsuario,
} from './repo.js';
import { aItemRespondido, aResumen, aSimulacro, aUso, SQL, type Fila } from './sql.js';

/**
 * Lo mínimo de la API de Cloudflare D1 que usa el repo. El binding real (`env.DB`) lo cumple, y los tests
 * lo imitan sobre node:sqlite sin depender de los tipos globales de Workers.
 */
export interface SentenciaD1 {
  bind(...valores: unknown[]): SentenciaD1;
  first<T = Fila>(): Promise<T | null>;
  all<T = Fila>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}

export interface BaseD1 {
  prepare(sql: string): SentenciaD1;
  /** Ejecuta las sentencias en orden dentro de una transacción: si una falla, no se aplica ninguna */
  batch(sentencias: SentenciaD1[]): Promise<{ meta: { changes: number } }[]>;
}

/** Progreso en Cloudflare D1 (modo remoto). Mismo esquema y consultas que SQLite (sql.ts). */
export class D1ProgresoRepo implements ProgresoRepo {
  constructor(private readonly db: BaseD1) {}

  async crearSimulacro(s: Simulacro): Promise<void> {
    await this.db.batch([
      this.db.prepare(SQL.insertarSimulacro).bind(s.id, s.usuario, s.curso, s.creadoEn, s.expiraEn),
      ...s.items.map((it) =>
        this.db
          .prepare(SQL.insertarItem)
          .bind(s.id, it.orden, it.preguntaId, it.firma, it.especialidad, it.tema, it.clave, it.nOpciones),
      ),
    ]);
  }

  async obtenerSimulacro(id: string, usuario: string): Promise<Simulacro | undefined> {
    const s = await this.db.prepare(SQL.simulacro).bind(id, usuario).first();
    if (!s) return undefined;
    const { results } = await this.db.prepare(SQL.itemsDeSimulacro).bind(id).all();
    return aSimulacro(s, results);
  }

  async guardarCorreccion(
    id: string,
    usuario: string,
    corregidoEn: string,
    items: { orden: number; respuesta: number | null; correcta: boolean }[],
  ): Promise<void> {
    const aciertos = items.filter((it) => it.correcta).length;
    const [marcado] = await this.db.batch([
      this.db.prepare(SQL.marcarCorregido).bind(corregidoEn, aciertos, id, usuario),
      ...items.map((it) =>
        this.db
          .prepare(SQL.actualizarItemDeCorreccion)
          .bind(it.respuesta, it.correcta ? 1 : 0, id, it.orden, id, corregidoEn),
      ),
    ]);
    if (marcado?.meta.changes !== 1) throw new Error('El simulacro ya fue corregido o no existe.');
  }

  async firmasVistas(usuario: string, curso: string): Promise<Set<string>> {
    const { results } = await this.db.prepare(SQL.firmasVistas).bind(usuario, curso).all();
    return new Set(results.map((f) => String(f.firma)));
  }

  async simulacrosCorregidos(usuario: string, curso?: string): Promise<ResumenSimulacro[]> {
    const { results } = await this.db
      .prepare(SQL.simulacrosCorregidos)
      .bind(usuario, curso ?? null, curso ?? null)
      .all();
    return results.map(aResumen);
  }

  async itemsRespondidos(usuario: string, curso?: string): Promise<ItemRespondido[]> {
    const { results } = await this.db
      .prepare(SQL.itemsRespondidos)
      .bind(usuario, curso ?? null, curso ?? null)
      .all();
    return results.map(aItemRespondido);
  }

  async preguntaCorregida(usuario: string, preguntaId: string): Promise<{ curso: string } | undefined> {
    const f = await this.db.prepare(SQL.preguntaCorregida).bind(usuario, preguntaId).first();
    return f ? { curso: String(f.curso) } : undefined;
  }

  async registrarLlamada(l: Llamada): Promise<void> {
    await this.db
      .prepare(SQL.registrarLlamada)
      .bind(l.usuario, l.herramienta, l.cantidad, l.en, l.resultado)
      .run();
  }

  async preguntasServidas(usuario: string, desde: string): Promise<number> {
    const f = await this.db.prepare(SQL.preguntasServidas).bind(usuario, desde).first();
    return Number(f?.total ?? 0);
  }

  async usoPorUsuario(desde: string): Promise<UsoUsuario[]> {
    const { results } = await this.db.prepare(SQL.usoPorUsuario).bind(desde).all();
    return results.map(aUso);
  }

  /** El binding de D1 no se cierra: lo administra el runtime de Workers */
  cerrar(): void {}
}
