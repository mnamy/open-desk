import { postedDaysAgo } from "@/lib/sources/dates"
import { htmlToText } from "@/lib/sources/html"
import type { RawPosting } from "@/lib/sources/types"

export interface LeverJob {
  id?: string
  text?: string
  categories?: { location?: string | null; commitment?: string | null; allLocations?: string[] }
  descriptionPlain?: string | null
  description?: string | null
  openingPlain?: string | null
  additionalPlain?: string | null
  lists?: { text?: string; content?: string }[]
  hostedUrl?: string | null
  applyUrl?: string | null
  createdAt?: number | null
  workplaceType?: string | null
}

export interface LeverBoardCompany {
  name: string
  website?: string
  industry?: string
  atsIdentifier: string
}

function arrangement(job: LeverJob): string | undefined {
  const workplace = (job.workplaceType ?? "").toLowerCase()
  if (workplace.includes("hybrid")) return "Hybrid"
  if (workplace.includes("remote")) return "Remote"
  if (workplace.includes("on")) return "On-site"
  return undefined
}

export function leverJobsToPostings(jobs: LeverJob[], company: LeverBoardCompany, now: Date): RawPosting[] {
  const postings: RawPosting[] = []
  for (const job of jobs) {
    const title = job.text?.trim()
    const sourceUrl = job.hostedUrl?.trim()
    const applicationUrl = (job.applyUrl || job.hostedUrl)?.trim()
    if (!title || !sourceUrl || !applicationUrl || !job.id) continue
    const listText = (job.lists ?? [])
      .map((list) => `${list.text ?? ""}\n${list.content ? htmlToText(list.content) : ""}`)
      .join("\n")
    const description = [job.descriptionPlain, job.openingPlain, job.additionalPlain, listText]
      .filter(Boolean)
      .join("\n\n")
      .trim()
    const locations = job.categories?.allLocations?.length
      ? job.categories.allLocations
      : [job.categories?.location]
    postings.push({
      id: `lever:${company.atsIdentifier}:${job.id}`,
      release: "search",
      source: "lever",
      sourceUrl,
      applicationUrl,
      externalId: job.id,
      atsProvider: "lever",
      atsIdentifier: company.atsIdentifier,
      companyName: company.name,
      companyWebsite: company.website,
      careersUrl: `https://jobs.lever.co/${company.atsIdentifier}`,
      industry: company.industry,
      discoveredFrom: "lever",
      title,
      description: description.length > 12_000 ? description.slice(0, 12_000) : description,
      locationRaw: locations.filter((place): place is string => Boolean(place?.trim())).join(" · "),
      arrangementRaw: arrangement(job),
      employmentType: job.categories?.commitment ?? "Full-time",
      postedDaysAgo: postedDaysAgo(job.createdAt, now),
    })
  }
  return postings
}
