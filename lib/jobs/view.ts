import type { DeskJob, FeedbackRecord, SearchRun } from "@/lib/db/repository"
import { orderWithDiversity } from "@/lib/jobs/diversity"
import { FEEDS, jobInFeed, type FeedId } from "@/lib/jobs/feeds"
import { adjustRanking, buildProfile, summarizeProfile, type PreferenceSummary } from "@/lib/jobs/preferences"
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
  unavailable: boolean
  preferenceNote: string | null
  added: boolean
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

function rankScore(job: DeskJob): number {
  return (job.opportunityFit ?? 0) + (job.preferenceDelta ?? 0)
}

export function annotatePreferences(
  jobs: DeskJob[],
  feedback: FeedbackRecord[],
  resetAt: Date | null,
): { jobs: DeskJob[]; summary: PreferenceSummary } {
  const profile = buildProfile(
    jobs.map((job) => ({
      id: job.id,
      title: job.title,
      companyName: job.companyName,
      industry: job.industry,
      description: job.description,
      roleFamily: job.roleFamily,
      workArrangement: job.workArrangement,
      city: job.city,
    })),
    feedback.map((item) => ({
      jobId: item.jobId,
      action: item.action,
      createdAt: item.createdAt,
      reasons: item.reasons,
    })),
    resetAt,
  )
  return {
    summary: summarizeProfile(profile),
    jobs: jobs.map((job) => {
      const adjustment = adjustRanking(
        {
          id: job.id,
          title: job.title,
          companyName: job.companyName,
          industry: job.industry,
          description: job.description,
          roleFamily: job.roleFamily,
          workArrangement: job.workArrangement,
          city: job.city,
        },
        profile,
        job.opportunityFit ?? 0,
      )
      return { ...job, preferenceDelta: adjustment.delta, preferenceNote: adjustment.note }
    }),
  }
}

export function visibleJobs(jobs: DeskJob[], feed: FeedId, filters: DeskFilters, now = new Date()): DeskJob[] {
  const filtered = jobs
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
  if (feed === "top") return orderWithDiversity(filtered, rankScore)
  return filtered.sort((a, b) => {
    if (feed === "new") {
      return b.firstSeenAt.getTime() - a.firstSeenAt.getTime() || rankScore(b) - rankScore(a)
    }
    return rankScore(b) - rankScore(a) || a.title.localeCompare(b.title)
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
    unavailable: job.availability === "unavailable",
    preferenceNote: job.preferenceNote,
    added: job.origin === "external_user",
  }
}

export function runSummary(run: SearchRun | null): string {
  if (run?.status === "running") {
    return `Search in progress. Checked ${run.companiesChecked} companies and fetched ${run.postingsFetched} postings so far.`
  }
  if (!run || !run.finishedAt) {
    return "Loaded from the sample set. Run search to check Greenhouse, Ashby, Lever, YC, and company career pages."
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
        body: "Nothing on the main feed is being shown for the first time. Roles you have already seen stay in All.",
      }
    case "all":
      return {
        title: "No roles on the main feed",
        body: "Nothing passed location, work arrangement, and a genuine 0–1 year bar.",
      }
    case "stretch":
      return {
        title: "No stretch roles",
        body: "Stretch is for roles a recent graduate could still consider: a 1–2 year preference, about 2 years preferred, or an early-career level that is still ambiguous.",
      }
    case "saved":
      return {
        title: "Nothing saved",
        body: "Save a role when you want it waiting here. Saving does not remove it from the other feeds.",
      }
    case "applied":
      return {
        title: "Nothing marked applied",
        body: "Mark Applied after you send one. Applied roles leave Top picks, New, All, and Stretch, and stay on this list.",
      }
    case "hidden":
      return {
        title: "Nothing hidden",
        body: "Not interested moves a role here. Restore puts it back on the working feeds.",
      }
  }
}
