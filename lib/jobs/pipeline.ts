import { createHash } from "node:crypto"
import { dedupePostings, type SourcePosting } from "@/lib/jobs/dedup"
import { evaluateHardFilters, type ExclusionReason, type FeedBucket } from "@/lib/jobs/evaluate"
import type { Classification, JobClassifier } from "@/lib/llm/types"
import { classifyDeterministic } from "@/lib/scoring/score"
import type { RawPosting } from "@/lib/sources/types"
import { normalizeCompanyName, normalizeTitle } from "@/lib/jobs/text"

export interface ProcessedSource {
  source: string
  sourceUrl: string
  applicationUrl: string
  externalId: string | null
}

export interface ProcessedJob {
  fingerprint: string
  companyName: string
  normalizedCompany: string
  companyWebsite: string | null
  careersUrl: string | null
  atsProvider: string | null
  atsIdentifier: string | null
  industry: string | null
  discoveredFrom: string | null
  title: string
  normalizedTitle: string
  roleFamily: string
  description: string
  locationRaw: string
  normalizedCity: string | null
  workArrangement: string
  experienceMin: number | null
  experienceMax: number | null
  experienceRequiredOrPreferred: string
  experienceLabel: string
  employmentType: string | null
  postedAt: Date | null
  applicationUrl: string
  canonicalUrl: string
  source: string
  sourceUrl: string
  feedBucket: FeedBucket
  exclusionReason: ExclusionReason | null
  status: "active" | "excluded"
  contentHash: string | null
  opportunityFit: number | null
  qualificationRisk: string | null
  whyMatch: string | null
  stretchReason: string | null
  sources: ProcessedSource[]
}

function fingerprintFor(parts: {
  companyName: string
  title: string
  city: string | null
  description: string
}): string {
  const payload = [
    normalizeCompanyName(parts.companyName),
    normalizeTitle(parts.title),
    parts.city ?? "",
    parts.description.toLowerCase().replace(/\s+/g, " ").trim(),
  ].join("\n")
  return createHash("sha256").update(payload).digest("hex")
}

function postedAtFrom(daysAgo: number | null, now: Date): Date | null {
  if (daysAgo === null || daysAgo === undefined) return null
  const posted = new Date(now.getTime() - daysAgo * 86_400_000)
  return posted
}

function blankFrom(raw: RawPosting): {
  companyWebsite: string | null
  careersUrl: string | null
  atsProvider: string | null
  atsIdentifier: string | null
  industry: string | null
  discoveredFrom: string | null
  employmentType: string | null
  locationRaw: string
  arrangementRaw?: string
} {
  return {
    companyWebsite: raw.companyWebsite ?? null,
    careersUrl: raw.careersUrl ?? null,
    atsProvider: raw.atsProvider ?? null,
    atsIdentifier: raw.externalId ?? null,
    industry: raw.industry ?? null,
    discoveredFrom: raw.discoveredFrom ?? "sample import",
    employmentType: raw.employmentType ?? "Full-time",
    locationRaw: raw.locationRaw,
    arrangementRaw: raw.arrangementRaw,
  }
}

