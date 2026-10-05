import fs from "node:fs"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { importPostings } from "@/lib/db/repository"

const globalForDb = globalThis as unknown as { deskDb?: Promise<PGlite> }

export function getDb(): Promise<PGlite> {
  if (!globalForDb.deskDb) {
    globalForDb.deskDb = openDb()
  }
  return globalForDb.deskDb
}

async function openDb(): Promise<PGlite> {
  const dir = path.join(process.cwd(), ".data", "pglite")
  fs.mkdirSync(dir, { recursive: true })
  const db = new PGlite(dir)
  await applyMigration(db)
  const existing = await db.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM jobs")
  if (existing.rows[0]?.count === "0") {
    await importPostings(db, "seed")
  }
  return db
}

export async function applyMigration(db: PGlite): Promise<void> {
  const sql = fs.readFileSync(path.join(process.cwd(), "db/migrations/0001_init.sql"), "utf8")
  await db.exec(sql)
}
