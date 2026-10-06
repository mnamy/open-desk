const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "to",
  "of",
  "in",
  "for",
  "with",
  "on",
  "at",
  "by",
  "from",
  "our",
  "you",
  "your",
  "we",
  "will",
  "this",
  "that",
  "is",
  "are",
  "as",
  "be",
  "it",
  "its",
])

export function plainText(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#?\w+;/g, " ")
    .replace(/[*_#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(incorporated|inc|llc|l\.l\.c|corp|corporation|ltd|co)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9+]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
}

export function tokens(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word))
  return new Set(words)
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  let intersection = 0
  for (const token of a) {
    if (b.has(token)) intersection += 1
  }
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

export function descriptionSimilarity(a: string, b: string): number {
  return jaccard(tokens(a), tokens(b))
}

const TRACKING_PARAM = /^(utm_|mc_|fbclid$|gclid$|ref$|trk$|source$|gh_src$|gh_jid$|lever-source$|lever-origin$|_ga$)/i

export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ""
    parsed.hostname = parsed.hostname.toLowerCase()
    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAM.test(key)) parsed.searchParams.delete(key)
    }
    const next = new URLSearchParams()
    for (const key of [...parsed.searchParams.keys()].sort()) {
      for (const value of parsed.searchParams.getAll(key)) next.append(key, value)
    }
    parsed.search = next.toString()
    return parsed.toString().replace(/\/$/, "")
  } catch {
    return url.trim().toLowerCase()
  }
}
