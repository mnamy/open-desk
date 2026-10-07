import type { JobFeatures } from "@/lib/llm/schema"

/** Semantic features can nudge rank. They cannot change eligibility. */
export const SEMANTIC_CAP = 4

export interface AuthoritativeJob {
  feedBucket: "main" | "stretch" | "excluded"
  opportunityFit: number | null
  exclusionReason: string | null
  actions: string[]
}

export function semanticDelta(features: JobFeatures | null, feedBucket: string): number {
  if (!features || feedBucket === "excluded") return 0
  const aligned =
    0.16 * features.ownership +
    0.12 * features.strategy_exposure +
    0.12 * features.decision_making +
    0.1 * features.experimentation +
    0.08 * features.cross_functional +
    0.08 * features.user_interaction +
    0.1 * features.growth_exposure +
    0.08 * features.operations_exposure +
    0.1 * features.research_exposure +
    0.06 * features.product_exposure
  const drag =
    0.34 * features.sales_intensity +
    0.28 * features.administrative_intensity +
    0.24 * features.technical_intensity +
    0.14 * features.people_management
  const raw = (aligned - drag) * SEMANTIC_CAP * 2
  return Math.round(Math.max(-SEMANTIC_CAP, Math.min(SEMANTIC_CAP, raw)) * 10) / 10
}

export function keepAuthoritative<T extends AuthoritativeJob>(job: T, features: JobFeatures | null): T & { semanticDelta: number } {
  return {
    ...job,
    feedBucket: job.feedBucket,
    opportunityFit: job.opportunityFit,
    exclusionReason: job.exclusionReason,
    actions: [...job.actions],
    semanticDelta: semanticDelta(features, job.feedBucket),
  }
}
