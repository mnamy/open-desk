export const SOURCE_IDS = [
  "linkedin",
  "greenhouse",
  "ashby",
  "lever",
  "yc",
  "career_page",
  "wellfound",
  "welcome_to_the_jungle",
] as const

export type SourceId = (typeof SOURCE_IDS)[number]

export interface RawPosting {
  id: string
  release: "initial" | "search"
  source: SourceId
  sourceUrl: string
  applicationUrl: string
  externalId?: string
  atsProvider?: string
  /** Company board slug, never the individual job id. */
  atsIdentifier?: string
  companyName: string
  companyWebsite?: string
  careersUrl?: string
  industry?: string
  discoveredFrom?: string
  title: string
  description: string
  locationRaw: string
  arrangementRaw?: string
  employmentType?: string
  postedDaysAgo: number | null
}

export interface SourceAdapter {
  id: string
  phase: 1 | 2 | 3 | 4
  label: string
}
