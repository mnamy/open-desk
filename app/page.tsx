import Link from "next/link"
import { EmptyState } from "@/components/empty-state"
import { FeedNav } from "@/components/feed-nav"
import { Filters } from "@/components/filters"
import { JobCard } from "@/components/job-card"
import { AddJobButton } from "@/components/add-job"
import { LearnedPreferences } from "@/components/learned-preferences"
import { RunSearchButton } from "@/components/run-search"
import { buttonVariants } from "@/components/ui/button"
import { getDb } from "@/lib/db/client"
import { sanitizeDbError } from "@/lib/db/postgres-url.mjs"
import { latestSearchRun, listDeskJobs, listFeedback, preferenceResetAt, type DeskJob } from "@/lib/db/repository"
import { FEEDS, jobInFeed, type FeedId } from "@/lib/jobs/feeds"
import {
  annotatePreferences,
  emptyCopy,
  filterOptions,
  hasActiveFilters,
  parseFeed,
  runSummary,
  toCard,
  visibleJobs,
  type DeskFilters,
} from "@/lib/jobs/view"
import { summarizeWarnings } from "@/lib/sources/warnings"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

function SourceWarnings({ warnings }: { warnings: string[] }) {
  const summary = summarizeWarnings(warnings)
  return (
    <details className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-950">
      <summary className="cursor-pointer font-medium">{summary.headline}</summary>
      <ul className="mt-2 list-disc pl-5">
        {summary.groups.map((group) => (
          <li key={group.label}>
            {group.label}: {group.count}
          </li>
        ))}
      </ul>
      <details className="mt-2">
        <summary className="cursor-pointer text-muted-foreground">Technical details</summary>
        <ul className="mt-1 max-h-48 list-disc overflow-auto pl-5 font-mono text-xs leading-5 text-muted-foreground">
          {warnings.map((warning, index) => (
            <li key={`${warning}-${index}`}>{warning}</li>
          ))}
        </ul>
      </details>
    </details>
  )
}

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function countFeeds(jobs: DeskJob[]): Record<FeedId, number> {
  const counts = Object.fromEntries(FEEDS.map((feed) => [feed.id, 0])) as Record<FeedId, number>
  for (const job of jobs) {
    for (const feed of FEEDS) {
      if (jobInFeed(job, feed.id)) counts[feed.id] += 1
    }
  }
  return counts
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const feed = parseFeed(one(params.feed))
  const filters: DeskFilters = {
    city: one(params.city),
    role: one(params.role),
    industry: one(params.industry),
    company: one(params.company),
    source: one(params.source),
    posted: one(params.posted),
    fit: one(params.fit),
    risk: one(params.risk),
  }
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries({ feed: one(params.feed), ...filters })) {
    if (value) query.set(key, value)
  }

  let db
  try {
    db = await getDb()
  } catch (error) {
    const message = sanitizeDbError(error)
    console.error(message)
    return (
      <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center gap-4 px-4 py-16">
        <h1 className="font-heading text-4xl">Open Desk could not load.</h1>
        <p className="max-w-md text-sm leading-6 text-muted-foreground">{message}</p>
        <div>
          <Link className={buttonVariants()} href="/">
            Try again
          </Link>
        </div>
      </main>
    )
  }
  const [loaded, run, feedback, resetAt] = await Promise.all([
    listDeskJobs(db),
    latestSearchRun(db),
    listFeedback(db),
    preferenceResetAt(db),
  ])
  const learned = annotatePreferences(loaded, feedback, resetAt)
  const jobs = learned.jobs
  const now = new Date()
  const counts = countFeeds(jobs)
  const shown = visibleJobs(jobs, feed, filters, now)
  const options = filterOptions(jobs)
  const filtered = hasActiveFilters(filters)
  const empty = emptyCopy(feed, filtered)
  const label = FEEDS.find((item) => item.id === feed)?.label ?? "Top picks"

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:py-10">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-xl">
          <p className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">Personal desk</p>
          <h1 className="mt-1 font-heading text-4xl tracking-tight sm:text-5xl">Open Desk</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
            Entry-level roles worth wanting in New York, Chicago, Boston, Miami, and Austin. On-site or hybrid.
            Remote-only stays out.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <RunSearchButton />
          <AddJobButton />
        </div>
      </header>

      <p className="text-sm leading-6 text-muted-foreground">{runSummary(run)}</p>
      {run && run.warnings.length > 0 ? <SourceWarnings warnings={run.warnings} /> : null}

      <FeedNav feed={feed} counts={counts} query={query.toString()} />

      <p className="text-sm leading-6 text-muted-foreground">
        Fit is how much the work resembles what you want. Risk is how much of a stretch applying would be. Risk does
        not change the order. Learned preferences can reorder eligible roles. They do not change which roles are allowed
        on the desk.
      </p>

      <LearnedPreferences summary={learned.summary} />

      <Filters values={filters} options={options} />

      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-heading text-2xl">{label}</h2>
        <p className="text-sm text-muted-foreground">
          {shown.length} {shown.length === 1 ? "role" : "roles"}
          {filtered ? ` of ${counts[feed]}` : ""}
        </p>
      </div>

      {shown.length === 0 ? (
        <EmptyState title={empty.title} body={empty.body} />
      ) : (
        <div className="flex flex-col gap-4">
          {shown.map((job) => (
            <JobCard key={job.id} job={toCard(job, now)} />
          ))}
        </div>
      )}
    </main>
  )
}
