import { postedDaysAgo } from "@/lib/sources/dates"
import { htmlToText } from "@/lib/sources/html"
import type { RawPosting } from "@/lib/sources/types"

export interface GreenhouseJob {
  id: number
  title?: string
  absolute_url?: string
  location?: { name?: string | null }
  offices?: { name?: string | null }[]
  content?: string | null
  first_published?: string | null
  updated_at?: string | null
}

export interface GreenhouseBoardCompany {
  name: string
  website?: string
  industry?: string
  atsIdentifier: string
}

function clip(value: string): string {
  return value.length > 12_000 ? value.slice(0, 12_000) : value
}

export function greenhouseJobsToPostings(
  jobs: GreenhouseJob[],
  company: GreenhouseBoardCompany,
  now: Date,
): RawPosting[] {
  const postings: RawPosting[] = []
  for (const job of jobs) {
    const title = job.title?.trim()
    const applicationUrl = job.absolute_url?.trim()
    if (!title || !applicationUrl || job.id === undefined || job.id === null) continue
    const places = [job.location?.name, ...(job.offices ?? []).map((office) => office.name)]
      .map((place) => place?.trim())
      .filter((place): place is string => Boolean(place))
    const locationRaw = [...new Set(places)].join(" · ")
    postings.push({
      id: `greenhouse:${company.atsIdentifier}:${job.id}`,
      release: "search",
      source: "greenhouse",
      sourceUrl: applicationUrl,
      applicationUrl,
      externalId: String(job.id),
      atsProvider: "greenhouse",
      companyName: company.name,
      companyWebsite: company.website,
      careersUrl: `https://boards.greenhouse.io/${company.atsIdentifier}`,
      industry: company.industry,
      discoveredFrom: "greenhouse",
      title,
      description: clip(htmlToText(job.content ?? "")),
      locationRaw,
      employmentType: "Full-time",
      postedDaysAgo: postedDaysAgo(job.first_published || job.updated_at, now),
    })
  }
  return postings
}
