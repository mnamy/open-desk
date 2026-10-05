/**
 * Phase 3 company discovery. No network calls in Milestone 1.
 * A discovered company is a row with a careers URL that a later search can recheck.
 */
export interface CompanyCandidate {
  name: string
  website?: string
  discoveredFrom:
    | "yc"
    | "directory"
    | "job_listing"
    | "manual"
    | "ecosystem"
    | "search"
    | "sample"
}

export interface CareerPagePlan {
  careersUrl: string | null
  atsProvider: string | null
  atsIdentifier: string | null
  pathsToTry: string[]
}

const CAREER_PATHS = ["/careers", "/jobs", "/openings", "/open-roles", "/join-us", "/work-with-us"]

export function planCareerCheck(candidate: CompanyCandidate & { website?: string }): CareerPagePlan {
  const website = candidate.website?.replace(/\/$/, "")
  return {
    careersUrl: website ? `${website}/careers` : null,
    atsProvider: null,
    atsIdentifier: null,
    pathsToTry: website ? CAREER_PATHS.map((path) => `${website}${path}`) : CAREER_PATHS,
  }
}
