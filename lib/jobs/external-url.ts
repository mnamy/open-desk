import { greenhouseJobsToPostings, type GreenhouseJob } from "@/lib/sources/greenhouse"
import { ashbyJobsToPostings, type AshbyJob } from "@/lib/sources/ashby"
import { leverJobsToPostings, type LeverJob } from "@/lib/sources/lever"
import { htmlToText, readJsonLdJobs } from "@/lib/sources/html"
import type { HttpClient } from "@/lib/sources/http"
import type { RawPosting, SourceId } from "@/lib/sources/types"

export interface ManualJobDraft {
  url: string
  title: string
  company: string
  location: string
  description: string
  arrangement: string
  source: SourceId
}

export interface ExternalPreview {
  title: string
  company: string
  location: string
  source: string
}

export type ExternalDraft =
  | { status: "ready"; posting: RawPosting; preview: ExternalPreview }
  | { status: "manual"; draft: ManualJobDraft }

const GREENHOUSE_JOB =
  /(?:(?:boards|job-boards)\.greenhouse\.io\/([a-z0-9_-]+)\/jobs\/(\d+)|boards-api\.greenhouse\.io\/v1\/boards\/([a-z0-9_-]+)\/jobs\/(\d+))/i
const ASHBY_JOB = /jobs\.ashbyhq\.com\/([a-z0-9_-]+)\/([^/?#]+)/i
const LEVER_JOB = /jobs\.lever\.co\/([a-z0-9_-]+)\/([^/?#]+)/i

export function parseJobUrl(value: string): URL | null {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    if (!url.hostname.includes(".")) return null
    return url
  } catch {
    return null
  }
}

function sourceFor(url: URL): SourceId {
  const host = url.hostname.toLowerCase()
  if (host.includes("greenhouse.io")) return "greenhouse"
  if (host.includes("ashbyhq.com")) return "ashby"
  if (host.includes("lever.co")) return "lever"
  if (host.includes("linkedin.com")) return "linkedin"
  if (host.includes("wellfound.com") || host.includes("angel.co")) return "wellfound"
  if (host.includes("welcometothejungle.com")) return "welcome_to_the_jungle"
  return "career_page"
}

function labelFromSlug(slug: string): string {
  return slug
    .replace(/[-_]+/g, " ")
    .replace(/\b[a-z]/g, (char) => char.toUpperCase())
}

function blankDraft(url: string, source: SourceId, partial?: Partial<ManualJobDraft>): ManualJobDraft {
  return {
    url,
    title: partial?.title?.trim() ?? "",
    company: partial?.company?.trim() ?? "",
    location: partial?.location?.trim() ?? "",
    description: partial?.description?.trim() ?? "",
    arrangement: partial?.arrangement?.trim() || "Unclear",
    source,
  }
}

function asExternal(posting: RawPosting, pageUrl: string): RawPosting {
  return {
    ...posting,
    discoveredFrom: "external_user",
    sourceUrl: posting.sourceUrl || pageUrl,
    applicationUrl: posting.applicationUrl || pageUrl,
    release: "search",
  }
}

function readyEnough(posting: RawPosting): boolean {
  return (
    posting.title.trim().length > 1 &&
    posting.companyName.trim().length > 1 &&
    posting.description.trim().length >= 40 &&
    posting.locationRaw.trim().length > 1
  )
}

function finish(posting: RawPosting, fallback: ManualJobDraft): ExternalDraft {
  if (!readyEnough(posting)) {
    return {
      status: "manual",
      draft: blankDraft(fallback.url, fallback.source, {
        title: posting.title || fallback.title,
        company: posting.companyName || fallback.company,
        location: posting.locationRaw || fallback.location,
        description: posting.description || fallback.description,
        arrangement: posting.arrangementRaw || fallback.arrangement,
        source: posting.source,
      }),
    }
  }
  return {
    status: "ready",
    posting,
    preview: {
      title: posting.title,
      company: posting.companyName,
      location: posting.locationRaw,
      source: posting.source,
    },
  }
}

async function greenhouseName(client: HttpClient, board: string): Promise<string> {
  try {
    const payload = await client.getJson<{ name?: string }>(`https://boards-api.greenhouse.io/v1/boards/${board}`)
    if (payload.name?.trim()) return payload.name.trim()
  } catch {
    // The job payload can still be useful with the board slug as a stand-in name.
  }
  return labelFromSlug(board)
}

async function readGreenhouse(url: URL, client: HttpClient, now: Date): Promise<RawPosting | null> {
  const match = url.toString().match(GREENHOUSE_JOB)
  if (!match) return null
  const board = (match[1] || match[3]).toLowerCase()
  const jobId = match[2] || match[4]
  const companyName = await greenhouseName(client, board)
  const company = { name: companyName, atsIdentifier: board }
  try {
    const job = await client.getJson<GreenhouseJob>(
      `https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${jobId}?content=true`,
    )
    const [posting] = greenhouseJobsToPostings([job], company, now)
    if (posting) return asExternal(posting, url.toString())
  } catch {
    const payload = await client.getJson<{ jobs?: GreenhouseJob[] }>(
      `https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`,
    )
    const job = (payload.jobs ?? []).find((item) => String(item.id) === jobId)
    if (!job) return null
    const [posting] = greenhouseJobsToPostings([job], company, now)
    return posting ? asExternal(posting, url.toString()) : null
  }
  return null
}

async function readAshby(url: URL, client: HttpClient, now: Date): Promise<RawPosting | null> {
  const match = url.toString().match(ASHBY_JOB)
  if (!match) return null
  const board = match[1].toLowerCase()
  const segment = decodeURIComponent(match[2])
  const payload = await client.getJson<{ jobs?: AshbyJob[] }>(`https://api.ashbyhq.com/posting-api/job-board/${board}`)
  const postings = ashbyJobsToPostings(payload.jobs ?? [], { name: labelFromSlug(board), atsIdentifier: board }, now)
  const posting = postings.find(
    (job) => job.externalId === segment || job.applicationUrl.includes(segment) || job.sourceUrl.includes(segment),
  )
  return posting ? asExternal(posting, url.toString()) : null
}

async function readLever(url: URL, client: HttpClient, now: Date): Promise<RawPosting | null> {
  const match = url.toString().match(LEVER_JOB)
  if (!match) return null
  const site = match[1].toLowerCase()
  const id = decodeURIComponent(match[2])
  const company = { name: labelFromSlug(site), atsIdentifier: site }
  try {
    const job = await client.getJson<LeverJob>(`https://api.lever.co/v0/postings/${site}/${id}`)
    const [posting] = leverJobsToPostings([job], company, now)
    if (posting) return asExternal(posting, url.toString())
  } catch {
    const jobs = await client.getJson<LeverJob[]>(`https://api.lever.co/v0/postings/${site}?mode=json`)
    const job = jobs.find((item) => item.id === id || item.hostedUrl?.includes(id))
    if (!job) return null
    const [posting] = leverJobsToPostings([job], company, now)
    return posting ? asExternal(posting, url.toString()) : null
  }
  return null
}

function organizationName(html: string, pageUrl: string): string | null {
  const blocks = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
  for (const block of blocks) {
    let parsed: unknown
    try {
      parsed = JSON.parse(block[1])
    } catch {
      continue
    }
    const nodes = Array.isArray(parsed) ? parsed : [parsed]
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue
      const record = node as { hiringOrganization?: { name?: string }; "@graph"?: unknown[] }
      const graph = record["@graph"] ?? [record]
      for (const item of graph) {
        if (!item || typeof item !== "object") continue
        const org = (item as { hiringOrganization?: { name?: string } }).hiringOrganization
        if (org?.name?.trim()) return org.name.trim()
      }
    }
  }
  const site = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)
  if (site?.[1]?.trim()) return site[1].trim()
  return labelFromSlug(new URL(pageUrl).hostname.replace(/^www\./, "").split(".")[0] ?? "")
}

function metaContent(html: string, key: string): string {
  const match = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']`, "i"))
  return match?.[1]?.trim() ?? ""
}

function readHtmlJob(html: string, pageUrl: string, source: SourceId, now: Date): RawPosting | null {
  const structured = readJsonLdJobs(html, pageUrl)[0]
  const title = structured?.title || metaContent(html, "og:title")
  const description = structured?.description || htmlToText(metaContent(html, "og:description"))
  if (!title) return null
  const company = organizationName(html, pageUrl) || labelFromSlug(new URL(pageUrl).hostname)
  let postedDaysAgo: number | null = null
  if (structured?.datePosted) {
    const posted = Date.parse(structured.datePosted)
    if (!Number.isNaN(posted)) postedDaysAgo = Math.max(0, Math.floor((now.getTime() - posted) / 86_400_000))
  }
  return {
    id: `external:${pageUrl}`,
    release: "search",
    source,
    sourceUrl: structured?.url || pageUrl,
    applicationUrl: structured?.url || pageUrl,
    companyName: company,
    discoveredFrom: "external_user",
    title,
    description: description.slice(0, 12_000),
    locationRaw: structured?.location || "",
    employmentType: structured?.employmentType || "Full-time",
    postedDaysAgo,
  }
}

export function postingFromManual(draft: ManualJobDraft): RawPosting | null {
  const title = draft.title.trim()
  const company = draft.company.trim()
  const location = draft.location.trim()
  const description = draft.description.trim()
  const url = parseJobUrl(draft.url)
  if (!url || title.length < 2 || company.length < 2 || location.length < 2 || description.length < 20) return null
  const arrangement = draft.arrangement.trim()
  return {
    id: `external:${url.toString()}`,
    release: "search",
    source: draft.source || sourceFor(url),
    sourceUrl: url.toString(),
    applicationUrl: url.toString(),
    companyName: company,
    discoveredFrom: "external_user",
    title,
    description: description.slice(0, 12_000),
    locationRaw: location,
    arrangementRaw: arrangement && arrangement !== "Unclear" ? arrangement : undefined,
    employmentType: "Full-time",
    postedDaysAgo: null,
  }
}

export async function fetchExternalJob(value: string, client: HttpClient, now = new Date()): Promise<ExternalDraft> {
  const url = parseJobUrl(value)
  if (!url) {
    return { status: "manual", draft: blankDraft(value.trim(), "career_page") }
  }
  const source = sourceFor(url)
  const fallback = blankDraft(url.toString(), source, { company: labelFromSlug(url.hostname.replace(/^www\./, "").split(".")[0] ?? "") })
  try {
    let posting: RawPosting | null = null
    if (source === "greenhouse") posting = await readGreenhouse(url, client, now)
    else if (source === "ashby") posting = await readAshby(url, client, now)
    else if (source === "lever") posting = await readLever(url, client, now)
    else {
      const html = await client.getText(url.toString())
      posting = readHtmlJob(html, url.toString(), source, now)
    }
    if (!posting) return { status: "manual", draft: fallback }
    return finish(posting, fallback)
  } catch {
    return { status: "manual", draft: fallback }
  }
}
