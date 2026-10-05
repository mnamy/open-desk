import { parseExperience, type ExperienceParse } from "@/lib/jobs/experience"
import { normalizeCity, type AllowedCity } from "@/lib/jobs/location"
import { isWrongProfession } from "@/lib/jobs/relevance"
import { inferRoleFamily } from "@/lib/jobs/role-family"
import { parseWorkArrangement, type WorkArrangement } from "@/lib/jobs/work-arrangement"

export type FeedBucket = "main" | "stretch" | "excluded"
export type ExclusionReason = "location" | "remote" | "experience" | "relevance"

export interface HardFilterResult {
  city: AllowedCity | null
  workArrangement: WorkArrangement
  experience: ExperienceParse
  roleFamily: string
  feedBucket: FeedBucket
  exclusionReason: ExclusionReason | null
}

export function evaluateHardFilters(input: {
  title: string
  description: string
  locationRaw: string
  arrangementRaw?: string | null
}): HardFilterResult {
  const city = normalizeCity(input.locationRaw)
  const workArrangement = parseWorkArrangement({
    arrangementRaw: input.arrangementRaw,
    locationRaw: input.locationRaw,
    description: input.description,
  })
  const experience = parseExperience({ title: input.title, description: input.description })
  const roleFamily = inferRoleFamily(input.title, input.description)

  let feedBucket: FeedBucket = "main"
  let exclusionReason: ExclusionReason | null = null

  if (!city) {
    feedBucket = "excluded"
    exclusionReason = "location"
  } else if (workArrangement === "remote") {
    feedBucket = "excluded"
    exclusionReason = "remote"
  } else if (experience.bucket === "reject") {
    feedBucket = "excluded"
    exclusionReason = "experience"
  } else if (isWrongProfession(input.title, input.description)) {
    feedBucket = "excluded"
    exclusionReason = "relevance"
  } else if (experience.bucket === "stretch") {
    feedBucket = "stretch"
  }

  return { city, workArrangement, experience, roleFamily, feedBucket, exclusionReason }
}
