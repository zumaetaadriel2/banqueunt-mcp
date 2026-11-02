import type { ItemRespondido, ResumenSimulacro, Simulacro, UsoUsuario } from './repo.js';

/**
 * Esquema y consultas que comparten SQLite (local) y Cloudflare D1 (remoto), que también es SQLite.
 * migrations/0001_inicial.sql tiene que coincidir con ESQUEMA (lo comprueba tests/persistencia.test.ts).
 */
export const ESQUEMA = `
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

create table if not exists llamadas (
  id           integer primary key,
  usuario      text not null,
  herramienta  text not null,
  cantidad     integer not null,
  en           text not null,
  resultado    text not null
);
create index if not exists llamadas_usuario on llamadas (usuario, en);
`;

export const SQL = {
  insertarSimulacro:
    'insert into simulacros (id, usuario, curso, creado_en, expira_en) values (?, ?, ?, ?, ?)',
  insertarItem: `insert into simulacro_items
       (simulacro_id, orden, pregunta_id, firma, especialidad, tema, clave, n_opciones)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
  simulacro: 'select * from simulacros where id = ? and usuario = ?',
  itemsDeSimulacro: 'select * from simulacro_items where simulacro_id = ? order by orden',
  // La condición «corregido_en is null» impide corregir dos veces aunque lleguen dos llamadas a la vez
  marcarCorregido:
    'update simulacros set corregido_en = ?, aciertos = ? where id = ? and usuario = ? and corregido_en is null',
  actualizarItem:
    'update simulacro_items set respuesta = ?, correcta = ? where simulacro_id = ? and orden = ?',
  // D1 no permite abortar a mitad de un batch: cada ítem solo se escribe si esta corrección (su corregido_en)
  // fue la que marcó el simulacro, así una segunda corrección simultánea no pisa la primera.
  actualizarItemDeCorreccion: `update simulacro_items set respuesta = ?, correcta = ?
      where simulacro_id = ? and orden = ?
        and exists (select 1 from simulacros where id = ? and corregido_en = ?)`,
  firmasVistas: `select distinct i.firma from simulacro_items i
       join simulacros s on s.id = i.simulacro_id
      where s.usuario = ? and s.curso = ?`,
  simulacrosCorregidos: `select s.id, s.curso, s.creado_en, s.corregido_en, s.aciertos,
            (select count(*) from simulacro_items i where i.simulacro_id = s.id) as total
       from simulacros s
      where s.usuario = ? and s.corregido_en is not null and (? is null or s.curso = ?)
      order by s.corregido_en desc`,
  itemsRespondidos: `select s.id as simulacro_id, s.curso, s.corregido_en, i.pregunta_id, i.especialidad, i.tema, i.correcta
       from simulacro_items i
       join simulacros s on s.id = i.simulacro_id
      where s.usuario = ? and s.corregido_en is not null and (? is null or s.curso = ?)
      order by s.corregido_en desc, i.orden`,
  preguntaCorregida: `select s.curso from simulacro_items i
       join simulacros s on s.id = i.simulacro_id
      where s.usuario = ? and i.pregunta_id = ? and s.corregido_en is not null
      limit 1`,
  registrarLlamada:
    'insert into llamadas (usuario, herramienta, cantidad, en, resultado) values (?, ?, ?, ?, ?)',
  preguntasServidas: `select coalesce(sum(cantidad), 0) as total from llamadas
      where usuario = ? and en >= ? and resultado = 'ok'`,
  usoPorUsuario: `select usuario, count(*) as llamadas,
            coalesce(sum(case when resultado = 'ok' then cantidad end), 0) as preguntas,
            sum(resultado = 'limite') as rechazadas
       from llamadas
      where en >= ?
      group by usuario
      order by preguntas desc, llamadas desc`,
} as const;

export type Fila = Record<string, unknown>;

export function aSimulacro(s: Fila, items: Fila[]): Simulacro {
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
      correcta: it.correcta === null ? null : Number(it.correcta) === 1,
    })),
  };
}

export const aResumen = (f: Fila): ResumenSimulacro => ({
  id: String(f.id),
  curso: String(f.curso),
  creadoEn: String(f.creado_en),
  corregidoEn: String(f.corregido_en),
  aciertos: Number(f.aciertos),
  total: Number(f.total),
});

export const aItemRespondido = (f: Fila): ItemRespondido => ({
  simulacroId: String(f.simulacro_id),
  curso: String(f.curso),
  corregidoEn: String(f.corregido_en),
  preguntaId: String(f.pregunta_id),
  especialidad: String(f.especialidad),
  tema: String(f.tema),
  correcta: Number(f.correcta) === 1,
});

export const aUso = (f: Fila): UsoUsuario => ({
  usuario: String(f.usuario),
  llamadas: Number(f.llamadas),
  preguntas: Number(f.preguntas),
  rechazadas: Number(f.rechazadas),
});
