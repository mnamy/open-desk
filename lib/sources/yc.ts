import { normalizeCity } from "@/lib/jobs/location"
import { postedDaysAgo } from "@/lib/sources/dates"
import { htmlToText, readInertiaProps } from "@/lib/sources/html"
import type { RawPosting } from "@/lib/sources/types"

export interface YcJobCard {
  id: number
  title?: string
  location?: string
  companyName?: string
  companySlug?: string
  companyOneLiner?: string
}

export const YC_CITY_QUERIES = ["New York", "Brooklyn", "Chicago", "Boston", "Miami", "Austin"]

export function ycCards(payload: { jobs?: YcJobCard[] } | null): YcJobCard[] {
  return (payload?.jobs ?? []).filter((job) => job.id && normalizeCity(job.location))
}

export function ycDetailToPosting(html: string, now: Date): RawPosting | null {
  const props = readInertiaProps(html)
  const job = props?.job
  const company = props?.company
  if (!job || typeof job !== "object" || !company || typeof company !== "object") return null
  const record = job as {
    id?: number
    title?: string
    descriptionHtml?: string
    location?: string
    jobType?: string
  }
  const org = company as {
    name?: string
    url?: string
    industry?: string
    industries?: string[]
    description?: string
  }
  const title = record.title?.trim()
  const companyName = org.name?.trim()
  if (!title || !companyName || !record.id) return null
  const description = htmlToText(record.descriptionHtml ?? "")
  const pageUrl = `https://www.workatastartup.com/jobs/${record.id}`
  const website = org.url?.startsWith("http") ? org.url : org.url ? `https://${org.url}` : undefined
  return {
    id: `yc:${record.id}`,
    release: "search",
    source: "yc",
    sourceUrl: pageUrl,
    applicationUrl: pageUrl,
    externalId: String(record.id),
    atsProvider: undefined,
    companyName,
    companyWebsite: website,
    industry: org.industry || org.industries?.[0],
    discoveredFrom: "yc",
    title,
    description: description.length > 12_000 ? description.slice(0, 12_000) : description,
    locationRaw: record.location?.trim() || "",
    employmentType: record.jobType || "Full-time",
    postedDaysAgo: postedDaysAgo(null, now),
  }
}
