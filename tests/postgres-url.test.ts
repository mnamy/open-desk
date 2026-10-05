import { afterEach, describe, expect, it } from "vitest"
import { databaseUrl, forDriver, migrationUrl, sanitizeDbError } from "@/lib/db/postgres-url.mjs"

const NAMES = ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "POSTGRES_URL", "POSTGRES_URL_NON_POOLING"] as const

afterEach(() => {
  for (const name of NAMES) delete process.env[name]
})

describe("Neon connection selection", () => {
  it("stays unset when the Vercel Neon variables are absent", () => {
    for (const name of NAMES) delete process.env[name]
    expect(databaseUrl()).toBeUndefined()
    expect(migrationUrl()).toBeUndefined()
  })

  it("uses the pooled URL for the app and the direct URL for migrations", () => {
    process.env.DATABASE_URL = "postgres://pooled.example/db"
    process.env.DATABASE_URL_UNPOOLED = "postgres://direct.example/db"
    expect(databaseUrl()).toBe("postgres://pooled.example/db")
    expect(migrationUrl()).toBe("postgres://direct.example/db")
  })

  it("accepts the legacy Vercel Postgres names", () => {
    process.env.POSTGRES_URL = "postgres://legacy-pooled.example/db"
    process.env.POSTGRES_URL_NON_POOLING = "postgres://legacy-direct.example/db"
    expect(databaseUrl()).toBe("postgres://legacy-pooled.example/db")
    expect(migrationUrl()).toBe("postgres://legacy-direct.example/db")
  })

  it("falls back to the direct URL when that is the only variable set", () => {
    process.env.DATABASE_URL_UNPOOLED = "postgres://direct-only.example/db"
    expect(databaseUrl()).toBe("postgres://direct-only.example/db")
    expect(migrationUrl()).toBe("postgres://direct-only.example/db")
  })

  it("drops the client-only channel_binding parameter before connecting", () => {
    expect(forDriver("postgres://db.example/desk?sslmode=require&channel_binding=require")).toBe(
      "postgres://db.example/desk?sslmode=require",
    )
  })

  it("names a missing Neon variable on Vercel without repeating a connection string", () => {
    process.env.VERCEL = "1"
    const message = sanitizeDbError(new Error("connect ECONNREFUSED postgres://user:secret@ep.neon.tech/db"))
    expect(message).toContain("DATABASE_URL")
    expect(message).not.toContain("secret")
    delete process.env.VERCEL
  })

  it("redacts a connection string from a driver error", () => {
    process.env.DATABASE_URL = "postgres://pooled.example/db"
    const message = sanitizeDbError(new Error("unrecognized configuration parameter postgres://user:secret@ep.neon.tech/db"))
    expect(message).not.toContain("secret")
    expect(message).toContain("unrecognized configuration parameter")
  })
})
