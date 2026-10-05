import { assessEligibility, type EligibilityDecision, type ExclusionReason } from "@/lib/jobs/eligibility"
import { parseExperience, type ExperienceParse } from "@/lib/jobs/experience"
import { normalizeCity, type AllowedCity } from "@/lib/jobs/location"
import { parseWorkArrangement, type WorkArrangement } from "@/lib/jobs/work-arrangement"

export type { ExclusionReason }
export type FeedBucket = "main" | "stretch" | "excluded"

export interface HardFilterResult {
  city: AllowedCity | null
  workArrangement: WorkArrangement
  experience: ExperienceParse
  roleFamily: string
  tier: EligibilityDecision["tier"]
  levelSignal: EligibilityDecision["levelSignal"]
  tags: EligibilityDecision["tags"]
  feedBucket: FeedBucket
  exclusionReason: ExclusionReason | null
}

export function evaluateHardFilters(input: {
  title: string
  description: string
  locationRaw: string
  arrangementRaw?: string | null
  employmentType?: string | null
}): HardFilterResult {
  const city = normalizeCity(input.locationRaw)
  const workArrangement = parseWorkArrangement({
    arrangementRaw: input.arrangementRaw,
    locationRaw: input.locationRaw,
    description: input.description,
  })
  const experience = parseExperience({ title: input.title, description: input.description })
  const decision = assessEligibility({
    title: input.title,
    description: input.description,
    employmentType: input.employmentType,
    experience,
  })

  let feedBucket: FeedBucket = decision.feedBucket
  let exclusionReason = decision.exclusionReason

  if (!city) {
    feedBucket = "excluded"
    exclusionReason = "location"
  } else if (workArrangement === "remote") {
    feedBucket = "excluded"
    exclusionReason = "remote"
  }

  return {
    city,
    workArrangement,
    experience,
    roleFamily: decision.roleFamily,
    tier: decision.tier,
    levelSignal: decision.levelSignal,
    tags: decision.tags,
    feedBucket,
    exclusionReason,
  }
}
