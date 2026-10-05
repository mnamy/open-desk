import { CAREER_PATHS } from "@/lib/discovery/companies"
import { postedDaysAgo } from "@/lib/sources/dates"
import { detectAts, htmlToText, readJsonLdJobs } from "@/lib/sources/html"
import type { HttpClient } from "@/lib/sources/http"
import type { RawPosting } from "@/lib/sources/types"
import type { SeedCompany } from "@/data/company-seed"

const SKIP_LINK = /^(careers|jobs|open roles|openings|view all|see all|search|home|about|blog|login|sign in)$/i

export interface CareerDiscovery {
  careersUrl: string | null
  ats: { provider: "greenhouse" | "ashby" | "lever"; identifier: string } | null
  postings: RawPosting[]
  warning?: string
}

function absolute(href: string, pageUrl: string): string | null {
  try {
    return new URL(href, pageUrl).toString()
  } catch {
    return null
  }
}

export function careerPostingsFromHtml(html: string, pageUrl: string, company: SeedCompany, now: Date): RawPosting[] {
  const structured = readJsonLdJobs(html, pageUrl)
  if (structured.length > 0) {
    return structured.slice(0, 40).map((job, index) => ({
      id: `career:${company.name}:${job.url ?? index}`,
      release: "search" as const,
      source: "career_page" as const,
      sourceUrl: job.url ?? pageUrl,
      applicationUrl: job.url ?? pageUrl,
      companyName: company.name,
      companyWebsite: company.website,
      careersUrl: pageUrl,
      industry: company.industry,
      discoveredFrom: "career_page",
      title: job.title,
      description: job.description.slice(0, 12_000),
      locationRaw: job.location,
      employmentType: job.employmentType ?? "Full-time",
      postedDaysAgo: postedDaysAgo(job.datePosted, now),
    }))
  }

  const postings: RawPosting[] = []
  const seen = new Set<string>()
  const links = html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)
  for (const link of links) {
    const href = absolute(link[1], pageUrl)
    if (!href || seen.has(href)) continue
    if (!/\/(jobs|careers|openings|positions|opportunities)\/[^/?#]{2,}/i.test(href)) continue
    const title = htmlToText(link[2]).replace(/\s+/g, " ").trim()
    if (!title || title.length < 4 || title.length > 140 || SKIP_LINK.test(title)) continue
    seen.add(href)
    postings.push({
      id: `career:${company.name}:${href}`,
      release: "search",
      source: "career_page",
      sourceUrl: href,
      applicationUrl: href,
      companyName: company.name,
      companyWebsite: company.website,
      careersUrl: pageUrl,
      industry: company.industry,
      discoveredFrom: "career_page",
      title,
      description: title,
      locationRaw: title,
      employmentType: "Full-time",
      postedDaysAgo: null,
    })
    if (postings.length >= 25) break
  }
  return postings
}

function websiteBase(website: string): string | null {
  try {
    const url = new URL(website.startsWith("http") ? website : `https://${website}`)
    return url.origin
  } catch {
    return null
  }
}

export async function discoverCareerPage(
  company: SeedCompany,
  client: HttpClient,
  now: Date,
): Promise<CareerDiscovery> {
  const origin = company.website ? websiteBase(company.website) : null
  const urls = [
    ...(company.careersUrl ? [company.careersUrl] : []),
    ...(origin ? CAREER_PATHS.map((path) => `${origin}${path}`) : []),
  ].filter((url, index, all) => all.indexOf(url) === index)
  if (urls.length === 0) return { careersUrl: null, ats: null, postings: [] }

  let lastError: string | undefined
  let sawPage = false
  for (const url of urls) {
    let html = ""
    try {
      html = await client.getText(url, 8_000)
      sawPage = true
    } catch (error) {
      lastError = error instanceof Error ? error.message : "request failed"
      continue
    }
    const ats = detectAts(`${url}\n${html}`)
    if (ats) return { careersUrl: url, ats, postings: [] }
    const postings = careerPostingsFromHtml(html, url, company, now)
    if (postings.length > 0) return { careersUrl: url, ats: null, postings }
  }

  if (!sawPage) {
    return {
      careersUrl: null,
      ats: null,
      postings: [],
      warning: `${company.name}: career page was not reachable${lastError ? ` (${lastError})` : ""}`,
    }
  }
  return { careersUrl: company.careersUrl ?? (origin ? `${origin}/careers` : null), ats: null, postings: [] }
}
