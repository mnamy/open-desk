import { postedDaysAgo } from "@/lib/sources/dates"
import type { HttpClient } from "@/lib/sources/http"
import type { RawPosting } from "@/lib/sources/types"

const CITY_FILTER =
  '(offices.city:"New York" OR offices.city:Brooklyn OR offices.city:Chicago OR offices.city:Boston OR offices.city:Miami OR offices.city:Austin)'
const CONTRACT_FILTER = "(contract_type:full_time OR contract_type:graduate_program)"
const PROFESSION_FILTER = [
  "product-management-wNjYw",
  "user-experience-ux-and-design-xYjM3",
  "innovation-and-strategy-3ZDRk",
  "business-analysis-zZThk",
  "management-consulting-wMjU0",
  "technology-and-data-consulting-iNTZi",
  "design-and-applied-arts-wNDg3",
  "graphic-design-and-creative-services-jM2Ix",
]
  .map((reference) => `new_profession.sub_category_reference:${reference}`)
  .join(" OR ")

export const WELCOME_FILTER = `${CITY_FILTER} AND ${CONTRACT_FILTER} AND (${PROFESSION_FILTER})`
export const WELCOME_PAGE_SIZE = 100
export const WELCOME_MAX_PAGES = 4

const ATS_URL = /https?:\/\/[^\s"'<>]+(?:greenhouse\.io|ashbyhq\.com|jobs\.lever\.co|lever\.co)\/[^\s"'<>]+/i
const TARGET_CITY = /new york|brooklyn|manhattan|chicago|boston|miami|austin/i

export interface WelcomeOffice {
  city?: string | null
  country?: string | null
  country_code?: string | null
}

export interface WelcomeHit {
  name?: string
  slug?: string
  reference?: string
  objectID?: string
  summary?: string | null
  key_missions?: string[] | null
  contract_type?: string | null
  remote?: string | null
  experience_level_minimum?: number | null
  published_at?: string | null
  offices?: WelcomeOffice[] | null
  organization?: { name?: string; slug?: string; summary?: string | null } | null
  sectors?: { parent_name?: string; name?: string }[] | null
  new_profession?: { sub_category_name?: string } | null
}

interface AlgoliaConfig {
  appId: string
  apiKey: string
  indexName: string
}

export function readWelcomeConfig(html: string): AlgoliaConfig | null {
  const match = html.match(/window\.env\s*=\s*(\{.*?\})\s*(?:\n|window\.)/)
  if (!match) return null
  try {
    const env = JSON.parse(match[1]) as {
      ALGOLIA_APPLICATION_ID?: string
      ALGOLIA_API_KEY_CLIENT?: string
      ALGOLIA_JOBS_INDEX_PREFIX?: string
    }
    if (!env.ALGOLIA_APPLICATION_ID || !env.ALGOLIA_API_KEY_CLIENT || !env.ALGOLIA_JOBS_INDEX_PREFIX) return null
    return {
      appId: env.ALGOLIA_APPLICATION_ID,
      apiKey: env.ALGOLIA_API_KEY_CLIENT,
      indexName: `${env.ALGOLIA_JOBS_INDEX_PREFIX}_en`,
    }
  } catch {
    return null
  }
}

function experienceSentence(years: number | null | undefined): string | null {
  if (years == null || Number.isNaN(years)) return null
  if (years <= 0) return "0 years of experience."
  if (years < 1) return "Less than 1 year of experience."
  if (years === 1) return "1 year of experience."
  if (years === 2) return "2 years of experience."
  return `${Math.round(years)}+ years of experience required.`
}

function arrangement(remote: string | null | undefined): string | undefined {
  if (remote === "fulltime") return "Remote"
  if (remote === "partial" || remote === "punctual") return "Hybrid"
  if (remote === "no") return "On-site"
  return undefined
}

function locationRaw(offices: WelcomeOffice[] | null | undefined): string {
  const places = (offices ?? []).map((office) => office.city?.trim()).filter((city): city is string => Boolean(city))
  const matching = places.filter((city) => TARGET_CITY.test(city))
  return [...new Set(matching.length > 0 ? matching : places)].join(" · ")
}

function directApply(text: string, fallback: string): string {
  const match = text.match(ATS_URL)
  return match ? match[0].replace(/[),.;]+$/, "") : fallback
}

export function welcomeHitsToPostings(hits: WelcomeHit[], now: Date): RawPosting[] {
  const postings: RawPosting[] = []
  for (const hit of hits) {
    const title = hit.name?.trim()
    const companyName = hit.organization?.name?.trim()
    const reference = hit.reference || hit.objectID
    if (!title || !companyName || !reference) continue
    const orgSlug = hit.organization?.slug
    const sourceUrl = orgSlug && hit.slug
      ? `https://www.welcometothejungle.com/en/companies/${orgSlug}/jobs/${hit.slug}`
      : `https://www.welcometothejungle.com/en/jobs/${reference}`
    const missions = (hit.key_missions ?? []).filter(Boolean).map((mission) => `• ${mission}`)
    const years = experienceSentence(hit.experience_level_minimum)
    const description = [hit.summary?.trim(), ...missions, years].filter(Boolean).join("\n")
    const contract = hit.contract_type ?? ""
    const employmentType = /intern|apprentice/i.test(contract)
      ? "Internship"
      : contract === "full_time" || contract === "graduate_program"
        ? "Full-time"
        : contract || "Full-time"
    postings.push({
      id: `welcome:${reference}`,
      release: "search",
      source: "welcome_to_the_jungle",
      sourceUrl,
      applicationUrl: directApply(description, sourceUrl),
      externalId: reference,
      companyName,
      industry: hit.sectors?.[0]?.parent_name || hit.sectors?.[0]?.name,
      discoveredFrom: "welcome_to_the_jungle",
      title,
      description: description.length > 12_000 ? description.slice(0, 12_000) : description,
      locationRaw: locationRaw(hit.offices),
      arrangementRaw: arrangement(hit.remote),
      employmentType,
      postedDaysAgo: postedDaysAgo(hit.published_at, now),
    })
  }
  return postings
}

export async function fetchWelcomePage(
  client: HttpClient,
  config: AlgoliaConfig,
  page: number,
): Promise<WelcomeHit[]> {
  if (!client.postJson) throw new Error("search client cannot post")
  const payload = await client.postJson<{ hits?: WelcomeHit[] }>(
    `https://${config.appId}-dsn.algolia.net/1/indexes/${config.indexName}/query`,
    { query: "", hitsPerPage: WELCOME_PAGE_SIZE, page, filters: WELCOME_FILTER },
    {
      "X-Algolia-Application-Id": config.appId,
      "X-Algolia-API-Key": config.apiKey,
      Referer: "https://www.welcometothejungle.com/en/jobs",
    },
  )
  return payload.hits ?? []
}
