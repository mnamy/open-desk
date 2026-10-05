import type { PGlite } from "@electric-sql/pglite"
import postgres from "postgres"
import { forDriver } from "@/lib/db/postgres-url.mjs"

export interface Sql {
  query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }>
  exec(text: string): Promise<void>
  transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T>
}

type Queryable = {
  query: Sql["query"]
  exec: (text: string) => Promise<unknown>
}

export function asSql(db: Sql | Queryable | PGlite): Sql {
  if ("transaction" in db && typeof (db as Sql).transaction === "function") return db as Sql
  return wrapPglite(db as PGlite)
}

export function wrapPglite(db: PGlite): Sql {
  const sql: Sql = {
    query(text, params) {
      return db.query(text, params as never[])
    },
    async exec(text) {
      await db.exec(text)
    },
    async transaction(fn) {
      await db.exec("BEGIN")
      try {
        const result = await fn(sql)
        await db.exec("COMMIT")
        return result
      } catch (error) {
        await db.exec("ROLLBACK")
        throw error
      }
    },
  }
  return sql
}

type PostgresClient = ReturnType<typeof postgres>
type PostgresTx = postgres.TransactionSql

export function openPostgres(url: string): { db: Sql; close: () => Promise<void> } {
  const client = postgres(forDriver(url), {
    prepare: false,
    max: 1,
    ssl: "require",
    connect_timeout: 20,
    idle_timeout: 20,
  })
  return { db: bindPostgres(client), close: () => client.end({ timeout: 5 }) }
}

function bindPostgres(client: PostgresClient | PostgresTx): Sql {
  return {
    async query<T>(text: string, params: unknown[] = []) {
      const rows = await client.unsafe(text, params as never[])
      return { rows: [...rows] as T[] }
    },
    async exec(text) {
      await client.unsafe(text)
    },
    async transaction(fn) {
      if (!("begin" in client)) return fn(bindPostgres(client))
      const result = await client.begin(async (tx) => fn(bindPostgres(tx)))
      return result as Awaited<ReturnType<typeof fn>>
    },
  }
}
