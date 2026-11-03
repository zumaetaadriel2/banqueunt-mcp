import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { BaseD1, SentenciaD1 } from '../src/persistencia/d1.js';
import { ESQUEMA, ESQUEMA_REMOTO } from '../src/persistencia/sql.js';

/**
 * Imitación de un binding de Cloudflare D1 sobre node:sqlite (D1 también es SQLite), para probar
 * D1ProgresoRepo sin Cloudflare. Como D1, `batch` es una transacción: si una sentencia falla, no queda nada.
 */
export function d1EnMemoria(): BaseD1 & { db: DatabaseSync } {
  const db = new DatabaseSync(':memory:');
  db.exec('pragma foreign_keys = on;');
  db.exec(ESQUEMA + ESQUEMA_REMOTO);

  const sentencia = (sql: string, valores: SQLInputValue[] = []): SentenciaD1 => ({
    bind: (...nuevos) => sentencia(sql, nuevos as SQLInputValue[]),
    first: async <T>() => (db.prepare(sql).get(...valores) as T | undefined) ?? null,
    all: async <T>() => ({ results: db.prepare(sql).all(...valores) as T[] }),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...valores).changes) } }),
  });

  return {
    db,
    prepare: (sql) => sentencia(sql),
    async batch(sentencias) {
      db.exec('begin');
      try {
        const resultados = [];
        for (const s of sentencias) resultados.push(await s.run());
        db.exec('commit');
        return resultados;
      } catch (e) {
        db.exec('rollback');
        throw e;
      }
    },
  };
}
