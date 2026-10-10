import dns from "node:dns"
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

const marked = new WeakSet<object>()

function mark(sql: Sql): Sql {
  marked.add(sql)
  return sql
}

export function asSql(db: Sql | Queryable | PGlite): Sql {
  if (typeof db === "object" && db && marked.has(db)) return db as Sql
  if ("transaction" in db && typeof db.transaction === "function") return mark(wrapNative(db as PGlite))
  return mark(wrapPglite(db as PGlite))
}

function wrapNative(db: PGlite): Sql {
  return {
    query(text, params) {
      return db.query(text, sqlParams(params) as never[])
    },
    async exec(text) {
      await db.exec(text)
    },
    transaction(fn) {
      return db.transaction((tx) => fn(wrapNative(tx as unknown as PGlite)))
    },
  }
}

/** Postgres rejects NUL bytes, lone surrogates, and undefined parameters. */
export function sqlParams(params: unknown[] = []): unknown[] {
  return params.map(sqlParam)
}

function sqlParam(value: unknown): unknown {
  if (value === undefined) return null
  if (typeof value === "string") return value.replace(/\u0000/g, "").replace(/[\uD800-\uDFFF]/g, "")
  if (Array.isArray(value)) return value.map(sqlParam)
  return value
}

export function wrapPglite(db: PGlite): Sql {
  const sql: Sql = {
    query(text, params) {
      return db.query(text, sqlParams(params) as never[])
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
  return mark(sql)
}

type PostgresClient = ReturnType<typeof postgres>
type PostgresTx = postgres.TransactionSql

export function openPostgres(url: string): { db: Sql; close: () => Promise<void> } {
  dns.setDefaultResultOrder("ipv4first")
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
  return mark({
    async query<T>(text: string, params: unknown[] = []) {
      const rows = await client.unsafe(text, sqlParams(params) as never[])
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
  })
}
