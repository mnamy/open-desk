import { descriptionSimilarity, normalizeCompanyName, normalizeTitle, normalizeUrl } from "@/lib/jobs/text"

const SIMILARITY = 0.5

export interface StoredIdentity {
  id: string
  fingerprint: string
  company: string
  title: string
  city: string
  description: string
  urls: string[]
  atsKeys: string[]
  firstSeenAt: string
  firstSurfacedAt: string | null
  actions: string[]
}

export interface IncomingIdentity {
  fingerprint: string
  company: string
  title: string
  city: string | null
  description: string
  urls: string[]
  atsKeys: string[]
}

function prefer(hits: StoredIdentity[]): StoredIdentity | null {
  if (hits.length === 0) return null
  const rank = (row: StoredIdentity) => {
    if (row.actions.includes("not_interested")) return 0
    if (row.actions.includes("save") || row.actions.includes("applied")) return 1
    return 2
  }
  return [...hits].sort((a, b) => rank(a) - rank(b) || a.firstSeenAt.localeCompare(b.firstSeenAt) || a.id.localeCompare(b.id))[0]
}

function atsHit(incoming: IncomingIdentity, stored: StoredIdentity[]): StoredIdentity[] {
  const keys = new Set(incoming.atsKeys.filter(Boolean))
  if (keys.size === 0) return []
  return stored.filter((row) => row.atsKeys.some((key) => keys.has(key)))
}

function urlHit(incoming: IncomingIdentity, stored: StoredIdentity[]): StoredIdentity[] {
  const urls = new Set(incoming.urls.map((url) => normalizeUrl(url)).filter(Boolean))
  if (urls.size === 0) return []
  return stored.filter((row) => row.urls.some((url) => urls.has(normalizeUrl(url))))
}

function roleHit(incoming: IncomingIdentity, stored: StoredIdentity[]): StoredIdentity[] {
  const company = normalizeCompanyName(incoming.company)
  const title = normalizeTitle(incoming.title)
  const city = incoming.city ?? ""
  return stored.filter(
    (row) =>
      row.company === company &&
      row.title === title &&
      row.city === city &&
      descriptionSimilarity(row.description, incoming.description) >= SIMILARITY,
  )
}

/** Match a live posting to a job already stored. ATS id, then canonical URL, then role fingerprint. */
export function matchStoredJob(incoming: IncomingIdentity, stored: StoredIdentity[]): StoredIdentity | null {
  const byAts = prefer(atsHit(incoming, stored))
  if (byAts) return byAts
  const byUrl = prefer(urlHit(incoming, stored))
  if (byUrl) return byUrl
  const byFingerprint = prefer(stored.filter((row) => row.fingerprint === incoming.fingerprint))
  if (byFingerprint) return byFingerprint
  return prefer(roleHit(incoming, stored))
}

export function atsKey(provider: string | null | undefined, externalId: string | null | undefined): string | null {
  if (!provider || !externalId) return null
  return `${provider.toLowerCase()}:${externalId}`
}
