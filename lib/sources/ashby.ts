import { postedDaysAgo } from "@/lib/sources/dates"
import { htmlToText } from "@/lib/sources/html"
import type { RawPosting } from "@/lib/sources/types"

export interface AshbyJob {
  id?: string
  title?: string
  location?: string | null
  secondaryLocations?: { location?: string | null }[] | string[]
  descriptionPlain?: string | null
  descriptionHtml?: string | null
  jobUrl?: string | null
  applyUrl?: string | null
  publishedAt?: string | null
  employmentType?: string | null
  isListed?: boolean
  workplaceType?: string | null
  isRemote?: boolean | null
}

export interface AshbyBoardCompany {
  name: string
  website?: string
  industry?: string
  atsIdentifier: string
}

function arrangement(job: AshbyJob): string | undefined {
  const workplace = (job.workplaceType ?? "").toLowerCase()
  if (workplace.includes("hybrid")) return "Hybrid"
  if (workplace.includes("remote") || job.isRemote) return "Remote"
  if (workplace.includes("on")) return "On-site"
  return undefined
}

function places(job: AshbyJob): string {
  const extra = (job.secondaryLocations ?? []).map((item) => (typeof item === "string" ? item : item.location))
  return [job.location, ...extra]
    .map((place) => place?.trim())
    .filter((place): place is string => Boolean(place))
    .filter((place, index, all) => all.indexOf(place) === index)
    .join(" · ")
}

export function ashbyJobsToPostings(jobs: AshbyJob[], company: AshbyBoardCompany, now: Date): RawPosting[] {
  const postings: RawPosting[] = []
  for (const job of jobs) {
    if (job.isListed === false) continue
    const title = job.title?.trim()
    const applicationUrl = (job.applyUrl || job.jobUrl)?.trim()
    const sourceUrl = (job.jobUrl || job.applyUrl)?.trim()
    if (!title || !applicationUrl || !sourceUrl || !job.id) continue
    const description = (job.descriptionPlain || htmlToText(job.descriptionHtml ?? "")).trim()
    postings.push({
      id: `ashby:${company.atsIdentifier}:${job.id}`,
      release: "search",
      source: "ashby",
      sourceUrl,
      applicationUrl,
      externalId: job.id,
      atsProvider: "ashby",
      atsIdentifier: company.atsIdentifier,
      companyName: company.name,
      companyWebsite: company.website,
      careersUrl: `https://jobs.ashbyhq.com/${company.atsIdentifier}`,
      industry: company.industry,
      discoveredFrom: "ashby",
      title,
      description: description.length > 12_000 ? description.slice(0, 12_000) : description,
      locationRaw: places(job),
      arrangementRaw: arrangement(job),
      employmentType: job.employmentType ?? "Full-time",
      postedDaysAgo: postedDaysAgo(job.publishedAt, now),
    })
  }
  return postings
}
