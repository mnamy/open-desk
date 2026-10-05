import { normalizeCompanyName } from "@/lib/jobs/text"
import type { SeedCompany } from "@/data/company-seed"
import { ashbyJobsToPostings, type AshbyJob } from "@/lib/sources/ashby"
import { discoverCareerPage } from "@/lib/sources/career-page"
import { greenhouseJobsToPostings, type GreenhouseJob } from "@/lib/sources/greenhouse"
import { mapPool, type HttpClient } from "@/lib/sources/http"
import { leverJobsToPostings, type LeverJob } from "@/lib/sources/lever"
import type { RawPosting } from "@/lib/sources/types"
import { fetchWelcomePage, readWelcomeConfig, welcomeHitsToPostings, WELCOME_MAX_PAGES, type WelcomeHit } from "@/lib/sources/welcome"
import { wellfoundHtmlToPostings, wellfoundSearchUrls } from "@/lib/sources/wellfound"
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

async function fetchBoard(company: SeedCompany, client: HttpClient, now: Date, timeoutMs = 20_000): Promise<RawPosting[]> {
  if (!company.atsProvider || !company.atsIdentifier) return []
  if (company.atsProvider === "greenhouse") {
    const payload = await client.getJson<{ jobs?: GreenhouseJob[] }>(
      `https://boards-api.greenhouse.io/v1/boards/${company.atsIdentifier}/jobs?content=true`,
      timeoutMs,
    )
    return greenhouseJobsToPostings(payload.jobs ?? [], { ...company, atsIdentifier: company.atsIdentifier }, now)
  }
  if (company.atsProvider === "ashby") {
    const payload = await client.getJson<{ jobs?: AshbyJob[] }>(
      `https://api.ashbyhq.com/posting-api/job-board/${company.atsIdentifier}`,
      timeoutMs,
    )
    return ashbyJobsToPostings(payload.jobs ?? [], { ...company, atsIdentifier: company.atsIdentifier }, now)
  }
  if (company.atsProvider === "lever") {
    const jobs = await client.getJson<LeverJob[]>(
      `https://api.lever.co/v0/postings/${company.atsIdentifier}?mode=json`,
      timeoutMs,
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

async function fetchWellfound(client: HttpClient, now: Date, urls = wellfoundSearchUrls()): Promise<{ postings: RawPosting[]; warnings: string[] }> {
  const warnings: string[] = []
  let failed = 0
  const batches = await mapPool(urls, 4, async (url) => {
    try {
      const html = await client.getText(url, 15_000)
      return wellfoundHtmlToPostings(html, now)
    } catch {
      failed += 1
      return [] as RawPosting[]
    }
  })
  if (failed > 0) warnings.push(`Wellfound: ${failed} search pages could not be read`)
  const seen = new Set<string>()
  const postings = batches.flat().filter((posting) => {
    if (seen.has(posting.id)) return false
    seen.add(posting.id)
    return true
  })
  return { postings, warnings }
}

async function fetchWelcome(
  client: HttpClient,
  now: Date,
  pages = WELCOME_MAX_PAGES,
  startPage = 0,
): Promise<{ postings: RawPosting[]; warnings: string[] }> {
  const warnings: string[] = []
  try {
    if (!client.postJson) {
      warnings.push("Welcome to the Jungle: search client unavailable")
      return { postings: [], warnings }
    }
    const html = await client.getText(CONFIG_URL, 12_000)
    const config = readWelcomeConfig(html)
    if (!config) {
      warnings.push("Welcome to the Jungle: public search config was not found")
      return { postings: [], warnings }
    }
    const hits: WelcomeHit[] = []
    for (let page = startPage; page < startPage + pages; page += 1) {
      const batch = await fetchWelcomePage(client, config, page)
      hits.push(...batch)
      if (batch.length < 100) break
    }
    return { postings: welcomeHitsToPostings(hits, now), warnings }
  } catch (error) {
    warnings.push(`Welcome to the Jungle: ${warningText(error)}`)
    return { postings: [], warnings }
  }
}

const CONFIG_URL = "https://www.welcometothejungle.com/en/sitemap.xml"

function rememberCompanies(postings: RawPosting[], discoveredFrom: string, checked: CheckedCompany[]) {
  for (const posting of postings) {
    checked.push(
      checkedFrom(
        { name: posting.companyName, website: posting.companyWebsite, industry: posting.industry },
        discoveredFrom,
        { website: posting.companyWebsite },
      ),
    )
  }
}

export async function collectLivePostings(options: {
  companies: SeedCompany[]
  client: HttpClient
  now?: Date
  fetchYc?: boolean
  discoverCareers?: boolean
  fetchMarketplaces?: boolean
  limits?: { ycDetails?: number; discoveryCompanies?: number }
}): Promise<LiveCollection> {
  const now = options.now ?? new Date()
  const fetchYcJobs = options.fetchYc !== false
  const discover = options.discoverCareers !== false
  const fetchMarkets = options.fetchMarketplaces !== false
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

  if (fetchMarkets) {
    const wellfound = await fetchWellfound(options.client, now)
    postings.push(...wellfound.postings)
    warnings.push(...wellfound.warnings)
    rememberCompanies(wellfound.postings, "wellfound", checked)
    const welcome = await fetchWelcome(options.client, now)
    postings.push(...welcome.postings)
    warnings.push(...welcome.warnings)
    rememberCompanies(welcome.postings, "welcome_to_the_jungle", checked)
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

export interface SearchCursor {
  companies: SeedCompany[]
  phase: "boards" | "yc-search" | "yc-details" | "discover" | "followup" | "wellfound" | "welcome" | "done"
  boardIndex: number
  ycIds: number[]
  ycIndex: number
  discoveryIndex: number
  followUps: SeedCompany[]
  seenBoards: string[]
  wellfoundIndex?: number
  welcomePage?: number
}

const SLICE_BOARD_TIMEOUT_MS = 12_000
const SLICE_MAX_BOARDS = 3
const SLICE_MAX_POSTINGS = 100
const SLICE_BUDGET_MS = 18_000
const SLICE_YC_DETAILS = 8
const SLICE_DISCOVERY = 3
const SLICE_WELLFOUND = 8

export function initialCursor(companies: SeedCompany[]): SearchCursor {
  return {
    companies,
    phase: "boards",
    boardIndex: 0,
    ycIds: [],
    ycIndex: 0,
    discoveryIndex: 0,
    followUps: [],
    seenBoards: [],
    wellfoundIndex: 0,
    welcomePage: 0,
  }
}

function emptyCollection(): LiveCollection {
  return { postings: [], companiesChecked: 0, warnings: [], checkedCompanies: [] }
}

function boardTargets(cursor: SearchCursor): SeedCompany[] {
  return cursor.companies.filter((company) => company.atsProvider && company.atsIdentifier)
}

function discoveryTargets(cursor: SearchCursor): SeedCompany[] {
  return cursor.companies.filter((company) => company.website && !company.atsProvider).slice(0, 40)
}

function boardKey(company: SeedCompany): string | null {
  if (!company.atsProvider || !company.atsIdentifier) return null
  return `${company.atsProvider}:${company.atsIdentifier}`
}

function skipEmpty(cursor: SearchCursor): SearchCursor {
  const next = {
    ...cursor,
    followUps: [...cursor.followUps],
    seenBoards: [...cursor.seenBoards],
    wellfoundIndex: cursor.wellfoundIndex ?? 0,
    welcomePage: cursor.welcomePage ?? 0,
  }
  while (true) {
    if (next.phase === "boards" && next.boardIndex >= boardTargets(next).length) next.phase = "yc-search"
    else if (next.phase === "yc-details" && next.ycIndex >= next.ycIds.length) next.phase = "discover"
    else if (next.phase === "discover" && next.discoveryIndex >= discoveryTargets(next).length) next.phase = "followup"
    else if (next.phase === "followup" && next.followUps.length === 0) next.phase = "wellfound"
    else if (next.phase === "wellfound" && next.wellfoundIndex >= wellfoundSearchUrls().length) next.phase = "welcome"
    else if (next.phase === "welcome" && next.welcomePage >= WELCOME_MAX_PAGES) next.phase = "done"
    else break
  }
  return next
}

export async function collectNextSlice(options: {
  cursor: SearchCursor
  client: HttpClient
  now?: Date
  fetchYc?: boolean
  fetchMarketplaces?: boolean
}): Promise<{ cursor: SearchCursor; collection: LiveCollection }> {
  const now = options.now ?? new Date()
  const cursor = skipEmpty(options.cursor)
  if (cursor.phase === "done") return { cursor, collection: emptyCollection() }
  if (cursor.phase === "boards") return collectBoardSlice(cursor, options.client, now)
  if (cursor.phase === "yc-search") return options.fetchYc === false ? skipYc(cursor) : collectYcSearch(cursor, options.client)
  if (cursor.phase === "yc-details") return collectYcDetails(cursor, options.client, now)
  if (cursor.phase === "discover") return collectDiscoverySlice(cursor, options.client, now)
  if (cursor.phase === "followup") return collectFollowUp(cursor, options.client, now)
  if (cursor.phase === "wellfound") return options.fetchMarketplaces === false ? skipMarket(cursor, "welcome") : collectWellfoundSlice(cursor, options.client, now)
  return options.fetchMarketplaces === false ? skipMarket(cursor, "done") : collectWelcomeSlice(cursor, options.client, now)
}

function skipMarket(cursor: SearchCursor, phase: SearchCursor["phase"]) {
  return { cursor: skipEmpty({ ...cursor, phase, wellfoundIndex: wellfoundSearchUrls().length, welcomePage: WELCOME_MAX_PAGES }), collection: emptyCollection() }
}

async function collectBoardSlice(cursor: SearchCursor, client: HttpClient, now: Date) {
  const boards = boardTargets(cursor)
  const started = Date.now()
  const postings: RawPosting[] = []
  const warnings: string[] = []
  const checked: CheckedCompany[] = []
  const seen = new Set(cursor.seenBoards)
  let index = cursor.boardIndex
  while (index < boards.length && index - cursor.boardIndex < SLICE_MAX_BOARDS) {
    if (index > cursor.boardIndex && (Date.now() - started > SLICE_BUDGET_MS || postings.length >= SLICE_MAX_POSTINGS)) break
    const company = boards[index]
    index += 1
    const key = boardKey(company)
    if (key && seen.has(key)) {
      checked.push(checkedFrom(company, company.atsProvider ?? "seed"))
      continue
    }
    if (key) seen.add(key)
    try {
      postings.push(...(await fetchBoard(company, client, now, SLICE_BOARD_TIMEOUT_MS)))
    } catch (error) {
      warnings.push(`${company.atsProvider} · ${company.name}: ${warningText(error)}`)
    }
    checked.push(checkedFrom(company, company.atsProvider ?? "seed"))
  }
  const next = skipEmpty({ ...cursor, boardIndex: index, seenBoards: [...seen] })
  return { cursor: next, collection: collectionFrom(postings, warnings, checked) }
}

function skipYc(cursor: SearchCursor) {
  return { cursor: skipEmpty({ ...cursor, phase: "discover", ycIds: [], ycIndex: 0 }), collection: emptyCollection() }
}

async function collectYcSearch(cursor: SearchCursor, client: HttpClient) {
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
  const next = skipEmpty({ ...cursor, phase: "yc-details", ycIds: [...cards.keys()].slice(0, 80), ycIndex: 0 })
  return { cursor: next, collection: collectionFrom([], warnings, []) }
}

async function collectYcDetails(cursor: SearchCursor, client: HttpClient, now: Date) {
  const ids = cursor.ycIds.slice(cursor.ycIndex, cursor.ycIndex + SLICE_YC_DETAILS)
  let failed = 0
  const found = await mapPool(ids, 4, async (id) => {
    try {
      const html = await client.getText(`https://www.workatastartup.com/jobs/${id}`, 12_000)
      return ycDetailToPosting(html, now)
    } catch {
      failed += 1
      return null
    }
  })
  const postings = found.filter((posting): posting is RawPosting => Boolean(posting))
  const warnings = failed > 0 ? [`YC: ${failed} job pages could not be read`] : []
  const checked = postings.map((posting) =>
    checkedFrom(
      { name: posting.companyName, website: posting.companyWebsite, industry: posting.industry },
      "yc",
      { careersUrl: posting.careersUrl, website: posting.companyWebsite },
    ),
  )
  const next = skipEmpty({ ...cursor, ycIndex: cursor.ycIndex + ids.length })
  return { cursor: next, collection: collectionFrom(postings, warnings, checked) }
}

async function collectDiscoverySlice(cursor: SearchCursor, client: HttpClient, now: Date) {
  const targets = discoveryTargets(cursor).slice(cursor.discoveryIndex, cursor.discoveryIndex + SLICE_DISCOVERY)
  const warnings: string[] = []
  const postings: RawPosting[] = []
  const checked: CheckedCompany[] = []
  const followUps = [...cursor.followUps]
  const seen = new Set(cursor.seenBoards)
  const discoveries = await mapPool(targets, 3, async (company) => {
    try {
      return { company, found: await discoverCareerPage(company, client, now) }
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
      if (!seen.has(key)) {
        seen.add(key)
        followUps.push({ ...company, atsProvider: found.ats.provider, atsIdentifier: found.ats.identifier })
      }
      continue
    }
    postings.push(...found.postings)
    checked.push(checkedFrom(company, "career_page", { careersUrl: found.careersUrl ?? undefined }))
  }
  const next = skipEmpty({
    ...cursor,
    discoveryIndex: cursor.discoveryIndex + targets.length,
    followUps,
    seenBoards: [...seen],
  })
  return { cursor: next, collection: collectionFrom(postings, warnings, checked) }
}

async function collectFollowUp(cursor: SearchCursor, client: HttpClient, now: Date) {
  const [company, ...rest] = cursor.followUps
  const warnings: string[] = []
  let postings: RawPosting[] = []
  if (company) {
    try {
      postings = await fetchBoard(company, client, now, SLICE_BOARD_TIMEOUT_MS)
    } catch (error) {
      warnings.push(`${company.atsProvider} · ${company.name}: ${warningText(error)}`)
    }
  }
  const next = skipEmpty({ ...cursor, followUps: rest })
  return { cursor: next, collection: collectionFrom(postings, warnings, []) }
}

async function collectWellfoundSlice(cursor: SearchCursor, client: HttpClient, now: Date) {
  const urls = wellfoundSearchUrls()
  const start = cursor.wellfoundIndex ?? 0
  const batch = urls.slice(start, start + SLICE_WELLFOUND)
  const found = await fetchWellfound(client, now, batch)
  const checked: CheckedCompany[] = []
  rememberCompanies(found.postings, "wellfound", checked)
  const next = skipEmpty({ ...cursor, wellfoundIndex: start + batch.length })
  return { cursor: next, collection: collectionFrom(found.postings, found.warnings, checked) }
}

async function collectWelcomeSlice(cursor: SearchCursor, client: HttpClient, now: Date) {
  const page = cursor.welcomePage ?? 0
  const found = await fetchWelcome(client, now, 1, page)
  const checked: CheckedCompany[] = []
  rememberCompanies(found.postings, "welcome_to_the_jungle", checked)
  const next = skipEmpty({ ...cursor, welcomePage: page + 1 })
  return { cursor: next, collection: collectionFrom(found.postings, found.warnings, checked) }
}

function collectionFrom(postings: RawPosting[], warnings: string[], checked: CheckedCompany[]): LiveCollection {
  const unique = new Map<string, CheckedCompany>()
  for (const company of checked) unique.set(company.normalizedName, company)
  return {
    postings,
    warnings,
    checkedCompanies: [...unique.values()],
    companiesChecked: unique.size,
  }
}
