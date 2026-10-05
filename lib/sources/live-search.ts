import { normalizeCompanyName } from "@/lib/jobs/text"
import type { SeedCompany } from "@/data/company-seed"
import { ashbyJobsToPostings, type AshbyJob } from "@/lib/sources/ashby"
import { discoverCareerPage } from "@/lib/sources/career-page"
import { greenhouseJobsToPostings, type GreenhouseJob } from "@/lib/sources/greenhouse"
import { mapPool, type HttpClient } from "@/lib/sources/http"
import { leverJobsToPostings, type LeverJob } from "@/lib/sources/lever"
import type { RawPosting } from "@/lib/sources/types"
import { YC_CITY_QUERIES, ycCards, ycDetailToPosting, type YcJobCard } from "@/lib/sources/yc"

export interface CheckedCompany {
  name: string
  normalizedName: string
  website?: string
  careersUrl?: string
  atsProvider?: string
  atsIdentifier?: string
  industry?: string
  discoveredFrom: string
}

export interface LiveCollection {
  postings: RawPosting[]
  companiesChecked: number
  warnings: string[]
  checkedCompanies: CheckedCompany[]
}

function warningText(error: unknown): string {
  const message = error instanceof Error ? error.message : "request failed"
  return message.replace(/\s+/g, " ").slice(0, 180)
}

function checkedFrom(company: SeedCompany, discoveredFrom: string, extra?: Partial<CheckedCompany>): CheckedCompany {
  return {
    name: extra?.name ?? company.name,
    normalizedName: normalizeCompanyName(extra?.name ?? company.name),
    website: extra?.website ?? company.website,
    careersUrl: extra?.careersUrl,
    industry: extra?.industry ?? company.industry,
    atsProvider: extra?.atsProvider ?? company.atsProvider,
    atsIdentifier: extra?.atsIdentifier ?? company.atsIdentifier,
    discoveredFrom,
  }
}

async function fetchBoard(company: SeedCompany, client: HttpClient, now: Date): Promise<RawPosting[]> {
  if (!company.atsProvider || !company.atsIdentifier) return []
  if (company.atsProvider === "greenhouse") {
    const payload = await client.getJson<{ jobs?: GreenhouseJob[] }>(
      `https://boards-api.greenhouse.io/v1/boards/${company.atsIdentifier}/jobs?content=true`,
      20_000,
    )
    return greenhouseJobsToPostings(payload.jobs ?? [], { ...company, atsIdentifier: company.atsIdentifier }, now)
  }
  if (company.atsProvider === "ashby") {
    const payload = await client.getJson<{ jobs?: AshbyJob[] }>(
      `https://api.ashbyhq.com/posting-api/job-board/${company.atsIdentifier}`,
      20_000,
    )
    return ashbyJobsToPostings(payload.jobs ?? [], { ...company, atsIdentifier: company.atsIdentifier }, now)
  }
  if (company.atsProvider === "lever") {
    const jobs = await client.getJson<LeverJob[]>(
      `https://api.lever.co/v0/postings/${company.atsIdentifier}?mode=json`,
      20_000,
    )
    return leverJobsToPostings(jobs, { ...company, atsIdentifier: company.atsIdentifier }, now)
  }
  return []
}

async function fetchYc(client: HttpClient, now: Date, detailCap: number): Promise<{ postings: RawPosting[]; warnings: string[] }> {
  const cards = new Map<number, YcJobCard>()
  const warnings: string[] = []
  await mapPool(YC_CITY_QUERIES, 4, async (query) => {
    try {
      const payload = await client.getJson<{ jobs?: YcJobCard[] }>(
        `https://www.workatastartup.com/jobs/search?q=${encodeURIComponent(query)}`,
        12_000,
      )
      for (const card of ycCards(payload)) cards.set(card.id, card)
    } catch (error) {
      warnings.push(`YC search “${query}”: ${warningText(error)}`)
    }
  })

  const selected = [...cards.values()].slice(0, detailCap)
  let failed = 0
  const batches = await mapPool(selected, 6, async (card) => {
    try {
      const html = await client.getText(`https://www.workatastartup.com/jobs/${card.id}`, 12_000)
      return ycDetailToPosting(html, now)
    } catch {
      failed += 1
      return null
    }
  })
  if (failed > 0) warnings.push(`YC: ${failed} job pages could not be read`)
  if (cards.size > selected.length) {
    warnings.push(`YC: showing ${selected.length} of ${cards.size} city matches this pass`)
  }
  return { postings: batches.filter((posting): posting is RawPosting => Boolean(posting)), warnings }
}

