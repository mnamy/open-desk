export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h1|h2|h3|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
}

export function unescapeHtml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
}

const ATS_PATTERNS: { provider: "greenhouse" | "ashby" | "lever"; re: RegExp }[] = [
  { provider: "greenhouse", re: /boards\.greenhouse\.io\/([a-z0-9_-]+)/i },
  { provider: "greenhouse", re: /job-boards\.greenhouse\.io\/([a-z0-9_-]+)/i },
  { provider: "greenhouse", re: /greenhouse\.io\/embed\/job_board\?for=([a-z0-9_-]+)/i },
  { provider: "greenhouse", re: /boards-api\.greenhouse\.io\/v1\/boards\/([a-z0-9_-]+)/i },
  { provider: "ashby", re: /jobs\.ashbyhq\.com\/([a-z0-9_-]+)/i },
  { provider: "ashby", re: /api\.ashbyhq\.com\/posting-api\/job-board\/([a-z0-9_-]+)/i },
  { provider: "lever", re: /jobs\.lever\.co\/([a-z0-9_-]+)/i },
  { provider: "lever", re: /api\.lever\.co\/v0\/postings\/([a-z0-9_-]+)/i },
]

const ATS_TOKEN_BLOCKLIST = new Set(["embed", "jobs", "job_board", "v0", "v1", "boards", "postings", "posting-api"])

export function detectAts(htmlOrUrl: string): { provider: "greenhouse" | "ashby" | "lever"; identifier: string } | null {
  for (const pattern of ATS_PATTERNS) {
    const match = htmlOrUrl.match(pattern.re)
    const identifier = match?.[1]?.toLowerCase()
    if (!identifier || ATS_TOKEN_BLOCKLIST.has(identifier)) continue
    return { provider: pattern.provider, identifier }
  }
  return null
}

export interface JsonLdJob {
  title: string
  description: string
  url: string | null
  location: string
  datePosted: string | null
  employmentType: string | null
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  return value ? [value] : []
}

function locality(location: unknown): string {
  const places = asArray(location)
  const parts: string[] = []
  for (const place of places) {
    if (!place || typeof place !== "object") continue
    const record = place as { address?: { addressLocality?: string; addressRegion?: string }; name?: string }
    const city = record.address?.addressLocality
    const region = record.address?.addressRegion
    if (city && region) parts.push(`${city}, ${region}`)
    else if (city) parts.push(city)
    else if (typeof record.name === "string") parts.push(record.name)
  }
  return parts.join(" · ")
}

function readJobPosting(node: Record<string, unknown>, pageUrl: string): JsonLdJob | null {
  const type = node["@type"]
  const types = asArray(type).map((item) => String(item).toLowerCase())
  if (!types.includes("jobposting")) return null
  const title = typeof node.title === "string" ? node.title.trim() : ""
  if (!title) return null
  const description = typeof node.description === "string" ? htmlToText(node.description) : ""
  const url = typeof node.url === "string" ? node.url : null
  return {
    title,
    description,
    url: url ? new URL(url, pageUrl).toString() : null,
    location: locality(node.jobLocation),
    datePosted: typeof node.datePosted === "string" ? node.datePosted : null,
    employmentType: typeof node.employmentType === "string" ? node.employmentType : null,
  }
}

export function readJsonLdJobs(html: string, pageUrl: string): JsonLdJob[] {
  const blocks = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
  const jobs: JsonLdJob[] = []
  for (const block of blocks) {
    let parsed: unknown
    try {
      parsed = JSON.parse(block[1])
    } catch {
      continue
    }
    const nodes = asArray(parsed).flatMap((node) => {
      if (!node || typeof node !== "object") return []
      const record = node as { "@graph"?: unknown }
      return record["@graph"] ? asArray(record["@graph"]) : [node]
    })
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue
      const job = readJobPosting(node as Record<string, unknown>, pageUrl)
      if (job) jobs.push(job)
    }
  }
  return jobs
}

export function readInertiaProps(html: string): Record<string, unknown> | null {
  const match = html.match(/data-page="([^"]+)"/)
  if (!match) return null
  try {
    const page = JSON.parse(unescapeHtml(match[1])) as { props?: Record<string, unknown> }
    return page.props ?? null
  } catch {
    return null
  }
}