export async function processPostings(
  rawPostings: RawPosting[],
  now = new Date(),
  classify?: JobClassifier["classify"],
): Promise<ProcessedJob[]> {
  const prepared = rawPostings.map((raw) => {
    const preview = evaluateHardFilters({
      title: raw.title,
      description: raw.description,
      locationRaw: raw.locationRaw,
      arrangementRaw: raw.arrangementRaw,
    })
    return { raw, city: preview.city }
  })

  const groups = dedupePostings(
    prepared.map(({ raw, city }) => {
      const posting: SourcePosting = {
        companyName: raw.companyName,
        title: raw.title,
        city,
        description: raw.description,
        source: raw.source,
        sourceUrl: raw.sourceUrl,
        applicationUrl: raw.applicationUrl,
        externalId: raw.externalId ?? null,
        atsProvider: raw.atsProvider ?? null,
      }
      return posting
    }),
  )

  const jobs: ProcessedJob[] = []

  for (const group of groups) {
    const members = group.postings.map((posting) => {
      return prepared.find(
        (item) =>
          item.raw.sourceUrl === posting.sourceUrl &&
          item.raw.applicationUrl === posting.applicationUrl &&
          item.raw.title === posting.title,
      )!
    })
    const winner =
      members.find(
        (item) => item.raw.applicationUrl === group.applicationUrl && item.raw.source === group.canonicalSource,
      ) ?? members[0]
    const raw = winner.raw
    const evaluation = evaluateHardFilters({
      title: raw.title,
      description: raw.description,
      locationRaw: raw.locationRaw,
      arrangementRaw: raw.arrangementRaw,
    })
    const companyBits = members.map((item) => blankFrom(item.raw))
    const merged = companyBits.reduce((acc, bits) => ({
      companyWebsite: acc.companyWebsite ?? bits.companyWebsite,
      careersUrl: acc.careersUrl ?? bits.careersUrl,
      atsProvider: acc.atsProvider ?? bits.atsProvider,
      atsIdentifier: acc.atsIdentifier ?? bits.atsIdentifier,
      industry: acc.industry ?? bits.industry,
      discoveredFrom: acc.discoveredFrom ?? bits.discoveredFrom,
      employmentType: acc.employmentType ?? bits.employmentType,
      locationRaw: raw.locationRaw,
      arrangementRaw: raw.arrangementRaw,
    }))

    let classification: Classification | null = null
    if (evaluation.feedBucket !== "excluded") {
      const input = {
        companyName: raw.companyName,
        title: raw.title,
        description: raw.description,
        city: evaluation.city,
        workArrangement: evaluation.workArrangement,
        experienceLabel: evaluation.experience.label,
        experienceBucket: evaluation.experience.bucket,
        requiredOrPreferred: evaluation.experience.requiredOrPreferred,
        industry: merged.industry,
        roleFamily: evaluation.roleFamily,
      }
      classification = classify ? await classify(input) : classifyDeterministic(input)
    }

    jobs.push({
      fingerprint: fingerprintFor({
        companyName: raw.companyName,
        title: raw.title,
        city: evaluation.city,
        description: raw.description,
      }),
      companyName: raw.companyName,
      normalizedCompany: normalizeCompanyName(raw.companyName),
      companyWebsite: merged.companyWebsite,
      careersUrl: merged.careersUrl,
      atsProvider: merged.atsProvider,
      atsIdentifier: merged.atsIdentifier,
      industry: merged.industry,
      discoveredFrom: merged.discoveredFrom,
      title: raw.title,
      normalizedTitle: normalizeTitle(raw.title),
      roleFamily: classification?.roleFamily ?? evaluation.roleFamily,
      description: raw.description,
      locationRaw: raw.locationRaw,
      normalizedCity: evaluation.city,
      workArrangement: evaluation.workArrangement,
      experienceMin: evaluation.experience.experienceMin,
      experienceMax: evaluation.experience.experienceMax,
      experienceRequiredOrPreferred: evaluation.experience.requiredOrPreferred,
      experienceLabel: evaluation.experience.label,
      employmentType: merged.employmentType,
      postedAt: postedAtFrom(raw.postedDaysAgo, now),
      applicationUrl: group.applicationUrl,
      canonicalUrl: group.applicationUrl,
      source: group.canonicalSource,
      sourceUrl: group.canonicalSourceUrl,
      feedBucket: evaluation.feedBucket,
      exclusionReason: evaluation.exclusionReason,
      status: evaluation.feedBucket === "excluded" ? "excluded" : "active",
      contentHash: classification?.contentHash ?? null,
      opportunityFit: classification?.opportunityFit ?? null,
      qualificationRisk: classification?.qualificationRisk ?? null,
      whyMatch: classification?.whyMatch ?? null,
      stretchReason: classification?.stretchReason ?? null,
      sources: group.postings.map((posting) => ({
        source: posting.source,
        sourceUrl: posting.sourceUrl,
        applicationUrl: posting.applicationUrl,
        externalId: posting.externalId ?? null,
      })),
    })
  }

  return jobs
}
