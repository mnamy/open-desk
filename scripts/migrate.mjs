import fs from "node:fs"
import path from "node:path"
import postgres from "postgres"

const url = process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim()
if (!url) {
  console.error("Set DATABASE_URL or DIRECT_URL. No connection string was found.")
  process.exit(1)
}

const sql = postgres(url, {
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