export async function collectLivePostings(options: {
  companies: SeedCompany[]
  client: HttpClient
  now?: Date
  fetchYc?: boolean
  discoverCareers?: boolean
  limits?: { ycDetails?: number; discoveryCompanies?: number }
}): Promise<LiveCollection> {
  const now = options.now ?? new Date()
  const fetchYcJobs = options.fetchYc !== false
  const discover = options.discoverCareers !== false
  const ycCap = options.limits?.ycDetails ?? 80
  const discoveryCap = options.limits?.discoveryCompanies ?? 40
  const warnings: string[] = []
  const postings: RawPosting[] = []
  const checked: CheckedCompany[] = []
  const seenBoards = new Set<string>()

  const boardCompanies = options.companies.filter((company) => company.atsProvider && company.atsIdentifier)
  const boardResults = await mapPool(boardCompanies, 6, async (company) => {
    const key = `${company.atsProvider}:${company.atsIdentifier}`
    if (seenBoards.has(key)) return { company, postings: [] as RawPosting[], warning: undefined }
    seenBoards.add(key)
    try {
      const found = await fetchBoard(company, options.client, now)
      return { company, postings: found, warning: undefined as string | undefined }
    } catch (error) {
      return { company, postings: [] as RawPosting[], warning: `${company.atsProvider} · ${company.name}: ${warningText(error)}` }
    }
  })
  for (const result of boardResults) {
    postings.push(...result.postings)
    if (result.warning) warnings.push(result.warning)
    checked.push(checkedFrom(result.company, result.company.atsProvider ?? "seed"))
  }

  if (fetchYcJobs) {
    const yc = await fetchYc(options.client, now, ycCap)
    postings.push(...yc.postings)
    warnings.push(...yc.warnings)
    for (const posting of yc.postings) {
      checked.push(
        checkedFrom(
          {
            name: posting.companyName,
            website: posting.companyWebsite,
            industry: posting.industry,
          },
          "yc",
          { careersUrl: posting.careersUrl, website: posting.companyWebsite },
        ),
      )
    }
  }

  if (discover) {
    const known = new Set(checked.map((company) => company.normalizedName))
    const targets = options.companies
      .filter((company) => company.website && !company.atsProvider && !known.has(normalizeCompanyName(company.name)))
      .slice(0, discoveryCap)
    const discoveries = await mapPool(targets, 5, async (company) => {
      try {
        const found = await discoverCareerPage(company, options.client, now)
        return { company, found }
      } catch (error) {
        return {
          company,
          found: {
            careersUrl: null,
            ats: null,
            postings: [] as RawPosting[],
            warning: `${company.name}: ${warningText(error)}`,
          },
        }
      }
    })

    const followUp: SeedCompany[] = []
    for (const { company, found } of discoveries) {
      if (found.warning) warnings.push(found.warning)
      if (found.ats) {
        const key = `${found.ats.provider}:${found.ats.identifier}`
        checked.push(
          checkedFrom(company, "career_page", {
            careersUrl: found.careersUrl ?? undefined,
            atsProvider: found.ats.provider,
            atsIdentifier: found.ats.identifier,
          }),
        )
        if (!seenBoards.has(key)) {
          seenBoards.add(key)
          followUp.push({
            ...company,
            atsProvider: found.ats.provider,
            atsIdentifier: found.ats.identifier,
          })
        }
        continue
      }
      postings.push(...found.postings)
      checked.push(
        checkedFrom(company, "career_page", {
          careersUrl: found.careersUrl ?? undefined,
        }),
      )
    }

    const routed = await mapPool(followUp, 4, async (company) => {
      try {
        return { company, postings: await fetchBoard(company, options.client, now), warning: undefined as string | undefined }
      } catch (error) {
        return { company, postings: [] as RawPosting[], warning: `${company.atsProvider} · ${company.name}: ${warningText(error)}` }
      }
    })
    for (const result of routed) {
      postings.push(...result.postings)
      if (result.warning) warnings.push(result.warning)
    }
  }

  const uniqueCompanies = new Map<string, CheckedCompany>()
  for (const company of checked) uniqueCompanies.set(company.normalizedName, company)

  return {
    postings,
    companiesChecked: uniqueCompanies.size,
    warnings,
    checkedCompanies: [...uniqueCompanies.values()],
  }
}
