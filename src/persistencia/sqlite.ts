import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  ItemRespondido,
  Llamada,
  ProgresoRepo,
  ResumenSimulacro,
  Simulacro,
  UsoUsuario,
} from './repo.js';
import { aItemRespondido, aResumen, aSimulacro, aUso, ESQUEMA, SQL, type Fila } from './sql.js';

/** %LOCALAPPDATA%\banqueunt-mcp\progreso.db en Windows; ~/.local/share/banqueunt-mcp en el resto. */
export function rutaPorDefecto(): string {
  const base =
    process.platform === 'win32'
      ? (process.env.LOCALAPPDATA ?? path.join(homedir(), 'AppData', 'Local'))
      : (process.env.XDG_DATA_HOME ?? path.join(homedir(), '.local', 'share'));
  return path.join(base, 'banqueunt-mcp', 'progreso.db');
}

export class SqliteProgresoRepo implements ProgresoRepo {
  private readonly db: DatabaseSync;

  /** `ruta` = ':memory:' para los tests */
  constructor(ruta: string = rutaPorDefecto()) {
    if (ruta !== ':memory:') mkdirSync(path.dirname(ruta), { recursive: true });
    this.db = new DatabaseSync(ruta);
    this.db.exec('pragma foreign_keys = on; pragma journal_mode = wal;');
    this.db.exec(ESQUEMA);
  }

  async crearSimulacro(s: Simulacro): Promise<void> {
    const insertarItem = this.db.prepare(SQL.insertarItem);
    this.transaccion(() => {
      this.db.prepare(SQL.insertarSimulacro).run(s.id, s.usuario, s.curso, s.creadoEn, s.expiraEn);
      for (const it of s.items) {
        insertarItem.run(
          s.id,
          it.orden,
          it.preguntaId,
          it.firma,
          it.especialidad,
          it.tema,
          it.clave,
          it.nOpciones,
        );
      }
    });
  }

  async obtenerSimulacro(id: string, usuario: string): Promise<Simulacro | undefined> {
    const s = this.db.prepare(SQL.simulacro).get(id, usuario) as Fila | undefined;
    if (!s) return undefined;
    return aSimulacro(s, this.db.prepare(SQL.itemsDeSimulacro).all(id) as Fila[]);
  }

  async guardarCorreccion(
    id: string,
    usuario: string,
    corregidoEn: string,
    items: { orden: number; respuesta: number | null; correcta: boolean }[],
  ): Promise<void> {
    const actualizarItem = this.db.prepare(SQL.actualizarItem);
    this.transaccion(() => {
      const r = this.db
        .prepare(SQL.marcarCorregido)
        .run(corregidoEn, items.filter((it) => it.correcta).length, id, usuario);
      if (Number(r.changes) !== 1) throw new Error('El simulacro ya fue corregido o no existe.');
      for (const it of items) actualizarItem.run(it.respuesta, it.correcta ? 1 : 0, id, it.orden);
    });
  }

  async firmasVistas(usuario: string, curso: string): Promise<Set<string>> {
    const filas = this.db.prepare(SQL.firmasVistas).all(usuario, curso) as Fila[];
    return new Set(filas.map((f) => String(f.firma)));
  }

  async simulacrosCorregidos(usuario: string, curso?: string): Promise<ResumenSimulacro[]> {
    const filas = this.db.prepare(SQL.simulacrosCorregidos).all(usuario, curso ?? null, curso ?? null);
    return (filas as Fila[]).map(aResumen);
  }

  async itemsRespondidos(usuario: string, curso?: string): Promise<ItemRespondido[]> {
    const filas = this.db.prepare(SQL.itemsRespondidos).all(usuario, curso ?? null, curso ?? null);
    return (filas as Fila[]).map(aItemRespondido);
  }

  async preguntaCorregida(usuario: string, preguntaId: string): Promise<{ curso: string } | undefined> {
    const f = this.db.prepare(SQL.preguntaCorregida).get(usuario, preguntaId) as Fila | undefined;
    return f ? { curso: String(f.curso) } : undefined;
  }

  async registrarLlamada(l: Llamada): Promise<void> {
    this.db.prepare(SQL.registrarLlamada).run(l.usuario, l.herramienta, l.cantidad, l.en, l.resultado);
  }

  async preguntasServidas(usuario: string, desde: string): Promise<number> {
    const f = this.db.prepare(SQL.preguntasServidas).get(usuario, desde) as Fila;
    return Number(f.total);
  }

  async usoPorUsuario(desde: string): Promise<UsoUsuario[]> {
    return (this.db.prepare(SQL.usoPorUsuario).all(desde) as Fila[]).map(aUso);
  }

  cerrar(): void {
    this.db.close();
  }

  private transaccion(fn: () => void): void {
    this.db.exec('begin');
    try {
      fn();
      this.db.exec('commit');
    } catch (e) {
      this.db.exec('rollback');
      throw e;
    }
  }
}
