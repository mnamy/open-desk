import fs from "node:fs"
import path from "node:path"
import postgres from "postgres"
import { forDriver, migrationUrl } from "../lib/db/postgres-url.mjs"

const url = migrationUrl()
if (!url) {
  console.error("No Neon connection string was found. Expected DATABASE_URL_UNPOOLED or DATABASE_URL from the Vercel Neon integration.")
  process.exit(1)
}

const sql = postgres(forDriver(url), {
  prepare: false,
  max: 1,
  ssl: "require",
  connect_timeout: 20,
})

try {
  const dir = path.join(process.cwd(), "db/migrations")
  const files = fs.readdirSync(dir).filter((file) => file.endsWith(".sql")).sort()
  for (const file of files) {
    await sql.unsafe(fs.readFileSync(path.join(dir, file), "utf8"))
  }
  console.log(`Applied ${files.length} migration files.`)
} catch (error) {
  const message = error instanceof Error ? error.message : "migration failed"
  console.error(message.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]"))
  process.exit(1)
} finally {
  await sql.end({ timeout: 5 })
}
