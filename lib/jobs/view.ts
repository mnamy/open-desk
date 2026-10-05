import type { DeskJob, SearchRun } from "@/lib/db/repository"
import { FEEDS, jobInFeed, type FeedId } from "@/lib/jobs/feeds"
import { formatDeskTime, freshness, matchesPostedFilter } from "@/lib/jobs/freshness"
import { sourceLabel } from "@/lib/jobs/role-family"
import { arrangementLabel } from "@/lib/jobs/work-arrangement"

export interface DeskFilters {
  city?: string
  role?: string
  industry?: string
  company?: string
  source?: string
  posted?: string
  fit?: string
  risk?: string
}

export interface FilterOptions {
  cities: string[]
  roles: string[]
  industries: string[]
  companies: string[]
  sources: { id: string; label: string }[]
}

export interface CardModel {
  id: string
  title: string
  companyName: string
  city: string
  arrangement: string
  arrangementNote: string | null
  experienceLabel: string
  roleFamily: string
  postedLine: string
  discoveredLine: string | null
  sources: string
  sourceBadges: string[]
  sample: boolean
  fit: number | null
  risk: string | null
  whyMatch: string
  stretchReason: string
  applicationUrl: string
  isNew: boolean
  saved: boolean
  applied: boolean
  hidden: boolean
}

export function parseFeed(value: string | undefined): FeedId {
  const match = FEEDS.find((feed) => feed.id === value)
  return match?.id ?? "top"
}

export function hasActiveFilters(filters: DeskFilters): boolean {
  return Object.values(filters).some((value) => value && value !== "any")
}

export function filterOptions(jobs: DeskJob[]): FilterOptions {
  const unique = (values: (string | null | undefined)[]) =>
    [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b))
  const sourceIds = unique(jobs.flatMap((job) => job.sources.map((source) => source.source)))
  return {
    cities: unique(jobs.map((job) => job.city)),
    roles: unique(jobs.map((job) => job.roleFamily)),
    industries: unique(jobs.map((job) => job.industry)),
    companies: unique(jobs.map((job) => job.companyName)),
    sources: sourceIds.map((id) => ({ id, label: sourceLabel(id) })),
  }
}

export function visibleJobs(jobs: DeskJob[], feed: FeedId, filters: DeskFilters, now = new Date()): DeskJob[] {
  return jobs
    .filter((job) => jobInFeed(job, feed))
    .filter((job) => !filters.city || filters.city === "any" || job.city === filters.city)
    .filter((job) => !filters.role || filters.role === "any" || job.roleFamily === filters.role)
    .filter((job) => !filters.industry || filters.industry === "any" || job.industry === filters.industry)
    .filter((job) => !filters.company || filters.company === "any" || job.companyName === filters.company)
    .filter((job) => !filters.source || filters.source === "any" || job.sources.some((source) => source.source === filters.source))
    .filter((job) => matchesPostedFilter(filters.posted, freshness(job.postedAt, job.firstSeenAt, now).postedFilter))
    .filter((job) => {
      if (!filters.fit || filters.fit === "any") return true
      const fit = job.opportunityFit ?? 0
      if (filters.fit === "75") return fit >= 75
      if (filters.fit === "60") return fit >= 60
      if (filters.fit === "under60") return fit < 60
      return true
    })
    .filter((job) => !filters.risk || filters.risk === "any" || job.qualificationRisk === filters.risk)
    .sort((a, b) => {
      if (feed === "new") {
        return b.firstSeenAt.getTime() - a.firstSeenAt.getTime() || (b.opportunityFit ?? 0) - (a.opportunityFit ?? 0)
      }
      return (b.opportunityFit ?? 0) - (a.opportunityFit ?? 0) || a.title.localeCompare(b.title)
    })
}

export function toCard(job: DeskJob, now = new Date()): CardModel {
  const fresh = freshness(job.postedAt, job.firstSeenAt, now)
  const labels = job.sources.map((source) => sourceLabel(source.source))
  const uniqueLabels = [...new Set(labels)]
  return {
    id: job.id,
    title: job.title,
    companyName: job.companyName,
    city: job.city ?? "City unclear",
    arrangement: arrangementLabel(job.workArrangement),
    arrangementNote:
      job.workArrangement === "unclear"
        ? `Arrangement was not stated. Kept because the office is in ${job.city}.`
        : null,
    experienceLabel: job.experienceLabel,
    roleFamily: job.roleFamily ?? "Other",
    postedLine: fresh.postedLabel ?? fresh.discoveredLabel,
    discoveredLine: fresh.postedLabel ? fresh.discoveredLabel : null,
    sources: uniqueLabels.join(" · "),
    sourceBadges: uniqueLabels,
    sample: job.sample,
    fit: job.opportunityFit,
    risk: job.qualificationRisk,
    whyMatch: job.whyMatch ?? "The posting did not include enough detail to explain the match.",
    stretchReason: job.stretchReason ?? "No stretch note was stored for this role.",
    applicationUrl: job.applicationUrl,
    isNew: job.isNew,
    saved: job.actions.includes("save"),
    applied: job.actions.includes("applied"),
    hidden: job.actions.includes("not_interested"),
  }
}

export function runSummary(run: SearchRun | null): string {
  if (!run || !run.finishedAt) {
    return "Loaded from the local sample. Run search to check Greenhouse, Ashby, Lever, YC, and company career pages."
  }
  const noun = run.jobsNew === 1 ? "role" : "roles"
  if (run.runKind !== "live") {
    return `Last search ${formatDeskTime(run.finishedAt)}. ${run.jobsNew} new ${noun}. ${run.jobsMain} on the main feed, ${run.jobsStretch} stretch, ${run.jobsExcluded} excluded.`
  }
  return [
    `Last search ${formatDeskTime(run.finishedAt)}.`,
    `Checked ${run.companiesChecked} companies and fetched ${run.postingsFetched} postings.`,
    `${run.duplicatesRemoved} duplicates removed.`,
    `Excluded ${run.excludedLocation} for location, ${run.excludedArrangement} for work arrangement, and ${run.excludedExperience} for experience.`,
    `${run.jobsMain} on the main feed, ${run.jobsStretch} stretch.`,
    `${run.jobsNew} new ${noun}.`,
  ].join(" ")
}

export function emptyCopy(feed: FeedId, filtered: boolean): { title: string; body: string } {
  if (filtered) {
    return {
      title: "Nothing matches these filters",
      body: "Clear them to see the rest of this feed. The roles are still on the desk.",
    }
  }
  switch (feed) {
    case "top":
      return {
        title: "No top picks in this view",
        body: "Top picks are main-feed roles with a fit of 75 or higher. Open All to see every entry-level role that passed.",
      }
    case "new":
      return {
        title: "No new roles",
        body: "Nothing on the main feed was first seen in the latest search. Run search to check live sources for roles that were not here before.",
      }
    case "all":
      return {
        title: "No roles on the main feed",
        body: "Nothing passed location, work arrangement, and a genuine 0–1 year bar.",
      }
    case "stretch":
      return {
        title: "No stretch roles",
        body: "Stretch is for roles that are close but ask for more than 0–1 years, usually as a preference or a 1–2 year bar.",
      }
    case "saved":
      return {
        title: "Nothing saved",
        body: "Save a role when you want it waiting here. Saving does not remove it from the other feeds.",
      }
    case "applied":
      return {
        title: "Nothing marked applied",
        body: "Mark Applied after you send one. This list is only the roles you have already put in for.",
      }
    case "hidden":
      return {
        title: "Nothing hidden",
        body: "Not interested moves a role here. Restore puts it back on the working feeds.",
      }
  }
}
