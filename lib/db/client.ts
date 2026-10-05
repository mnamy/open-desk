import fs from "node:fs"
import path from "node:path"
import { importPostings } from "@/lib/db/repository"
import { databaseUrl, migrationUrl } from "@/lib/db/postgres-url.mjs"
import { asSql, openPostgres, wrapPglite, type Sql } from "@/lib/db/sql"

const globalForDb = globalThis as unknown as { deskDb?: Promise<Sql> }

export { databaseUrl, migrationUrl }

export function getDb(): Promise<Sql> {
  if (!globalForDb.deskDb) {
    globalForDb.deskDb = openDb().catch((error: unknown) => {
      globalForDb.deskDb = undefined
      throw error
    })
  }
  return globalForDb.deskDb
}

async function openDb(): Promise<Sql> {
  const runtime = databaseUrl()
  if (runtime) return openHosted(runtime)
  return openPglite()
}

async function openHosted(runtime: string): Promise<Sql> {
  const migrateUrl = migrationUrl() || runtime
  const migrator = openPostgres(migrateUrl)
  try {
    await applyMigration(migrator.db)
  } finally {
    await migrator.close()
  }
  const db = openPostgres(runtime).db
  await seedIfEmpty(db)
  return db
}

async function openPglite(): Promise<Sql> {
  if (process.env.VERCEL) {
    throw new Error("This deployment has no Neon connection string. Connect the Neon integration in Vercel so DATABASE_URL is set, then redeploy.")
  }
  const { PGlite } = await import("@electric-sql/pglite")
  const dir = path.join(process.cwd(), ".data", "pglite")
  fs.mkdirSync(dir, { recursive: true })
  const db = wrapPglite(new PGlite(dir))
  await applyMigration(db)
  await seedIfEmpty(db)
  return db
}

async function seedIfEmpty(db: Sql): Promise<void> {
  const existing = await db.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM jobs")
  if (existing.rows[0]?.count === "0") await importPostings(db, "seed")
}

export async function applyMigration(db: { exec(sql: string): Promise<unknown> }): Promise<void> {
  const dir = path.join(process.cwd(), "db/migrations")
  const files = fs.readdirSync(dir).filter((file) => file.endsWith(".sql")).sort()
  for (const file of files) {
    await db.exec(fs.readFileSync(path.join(dir, file), "utf8"))
  }
}

export { asSql }
