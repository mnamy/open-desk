import { roleTier } from "@/lib/jobs/eligibility"
import { inferRoleFamily } from "@/lib/jobs/role-family"

const SHAPE: RegExp[] = [
  /\b(end to end|0\s*(?:→|to)\s*1|zero to one|ownership|own(?:s|ing)? (?:the|a|this))\b/i,
  /\b(cross-functional|partner with|product team|collaborat|stakeholder)\b/i,
  /\b(problem|solve|diagnos|figure out|investigate|process improvement)\b/i,
  /\b(strateg|roadmap|operating plan|what to build|initiative)\b/i,
  /\b(experiment(?:s|ation|ing)?|a\/b|hypothesis|test and learn)\b/i,
  /\b(users?|customers?|shoppers?|interview|talk to|engagement|activation|retention)\b/i,
  /\b(analytics|cohorts?|metrics?|dashboards?|\bdata\b|\bkpis?\b)\b/i,
  /\b(launch(?:es|ing)?|ship(?:ping)?|rollout|roll out|scal(?:e|ing))\b/i,
  /\b(ambiguous|from scratch|first version|greenfield|new ventures?)\b/i,
  /\b(decisions?|decide|recommend|founders?|prioriti[sz])\b/i,
]

export const LOCAL_INTERPRETATION_LIMIT = 5

export interface InterpretationCandidate {
  feedBucket: string
  title: string
  description: string
  roleFamily: string | null
  origin: string
}

export function shapeHits(text: string): number {
  return SHAPE.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0)
}

export function needsLocalInterpretation(input: InterpretationCandidate): boolean {
  if (input.feedBucket === "excluded") return false
  const family = inferRoleFamily(input.title, input.description)
  const tier = roleTier(family, input.title, input.description)
  const hits = shapeHits(`${input.title}\n${input.description}`)
  const external = input.origin === "external_user"
  if (family === "Other" || input.roleFamily === "Adjacent" || input.roleFamily === "Other") return true
  if (external && (tier >= 2 || hits < 4)) return true
  if (tier >= 2 && hits <= 2) return true
  if (/\b(generalist|special projects|strategic initiatives|founder'?s associate|new ventures|innovation)\b/i.test(input.title) && hits < 4) {
    return true
  }
  return false
}

export function jobsForLocalInterpretation<T extends InterpretationCandidate>(jobs: T[]): T[] {
  return jobs.filter(needsLocalInterpretation).slice(0, LOCAL_INTERPRETATION_LIMIT)
}
