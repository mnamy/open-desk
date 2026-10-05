import { descriptionSimilarity, normalizeCompanyName, normalizeTitle, normalizeUrl } from "@/lib/jobs/text"

export interface SourcePosting {
  companyName: string
  title: string
  city: string | null
  description: string
  source: string
  sourceUrl: string
  applicationUrl: string
  externalId?: string | null
  atsProvider?: string | null
}

export interface DedupedGroup {
  postings: SourcePosting[]
  applicationUrl: string
  canonicalSource: string
  canonicalSourceUrl: string
  description: string
  title: string
  companyName: string
  city: string | null
}

const ATS_HOSTS = [
  "greenhouse.io",
  "ashbyhq.com",
  "lever.co",
  "workable.com",
  "smartrecruiters.com",
  "myworkdayjobs.com",
  "bamboohr.com",
  "jobvite.com",
  "breezy.hr",
  "pinpointhq.com",
  "teamtailor.com",
  "recruitee.com",
  "comeet.com",
  "rippling.com",
]

/** Lower is better. Company ATS / career page, then YC or other direct apply, then LinkedIn. */
export function applicationPreference(source: string, url: string): number {
  const value = url.toLowerCase()
  const src = source.toLowerCase()
  if (src === "linkedin" || value.includes("linkedin.com")) return 30
  if (ATS_HOSTS.some((host) => value.includes(host))) return 10
  if (src === "career_page" || /\/(careers|jobs|openings|open-roles)\b/.test(value)) return 10
  if (src === "yc" || value.includes("workatastartup.com") || value.includes("ycombinator.com")) return 20
  return 20
}

function samePosting(a: SourcePosting, b: SourcePosting): boolean {
  if (
    a.externalId &&
    b.externalId &&
    a.externalId === b.externalId &&
    a.atsProvider &&
    b.atsProvider &&
    a.atsProvider === b.atsProvider
  ) {
    return true
  }

  if (normalizeUrl(a.applicationUrl) === normalizeUrl(b.applicationUrl)) return true

  const sameCompany = normalizeCompanyName(a.companyName) === normalizeCompanyName(b.companyName)
  const sameTitle = normalizeTitle(a.title) === normalizeTitle(b.title)
  const sameCity = (a.city ?? "") === (b.city ?? "")
  if (!sameCompany || !sameTitle || !sameCity) return false
  return descriptionSimilarity(a.description, b.description) >= 0.5
}

function toGroup(postings: SourcePosting[]): DedupedGroup {
  const ranked = [...postings].sort((a, b) => {
    const preference =
      applicationPreference(a.source, a.applicationUrl) - applicationPreference(b.source, b.applicationUrl)
    if (preference !== 0) return preference
    return b.description.length - a.description.length
  })
  const best = ranked[0]
  return {
    postings,
    applicationUrl: best.applicationUrl,
    canonicalSource: best.source,
    canonicalSourceUrl: best.sourceUrl,
    description: best.description,
    title: best.title,
    companyName: best.companyName,
    city: best.city,
  }
}

export function dedupePostings(postings: SourcePosting[]): DedupedGroup[] {
  const parent = postings.map((_, index) => index)
  const find = (index: number): number => {
    let current = index
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]]
      current = parent[current]
    }
    return current
  }
  const union = (a: number, b: number) => {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parent[rootB] = rootA
  }

  for (let i = 0; i < postings.length; i += 1) {
    for (let j = i + 1; j < postings.length; j += 1) {
      if (samePosting(postings[i], postings[j])) union(i, j)
    }
  }

  const groups = new Map<number, SourcePosting[]>()
  postings.forEach((posting, index) => {
    const root = find(index)
    const list = groups.get(root) ?? []
    list.push(posting)
    groups.set(root, list)
  })

  return [...groups.values()].map(toGroup)
}
