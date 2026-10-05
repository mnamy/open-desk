import { postedDaysAgo } from "@/lib/sources/dates"
import type { RawPosting } from "@/lib/sources/types"

export const WELLFOUND_ROLES = [
  "product-manager",
  "product-designer",
  "ux-designer",
  "ux-researcher",
  "product-analyst",
  "business-analyst",
  "program-manager",
]

export const WELLFOUND_CITIES = ["new-york", "chicago", "boston", "miami", "austin"]

const ATS_URL = /https?:\/\/[^\s"'<>]+(?:greenhouse\.io|ashbyhq\.com|jobs\.lever\.co|lever\.co)\/[^\s"'<>]+/i

interface ApolloJob {
  __typename?: string
  id?: string | number
  title?: string
  slug?: string
  description?: string
  jobType?: string
  locationNames?: string[]
  remote?: boolean
  remoteConfig?: { kind?: string; wfhFlexible?: boolean } | null
  yearsExperienceMin?: number | null
  yearsExperienceMax?: number | null
  liveStartAt?: number | string | null
}

interface ApolloStartup {
  __typename?: string
  name?: string
  slug?: string
  highConcept?: string
  highlightedJobListings?: { __ref?: string }[]
}

export function wellfoundSearchUrls(): string[] {
  const urls: string[] = []
  for (const role of WELLFOUND_ROLES) {
    for (const city of WELLFOUND_CITIES) {
      urls.push(`https://wellfound.com/role/l/${role}/${city}`)
      if (role === "product-manager" || role === "product-designer") {
        urls.push(`https://wellfound.com/role/l/${role}/${city}?page=2`)
      }
    }
  }
  return urls
}

function experienceSentence(min: number | null | undefined, max: number | null | undefined): string | null {
  if (min == null || Number.isNaN(min)) return null
  if (max != null && max > min && min <= 2) return `${min}–${max} years of experience.`
  if (min <= 0) return "0 years of experience."
  if (min === 1) return "1 year of experience."
  if (min === 2) return "2 years of experience."
  return `${min}+ years of experience required.`
}

function arrangement(job: ApolloJob): string | undefined {
  const kind = job.remoteConfig?.kind
  if (kind === "REMOTE") return "Remote"
  if (job.remote && !kind) return "Remote"
  if (kind === "ONSITE_OR_REMOTE" || job.remoteConfig?.wfhFlexible) return "Hybrid"
  if (kind === "ONSITE") return "On-site"
  return undefined
}

function directApply(text: string, fallback: string): string {
  const match = text.match(ATS_URL)
  return match ? match[0].replace(/[),.;]+$/, "") : fallback
}

export function wellfoundHtmlToPostings(html: string, now: Date): RawPosting[] {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/)
  if (!match) return []
  let parsed: { props?: { pageProps?: { role?: string | null; apolloState?: { data?: Record<string, unknown> } } } }
  try {
    parsed = JSON.parse(match[1]) as typeof parsed
  } catch {
    return []
  }
  const page = parsed.props?.pageProps
  if (!page?.role) return []
  const data = page.apolloState?.data
  if (!data) return []

  const jobs = new Map<string, ApolloJob>()
  const startups: ApolloStartup[] = []
  for (const value of Object.values(data)) {
    if (!value || typeof value !== "object") continue
    const record = value as ApolloJob & ApolloStartup
    if (record.__typename === "JobListingSearchResult" && record.id != null) jobs.set(String(record.id), record)
    if (record.__typename === "StartupResult" && record.name) startups.push(record)
  }

  const postings: RawPosting[] = []
  const seen = new Set<string>()
  for (const startup of startups) {
    for (const ref of startup.highlightedJobListings ?? []) {
      const id = ref.__ref?.replace("JobListingSearchResult:", "")
      if (!id || seen.has(id)) continue
      const job = jobs.get(id)
      const title = job?.title?.trim()
      if (!job || !title) continue
      seen.add(id)
      const years = experienceSentence(job.yearsExperienceMin, job.yearsExperienceMax)
      const description = [job.description?.trim() ?? "", years].filter(Boolean).join("\n\n")
      const slug = job.slug?.trim() || "job"
      const sourceUrl = `https://wellfound.com/jobs/${id}-${slug}`
      const locationRaw = (job.locationNames ?? []).map((place) => place.trim()).filter(Boolean).join(" · ")
      const industry = startup.highConcept && startup.highConcept.length <= 48 && !startup.highConcept.includes(".")
        ? startup.highConcept
        : undefined
      postings.push({
        id: `wellfound:${id}`,
        release: "search",
        source: "wellfound",
        sourceUrl,
        applicationUrl: directApply(description, sourceUrl),
        externalId: id,
        companyName: startup.name?.trim() || "Unknown company",
        companyWebsite: startup.slug ? `https://wellfound.com/company/${startup.slug}` : undefined,
        industry,
        discoveredFrom: "wellfound",
        title,
        description: description.length > 12_000 ? description.slice(0, 12_000) : description,
        locationRaw,
        arrangementRaw: arrangement(job),
        employmentType: /intern/i.test(job.jobType ?? "") ? "Internship" : job.jobType || "Full-time",
        postedDaysAgo: postedDaysAgo(job.liveStartAt, now),
      })
    }
  }
  return postings
}
