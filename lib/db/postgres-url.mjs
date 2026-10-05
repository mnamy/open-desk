function read(name) {
  const value = process.env[name]
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

export function databaseUrl() {
  return read("DATABASE_URL") || read("POSTGRES_URL") || read("DATABASE_URL_UNPOOLED") || read("POSTGRES_URL_NON_POOLING")
}

export function migrationUrl() {
  return read("DATABASE_URL_UNPOOLED") || read("POSTGRES_URL_NON_POOLING") || databaseUrl()
}

export function forDriver(url) {
  const [base, query] = url.split("?")
  if (!query) return url
  const kept = query.split("&").filter((part) => part && !part.startsWith("channel_binding="))
  return kept.length ? `${base}?${kept.join("&")}` : base
}

export function sanitizeDbError(error) {
  if (!databaseUrl() && process.env.VERCEL) {
    return "This deployment has no Neon connection string. Connect the Neon integration in Vercel so DATABASE_URL is set, then redeploy."
  }
  const raw = error instanceof Error ? error.message : "The database connection failed."
  return raw.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]").replace(/\s+/g, " ").slice(0, 240)
}
