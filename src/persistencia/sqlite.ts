import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ItemRespondido, ProgresoRepo, ResumenSimulacro, Simulacro } from './repo.js';

const ESQUEMA = `
create table if not exists simulacros (
  id            text primary key,
  usuario       text not null,
  curso         text not null,
  creado_en     text not null,
  expira_en     text not null,
  corregido_en  text,
  aciertos      integer
);
create index if not exists simulacros_usuario on simulacros (usuario, curso, creado_en);

create table if not exists simulacro_items (
  simulacro_id  text not null references simulacros (id) on delete cascade,
  orden         integer not null,
  pregunta_id   text not null,
  firma         text not null,
  especialidad  text not null,
  tema          text not null,
  clave         integer not null,
  n_opciones    integer not null,
  respuesta     integer,
  correcta      integer,
  primary key (simulacro_id, orden)
);
create index if not exists items_pregunta on simulacro_items (pregunta_id);
`;

/** %LOCALAPPDATA%\banqueunt-mcp\progreso.db en Windows; ~/.local/share/banqueunt-mcp en el resto. */
export function rutaPorDefecto(): string {
  const base =
    process.platform === 'win32'
      ? (process.env.LOCALAPPDATA ?? path.join(homedir(), 'AppData', 'Local'))
      : (process.env.XDG_DATA_HOME ?? path.join(homedir(), '.local', 'share'));
  return path.join(base, 'banqueunt-mcp', 'progreso.db');
}

type Fila = Record<string, string | number | null>;

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
    const insertarItem = this.db.prepare(
      `insert into simulacro_items
         (simulacro_id, orden, pregunta_id, firma, especialidad, tema, clave, n_opciones)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.transaccion(() => {
      this.db
        .prepare(`insert into simulacros (id, usuario, curso, creado_en, expira_en) values (?, ?, ?, ?, ?)`)
        .run(s.id, s.usuario, s.curso, s.creadoEn, s.expiraEn);
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
    const s = this.db.prepare('select * from simulacros where id = ? and usuario = ?').get(id, usuario) as
      Fila | undefined;
    if (!s) return undefined;
    const items = this.db
      .prepare('select * from simulacro_items where simulacro_id = ? order by orden')
      .all(id) as Fila[];
    return {
      id: String(s.id),
      usuario: String(s.usuario),
      curso: String(s.curso),
      creadoEn: String(s.creado_en),
      expiraEn: String(s.expira_en),
      corregidoEn: s.corregido_en === null ? null : String(s.corregido_en),
      aciertos: s.aciertos === null ? null : Number(s.aciertos),
      items: items.map((it) => ({
        orden: Number(it.orden),
        preguntaId: String(it.pregunta_id),
        firma: String(it.firma),
        especialidad: String(it.especialidad),
        tema: String(it.tema),
        clave: Number(it.clave),
        nOpciones: Number(it.n_opciones),
        respuesta: it.respuesta === null ? null : Number(it.respuesta),
        correcta: it.correcta === null ? null : it.correcta === 1,
      })),
    };
  }

  async guardarCorreccion(
    id: string,
    usuario: string,
    corregidoEn: string,
    items: { orden: number; respuesta: number | null; correcta: boolean }[],
  ): Promise<void> {
    const actualizarItem = this.db.prepare(
      'update simulacro_items set respuesta = ?, correcta = ? where simulacro_id = ? and orden = ?',
    );
    this.transaccion(() => {
      // La condición «corregido_en is null» impide corregir dos veces aunque lleguen dos llamadas a la vez
      const r = this.db
        .prepare(
          'update simulacros set corregido_en = ?, aciertos = ? where id = ? and usuario = ? and corregido_en is null',
        )
        .run(corregidoEn, items.filter((it) => it.correcta).length, id, usuario);
      if (Number(r.changes) !== 1) throw new Error('El simulacro ya fue corregido o no existe.');
      for (const it of items) actualizarItem.run(it.respuesta, it.correcta ? 1 : 0, id, it.orden);
    });
  }

  async firmasVistas(usuario: string, curso: string): Promise<Set<string>> {
    const filas = this.db
      .prepare(
        `select distinct i.firma from simulacro_items i
           join simulacros s on s.id = i.simulacro_id
          where s.usuario = ? and s.curso = ?`,
      )
      .all(usuario, curso) as Fila[];
    return new Set(filas.map((f) => String(f.firma)));
  }

  async simulacrosCorregidos(usuario: string, curso?: string): Promise<ResumenSimulacro[]> {
    const filas = this.db
      .prepare(
        `select s.id, s.curso, s.creado_en, s.corregido_en, s.aciertos,
                (select count(*) from simulacro_items i where i.simulacro_id = s.id) as total
           from simulacros s
          where s.usuario = ? and s.corregido_en is not null and (? is null or s.curso = ?)
          order by s.corregido_en desc`,
      )
      .all(usuario, curso ?? null, curso ?? null) as Fila[];
    return filas.map((f) => ({
      id: String(f.id),
      curso: String(f.curso),
      creadoEn: String(f.creado_en),
      corregidoEn: String(f.corregido_en),
      aciertos: Number(f.aciertos),
      total: Number(f.total),
    }));
  }

  async itemsRespondidos(usuario: string, curso?: string): Promise<ItemRespondido[]> {
    const filas = this.db
      .prepare(
        `select s.id as simulacro_id, s.curso, i.pregunta_id, i.especialidad, i.tema, i.correcta
           from simulacro_items i
           join simulacros s on s.id = i.simulacro_id
          where s.usuario = ? and s.corregido_en is not null and (? is null or s.curso = ?)`,
      )
      .all(usuario, curso ?? null, curso ?? null) as Fila[];
    return filas.map((f) => ({
      simulacroId: String(f.simulacro_id),
      curso: String(f.curso),
      preguntaId: String(f.pregunta_id),
      especialidad: String(f.especialidad),
      tema: String(f.tema),
      correcta: f.correcta === 1,
    }));
  }

  async preguntaCorregida(usuario: string, preguntaId: string): Promise<{ curso: string } | undefined> {
    const f = this.db
      .prepare(
        `select s.curso from simulacro_items i
           join simulacros s on s.id = i.simulacro_id
          where s.usuario = ? and i.pregunta_id = ? and s.corregido_en is not null
          limit 1`,
      )
      .get(usuario, preguntaId) as Fila | undefined;
    return f ? { curso: String(f.curso) } : undefined;
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
