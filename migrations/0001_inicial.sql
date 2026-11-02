-- Esquema inicial de D1 (wrangler d1 migrations apply). Debe coincidir con ESQUEMA de src/persistencia/sql.ts.
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
