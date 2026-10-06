export const FEEDS = [
  { id: "top", label: "Top picks" },
  { id: "new", label: "New" },
  { id: "all", label: "All" },
  { id: "stretch", label: "Stretch" },
  { id: "saved", label: "Saved" },
  { id: "applied", label: "Applied" },
  { id: "hidden", label: "Hidden" },
] as const

export type FeedId = (typeof FEEDS)[number]["id"]

export const TOP_PICK_MIN_FIT = 75

export interface FeedJob {
  feedBucket: "main" | "stretch" | "excluded"
  isNew: boolean
  opportunityFit: number | null
  actions: string[]
  availability?: "active" | "unavailable"
}

export function isHidden(actions: string[]): boolean {
  return actions.some((action) => action === "not_interested" || action === "hide_company" || action === "hide_role_type")
}

export function jobInFeed(job: FeedJob, feed: FeedId): boolean {
  const hidden = isHidden(job.actions)
  const closed = job.availability === "unavailable"
  if (feed === "hidden") return hidden && job.feedBucket !== "excluded"
  if (hidden || job.feedBucket === "excluded") return false
  if (feed === "saved") return job.actions.includes("save")
  if (feed === "applied") return job.actions.includes("applied")
  if (closed) return false
  if (feed === "stretch") return job.feedBucket === "stretch"
  if (job.feedBucket !== "main") return false
  if (feed === "new") return job.isNew
  if (feed === "top") return (job.opportunityFit ?? 0) >= TOP_PICK_MIN_FIT
  return true
}
