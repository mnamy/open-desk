import { EmptyState } from "@/components/empty-state"
import { FeedNav } from "@/components/feed-nav"
import { Filters } from "@/components/filters"
import { JobCard } from "@/components/job-card"
import { RunSearchButton } from "@/components/run-search"
import { getDb } from "@/lib/db/client"
import { latestSearchRun, listDeskJobs, type DeskJob } from "@/lib/db/repository"
import { FEEDS, jobInFeed, type FeedId } from "@/lib/jobs/feeds"
import { emptyCopy, filterOptions, hasActiveFilters, parseFeed, runSummary, toCard, visibleJobs, type DeskFilters } from "@/lib/jobs/view"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

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

  const db = await getDb()
  const [jobs, run] = await Promise.all([listDeskJobs(db), latestSearchRun(db)])
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
        <RunSearchButton />
      </header>

      <p className="text-sm leading-6 text-muted-foreground">{runSummary(run)}</p>

      <FeedNav feed={feed} counts={counts} query={query.toString()} />

      <p className="text-sm leading-6 text-muted-foreground">
        Fit is how much the work resembles what you want. Risk is how much of a stretch applying would be. Risk does
        not change the order.
      </p>

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
