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
