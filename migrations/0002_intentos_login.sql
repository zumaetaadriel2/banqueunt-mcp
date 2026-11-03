-- Logins fallidos en /authorize (solo en D1). Debe coincidir con ESQUEMA_REMOTO de src/persistencia/sql.ts.
create table if not exists intentos_login (
  id     integer primary key,
  clave  text not null,
  en     text not null
);
create index if not exists intentos_login_clave on intentos_login (clave, en);
