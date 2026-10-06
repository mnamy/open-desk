import { randomUUID } from "node:crypto"
import { COMPANY_SEED } from "@/data/company-seed"
import { postingsFor } from "@/data/sample-postings"
import { createClassifier } from "@/lib/llm/classifier"
import type { Classification, QualificationRisk } from "@/lib/llm/types"
import { processPostings } from "@/lib/jobs/pipeline"
import { validRejectionReasons } from "@/lib/jobs/reasons"
import { normalizeCompanyName } from "@/lib/jobs/text"
import type { RawPosting } from "@/lib/sources/types"
import { asSql, type Sql } from "@/lib/db/sql"
import { writeProcessed } from "@/lib/db/write-jobs"
import { createHttpClient, type HttpClient } from "@/lib/sources/http"
import {
  collectLivePostings,
  collectNextSlice,
  initialCursor,
  type CheckedCompany,
  type LiveCollection,
  type SearchCursor,
  type StaleBoard,
} from "@/lib/sources/live-search"
import type { SeedCompany } from "@/data/company-seed"

type Database = Parameters<typeof asSql>[0]

export type FeedbackAction = "save" | "applied" | "not_interested" | "restore"

export interface FeedbackDetail {
  reasons?: string[]
  note?: string
}

export interface FeedbackRecord {
  jobId: string
  action: string
  createdAt: Date
  note: string | null
  reasons: string[]
}

export interface DeskSource {
  source: string
  sourceUrl: string
}

export interface DeskJob {
  id: string
  title: string
  companyName: string
  industry: string | null
  city: string | null
  workArrangement: string
  experienceLabel: string
  roleFamily: string | null
  postedAt: Date | null
  firstSeenAt: Date
  applicationUrl: string
  canonicalSource: string | null
  opportunityFit: number | null
  qualificationRisk: string | null
  whyMatch: string | null
  stretchReason: string | null
  feedBucket: "main" | "stretch" | "excluded"
  isNew: boolean
  sample: boolean
  sources: DeskSource[]
  actions: string[]
  firstSurfacedAt: Date | null
  lastSeenAt: Date
  availability: "active" | "unavailable"
  description: string
  origin: string
  preferenceDelta: number
  preferenceNote: string | null
}

export interface SearchRun {
  id: string
  startedAt: Date
  finishedAt: Date | null
  jobsSeen: number
  jobsNew: number
  jobsMain: number
  jobsStretch: number
  jobsExcluded: number
  companiesChecked: number
  postingsFetched: number
  duplicatesRemoved: number
  excludedLocation: number
  excludedArrangement: number
  excludedExperience: number
  warnings: string[]
  runKind: "sample" | "live"
  status: "running" | "complete"
}

export interface ImportSummary {
  jobsSeen: number
  jobsNew: number
  jobsMain: number
  jobsStretch: number
  jobsExcluded: number
  companiesChecked: number
  postingsFetched: number
  duplicatesRemoved: number
  excludedLocation: number
  excludedArrangement: number
  excludedExperience: number
  warnings: string[]
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  return value instanceof Date ? value : new Date(value)
}

function asNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  return typeof value === "number" ? value : Number(value)
}

export async function importLiveSearch(input: Database, now = new Date()): Promise<ImportSummary> {
  const db = asSql(input)
  const saved = await listSavedCompanies(db)
  const disabled = await disabledBoardKeys(db)
  const collected = await collectLivePostings({
    companies: withoutDisabledBoards(mergeSeedCompanies(COMPANY_SEED, saved), disabled),
    disabledBoards: disabled,
    client: createHttpClient({ cache: sourceCache(db) }),
    now,
  })
  return importPostings(db, "search", now, collected)
}

export async function importPostings(
  input: Database,
  mode: "seed" | "search",
  now = new Date(),
  live?: LiveCollection,
): Promise<ImportSummary> {
  const db = asSql(input)
  const classifier = createClassifier({
    async get(hash) {
      const result = await db.query<{
        content_hash: string
        opportunity_fit: number
        qualification_risk: QualificationRisk
        why_match: string
        stretch_reason: string
        role_family: string | null
      }>("SELECT * FROM classification_cache WHERE content_hash = $1", [hash])
      const row = result.rows[0]
      if (!row) return null
      return {
        contentHash: row.content_hash,
        opportunityFit: row.opportunity_fit,
        qualificationRisk: row.qualification_risk,
        whyMatch: row.why_match,
        stretchReason: row.stretch_reason,
        roleFamily: row.role_family ?? "",
      }
    },
    async set(value: Classification) {
      await db.query(
        `INSERT INTO classification_cache (
          content_hash, opportunity_fit, qualification_risk, why_match, stretch_reason, role_family
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (content_hash) DO NOTHING`,
        [value.contentHash, value.opportunityFit, value.qualificationRisk, value.whyMatch, value.stretchReason, value.roleFamily],
      )
    },
  })

  const rawPostings = live?.postings ?? postingsFor(mode)
  const processed = await processPostings(rawPostings, now, (input) => classifier.classify(input))
  const summary: ImportSummary = {
    jobsSeen: processed.length,
    jobsNew: 0,
    jobsMain: processed.filter((job) => job.feedBucket === "main").length,
    jobsStretch: processed.filter((job) => job.feedBucket === "stretch").length,
    jobsExcluded: processed.filter((job) => job.feedBucket === "excluded").length,
    companiesChecked: live?.companiesChecked ?? 0,
    postingsFetched: rawPostings.length,
    duplicatesRemoved: Math.max(rawPostings.length - processed.length, 0),
    excludedLocation: processed.filter((job) => job.exclusionReason === "location").length,
    excludedArrangement: processed.filter((job) => job.exclusionReason === "remote").length,
    excludedExperience: processed.filter((job) => job.exclusionReason === "experience").length,
    warnings: live?.warnings ?? [],
  }

  summary.jobsNew = await db.transaction(async (tx) => {
    if (mode === "search") await tx.query("UPDATE jobs SET is_new = FALSE")
    const inserted = await writeProcessed(tx, processed, now, { markNew: mode === "search", live: Boolean(live) })
    summary.jobsNew = inserted
    if (live) {
      await saveCheckedCompanies(tx, live.checkedCompanies, now)
      await disableStaleBoards(tx, live.staleBoards ?? [])
      await retireUnseen(tx, healthyNames(live.checkedCompanies), now)
    }
    if (mode === "search") {
      const finished = new Date()
      await tx.query(
        `INSERT INTO search_runs (
          id, started_at, finished_at, jobs_seen, jobs_new, jobs_main, jobs_stretch, jobs_excluded,
          companies_checked, postings_fetched, duplicates_removed, excluded_location, excluded_arrangement,
          excluded_experience, warnings, run_kind
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          randomUUID(),
          now.toISOString(),
          finished.toISOString(),
          summary.jobsSeen,
          summary.jobsNew,
          summary.jobsMain,
          summary.jobsStretch,
          summary.jobsExcluded,
          summary.companiesChecked,
          summary.postingsFetched,
          summary.duplicatesRemoved,
          summary.excludedLocation,
          summary.excludedArrangement,
          summary.excludedExperience,
          summary.warnings.join("\n"),
          live ? "live" : "sample",
        ],
      )
      logSourceWarnings(summary.warnings)
    }
    return inserted
  })
  return summary
}

export async function continueLiveSearch(
  input: Database,
  options?: { now?: Date; client?: HttpClient; companies?: SeedCompany[]; fetchYc?: boolean; fetchMarketplaces?: boolean },
): Promise<{ done: boolean; progress: string }> {
  const db = asSql(input)
  const now = options?.now ?? new Date()
  let run = await loadRunningSearch(db)
  if (!run) {
    const disabled = await disabledBoardKeys(db)
    const companies = withoutDisabledBoards(
      options?.companies ?? mergeSeedCompanies(COMPANY_SEED, await listSavedCompanies(db)),
      disabled,
    )
    run = await startLiveSearch(db, initialCursor(companies, disabled), now)
  }
  const client = options?.client ?? createHttpClient({ cache: sourceCache(db) })
  const slice = await collectNextSlice({
    cursor: run.cursor,
    client,
    now,
    fetchYc: options?.fetchYc,
    fetchMarketplaces: options?.fetchMarketplaces,
  })
  const processed = await processPostings(slice.collection.postings, now, (job) =>
    createClassifier({
      async get(hash) {
        const result = await db.query<{
          content_hash: string
          opportunity_fit: number
          qualification_risk: QualificationRisk
          why_match: string
          stretch_reason: string
          role_family: string | null
        }>("SELECT * FROM classification_cache WHERE content_hash = $1", [hash])
        const row = result.rows[0]
        if (!row) return null
        return {
          contentHash: row.content_hash,
          opportunityFit: row.opportunity_fit,
          qualificationRisk: row.qualification_risk,
          whyMatch: row.why_match,
          stretchReason: row.stretch_reason,
          roleFamily: row.role_family ?? "",
        }
      },
      async set(value: Classification) {
        await db.query(
          `INSERT INTO classification_cache (
            content_hash, opportunity_fit, qualification_risk, why_match, stretch_reason, role_family
          ) VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (content_hash) DO NOTHING`,
          [value.contentHash, value.opportunityFit, value.qualificationRisk, value.whyMatch, value.stretchReason, value.roleFamily],
        )
      },
    }).classify(job),
  )
  const done = slice.cursor.phase === "done"
  await db.transaction(async (tx) => {
    await writeProcessed(tx, processed, now, { markNew: true, runId: run.id, live: true })
    if (slice.collection.checkedCompanies.length > 0) {
      await saveCheckedCompanies(tx, slice.collection.checkedCompanies, now)
    }
    await disableStaleBoards(tx, slice.collection.staleBoards)
    const healthy = [
      ...new Set([...(run.cursor.healthyCompanies ?? []), ...healthyNames(slice.collection.checkedCompanies)]),
    ]
    if (done) await retireUnseen(tx, healthy, run.startedAt)
    const counts = await tx.query<{
      seen: number
      main: number
      stretch: number
      excluded: number
      location: number
      arrangement: number
      experience: number
      fresh: number
    }>(
      `SELECT
        COUNT(*)::int AS seen,
        COUNT(*) FILTER (WHERE feed_bucket = 'main')::int AS main,
        COUNT(*) FILTER (WHERE feed_bucket = 'stretch')::int AS stretch,
        COUNT(*) FILTER (WHERE feed_bucket = 'excluded')::int AS excluded,
        COUNT(*) FILTER (WHERE exclusion_reason = 'location')::int AS location,
        COUNT(*) FILTER (WHERE exclusion_reason = 'remote')::int AS arrangement,
        COUNT(*) FILTER (WHERE exclusion_reason = 'experience')::int AS experience,
        COUNT(*) FILTER (WHERE is_new)::int AS fresh
      FROM search_run_jobs WHERE run_id = $1`,
      [run.id],
    )
    const tally = counts.rows[0]
    const previous = await tx.query<{ warnings: string | null }>("SELECT warnings FROM search_runs WHERE id = $1", [run.id])
    const warnings = [...(previous.rows[0]?.warnings?.split("\n").filter(Boolean) ?? []), ...slice.collection.warnings]
    const postingsFetched = run.postingsFetched + slice.collection.postings.length
    const companiesChecked = run.companiesChecked + slice.collection.companiesChecked
    await tx.query(
      `UPDATE search_runs SET
        plan = $2,
        step_index = step_index + 1,
        companies_checked = $3,
        postings_fetched = $4,
        jobs_seen = $5,
        jobs_new = $6,
        jobs_main = $7,
        jobs_stretch = $8,
        jobs_excluded = $9,
        duplicates_removed = $10,
        excluded_location = $11,
        excluded_arrangement = $12,
        excluded_experience = $13,
        warnings = $14,
        status = $15,
        finished_at = $16
      WHERE id = $1`,
      [
        run.id,
        JSON.stringify({ ...slice.cursor, healthyCompanies: healthy }),
        companiesChecked,
        postingsFetched,
        Number(tally?.seen ?? 0),
        Number(tally?.fresh ?? 0),
        Number(tally?.main ?? 0),
        Number(tally?.stretch ?? 0),
        Number(tally?.excluded ?? 0),
        Math.max(postingsFetched - Number(tally?.seen ?? 0), 0),
        Number(tally?.location ?? 0),
        Number(tally?.arrangement ?? 0),
        Number(tally?.experience ?? 0),
        warnings.slice(0, 80).join("\n"),
        done ? "complete" : "running",
        done ? new Date().toISOString() : null,
      ],
    )
    if (done) logSourceWarnings(warnings)
  })
  const checked = run.companiesChecked + slice.collection.companiesChecked
  const fetched = run.postingsFetched + slice.collection.postings.length
  return {
    done,
    progress: done
      ? `Checked ${checked} companies and fetched ${fetched} postings.`
      : `Checked ${checked} companies and fetched ${fetched} postings so far.`,
  }
}

async function startLiveSearch(db: Sql, cursor: SearchCursor, now: Date) {
  const id = randomUUID()
  await db.transaction(async (tx) => {
    await tx.query("UPDATE jobs SET is_new = FALSE")
    await tx.query(
      `INSERT INTO search_runs (
        id, started_at, finished_at, status, plan, step_index, run_kind,
        jobs_seen, jobs_new, jobs_main, jobs_stretch, jobs_excluded,
        companies_checked, postings_fetched, duplicates_removed,
        excluded_location, excluded_arrangement, excluded_experience, warnings
      ) VALUES (
        $1, $2, NULL, 'running', $3, 0, 'live',
        0, 0, 0, 0, 0,
        0, 0, 0,
        0, 0, 0, ''
      )`,
      [id, now.toISOString(), JSON.stringify(cursor)],
    )
  })
  return { id, cursor, companiesChecked: 0, postingsFetched: 0, startedAt: now }
}

async function loadRunningSearch(db: Sql) {
  const result = await db.query<{
    id: string
    plan: string | null
    companies_checked: number
    postings_fetched: number
    started_at: Date | string
  }>(
    `SELECT id, plan, companies_checked, postings_fetched, started_at
     FROM search_runs WHERE status = 'running' ORDER BY started_at DESC LIMIT 1`,
  )
  const row = result.rows[0]
  if (!row?.plan) return null
  try {
    const cursor = JSON.parse(row.plan) as SearchCursor
    if (!cursor.phase || !Array.isArray(cursor.companies)) return null
    return {
      id: row.id,
      cursor,
      companiesChecked: Number(row.companies_checked ?? 0),
      postingsFetched: Number(row.postings_fetched ?? 0),
      startedAt: asDate(row.started_at) ?? new Date(),
    }
  } catch {
    return null
  }
}

interface JobRow {
  id: string
  title: string
  company_name: string
  industry: string | null
  discovered_from: string | null
  normalized_city: string | null
  work_arrangement: string
  experience_label: string | null
  role_family: string | null
  posted_at: Date | string | null
  first_seen_at: Date | string
  application_url: string | null
  source: string | null
  opportunity_fit: number | string | null
  qualification_risk: string | null
  why_match: string | null
  stretch_reason: string | null
  feed_bucket: "main" | "stretch" | "excluded"
  is_new: boolean
  first_surfaced_at: Date | string | null
  last_seen_at: Date | string
  availability: string | null
  description: string | null
  origin: string | null
}

export async function listDeskJobs(input: Database): Promise<DeskJob[]> {
  const db = asSql(input)
  const jobs = await db.query<JobRow>(
    `SELECT
      j.id, j.title, j.role_family, j.normalized_city, j.work_arrangement, j.experience_label,
      j.posted_at, j.first_seen_at, j.application_url, j.source, j.opportunity_fit, j.qualification_risk,
      j.why_match, j.stretch_reason, j.feed_bucket, j.is_new,
      j.first_surfaced_at, j.last_seen_at, j.availability, j.description, j.origin,
      c.name AS company_name, c.industry, c.discovered_from
    FROM jobs j
    JOIN companies c ON c.id = j.company_id
    WHERE j.feed_bucket <> 'excluded'
       OR EXISTS (
         SELECT 1 FROM feedback f
         WHERE f.job_id = j.id AND f.action IN ('applied', 'save', 'not_interested')
       )`,
  )
  const sources = await db.query<{ job_id: string; source: string; source_url: string }>(
    "SELECT job_id, source, source_url FROM job_sources",
  )
  const feedback = await db.query<{ job_id: string; action: string }>("SELECT job_id, action FROM feedback")

  const mapped = jobs.rows.map((row) => ({
    id: row.id,
    title: row.title,
    companyName: row.company_name,
    industry: row.industry,
    city: row.normalized_city,
    workArrangement: row.work_arrangement,
    experienceLabel: row.experience_label ?? "No stated experience requirement",
    roleFamily: row.role_family,
    postedAt: asDate(row.posted_at),
    firstSeenAt: asDate(row.first_seen_at) ?? new Date(),
    applicationUrl: row.application_url ?? "",
    canonicalSource: row.source,
    opportunityFit: asNumber(row.opportunity_fit),
    qualificationRisk: row.qualification_risk,
    whyMatch: row.why_match,
    stretchReason: row.stretch_reason,
    feedBucket: row.feed_bucket,
    isNew: Boolean(row.is_new),
    firstSurfacedAt: asDate(row.first_surfaced_at),
    lastSeenAt: asDate(row.last_seen_at) ?? asDate(row.first_seen_at) ?? new Date(),
    availability: (row.availability === "unavailable" ? "unavailable" : "active") as DeskJob["availability"],
    sample: row.discovered_from === "sample import",
    sources: sources.rows
      .filter((source) => source.job_id === row.id)
      .sort((a, b) => Number(b.source === row.source) - Number(a.source === row.source))
      .map((source) => ({ source: source.source, sourceUrl: source.source_url })),
    actions: feedback.rows.filter((item) => item.job_id === row.id).map((item) => item.action),
    description: row.description ?? "",
    origin: row.origin ?? "search",
    preferenceDelta: 0,
    preferenceNote: null,
  }))
  const liveExists = mapped.some((job) => !job.sample)
  if (!liveExists) return mapped
  return mapped.filter((job) => !job.sample || job.actions.includes("save") || job.actions.includes("applied"))
}

export async function latestSearchRun(input: Database): Promise<SearchRun | null> {
  const db = asSql(input)
  const result = await db.query<{
    id: string
    started_at: Date | string
    finished_at: Date | string | null
    jobs_seen: number
    jobs_new: number
    jobs_main: number
    jobs_stretch: number
    jobs_excluded: number
    companies_checked: number | null
    postings_fetched: number | null
    duplicates_removed: number | null
    excluded_location: number | null
    excluded_arrangement: number | null
    excluded_experience: number | null
    warnings: string | null
    run_kind: string | null
    status: string | null
  }>("SELECT * FROM search_runs ORDER BY started_at DESC LIMIT 1")
  const row = result.rows[0]
  if (!row) return null
  return {
    id: row.id,
    startedAt: asDate(row.started_at) ?? new Date(),
    finishedAt: asDate(row.finished_at),
    jobsSeen: Number(row.jobs_seen),
    jobsNew: Number(row.jobs_new),
    jobsMain: Number(row.jobs_main),
    jobsStretch: Number(row.jobs_stretch),
    jobsExcluded: Number(row.jobs_excluded),
    companiesChecked: Number(row.companies_checked ?? 0),
    postingsFetched: Number(row.postings_fetched ?? 0),
    duplicatesRemoved: Number(row.duplicates_removed ?? 0),
    excludedLocation: Number(row.excluded_location ?? 0),
    excludedArrangement: Number(row.excluded_arrangement ?? 0),
    excludedExperience: Number(row.excluded_experience ?? 0),
    warnings: row.warnings ? row.warnings.split("\n").filter(Boolean) : [],
    runKind: row.run_kind === "live" ? "live" : "sample",
    status: row.status === "running" ? "running" : "complete",
  }
}

function sourceCache(db: Sql) {
  const ttlMs = 6 * 60 * 60 * 1000
  return {
    async get(key: string): Promise<string | null> {
      const result = await db.query<{ body: string; fetched_at: Date | string }>(
        "SELECT body, fetched_at FROM source_cache WHERE cache_key = $1",
        [key],
      )
      const row = result.rows[0]
      if (!row) return null
      const fetched = asDate(row.fetched_at)
      if (!fetched || Date.now() - fetched.getTime() > ttlMs) return null
      return row.body
    },
    async set(key: string, body: string): Promise<void> {
      await db.query(
        `INSERT INTO source_cache (cache_key, body, fetched_at) VALUES ($1, $2, $3)
         ON CONFLICT (cache_key) DO UPDATE SET body = EXCLUDED.body, fetched_at = EXCLUDED.fetched_at`,
        [key, body, new Date().toISOString()],
      )
    },
  }
}

async function listSavedCompanies(db: Sql): Promise<SeedCompany[]> {
  const result = await db.query<{
    name: string
    website: string | null
    careers_url: string | null
    industry: string | null
    ats_provider: string | null
    ats_identifier: string | null
    ats_status: string | null
    discovered_from: string | null
  }>(
    `SELECT name, website, careers_url, industry, ats_provider, ats_identifier, ats_status, discovered_from
     FROM companies
     WHERE discovered_from IS DISTINCT FROM 'sample import'`,
  )
  return result.rows.map((row) => {
    const disabled = row.ats_status === "disabled"
    const provider =
      !disabled && (row.ats_provider === "greenhouse" || row.ats_provider === "ashby" || row.ats_provider === "lever")
        ? row.ats_provider
        : undefined
    return {
      name: row.name,
      website: row.website ?? undefined,
      careersUrl: row.careers_url ?? undefined,
      industry: row.industry ?? undefined,
      atsProvider: provider,
      atsIdentifier: provider ? (row.ats_identifier ?? undefined) : undefined,
    }
  })
}

function mergeSeedCompanies(seed: SeedCompany[], saved: SeedCompany[]): SeedCompany[] {
  const byName = new Map<string, SeedCompany>()
  for (const company of seed) byName.set(normalizeCompanyName(company.name), { ...company })
  for (const company of saved) {
    const key = normalizeCompanyName(company.name)
    const existing = byName.get(key)
    if (!existing) {
      byName.set(key, company)
      continue
    }
    byName.set(key, {
      ...existing,
      website: existing.website ?? company.website,
      careersUrl: existing.careersUrl ?? company.careersUrl,
      industry: existing.industry ?? company.industry,
      atsProvider: existing.atsProvider ?? company.atsProvider,
      atsIdentifier: existing.atsIdentifier ?? company.atsIdentifier,
    })
  }
  return [...byName.values()]
}

async function saveCheckedCompanies(db: Sql, companies: CheckedCompany[], now: Date) {
  for (const company of companies) {
    const stale = company.sourceHealth === "stale"
    await db.query(
      `INSERT INTO companies (
        id, name, normalized_name, website, careers_url, ats_provider, ats_identifier, industry, discovered_from, last_checked_at, ats_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (normalized_name) DO UPDATE SET
        website = COALESCE(EXCLUDED.website, companies.website),
        careers_url = COALESCE(EXCLUDED.careers_url, companies.careers_url),
        ats_provider = CASE
          WHEN EXCLUDED.ats_status = 'disabled' THEN NULL
          ELSE COALESCE(EXCLUDED.ats_provider, companies.ats_provider)
        END,
        ats_identifier = CASE
          WHEN EXCLUDED.ats_status = 'disabled' THEN NULL
          ELSE COALESCE(EXCLUDED.ats_identifier, companies.ats_identifier)
        END,
        ats_status = CASE
          WHEN EXCLUDED.ats_status = 'disabled' THEN 'disabled'
          WHEN EXCLUDED.ats_provider IS NOT NULL THEN 'active'
          ELSE companies.ats_status
        END,
        industry = COALESCE(EXCLUDED.industry, companies.industry),
        discovered_from = CASE
          WHEN companies.discovered_from = 'sample import' THEN EXCLUDED.discovered_from
          ELSE companies.discovered_from
        END,
        last_checked_at = EXCLUDED.last_checked_at`,
      [
        randomUUID(),
        company.name,
        company.normalizedName,
        company.website ?? null,
        company.careersUrl ?? null,
        stale ? null : (company.atsProvider ?? null),
        stale ? null : (company.atsIdentifier ?? null),
        company.industry ?? null,
        company.discoveredFrom,
        now.toISOString(),
        stale ? "disabled" : "active",
      ],
    )
  }
}

function healthyNames(companies: CheckedCompany[]): string[] {
  return [
    ...new Set(
      companies
        .filter((company) => (company.sourceHealth ?? "ok") === "ok" && company.atsProvider)
        .map((company) => company.normalizedName),
    ),
  ]
}

function boardKey(provider?: string, identifier?: string): string | null {
  if (!provider || !identifier) return null
  return `${provider.toLowerCase()}:${identifier.toLowerCase()}`
}

async function disabledBoardKeys(db: Sql): Promise<string[]> {
  const result = await db.query<{ provider: string; identifier: string }>(
    "SELECT provider, identifier FROM disabled_sources",
  )
  return result.rows.map((row) => `${row.provider}:${row.identifier.toLowerCase()}`)
}

function withoutDisabledBoards(companies: SeedCompany[], disabled: string[]): SeedCompany[] {
  const blocked = new Set(disabled)
  return companies.map((company) => {
    const key = boardKey(company.atsProvider, company.atsIdentifier)
    if (!key || !blocked.has(key)) return company
    return { ...company, atsProvider: undefined, atsIdentifier: undefined }
  })
}

async function disableStaleBoards(db: Sql, boards: StaleBoard[]) {
  for (const board of boards) {
    const provider = board.provider.toLowerCase()
    const identifier = board.identifier.toLowerCase()
    await db.query(
      `INSERT INTO disabled_sources (provider, identifier, company_name, reason)
       VALUES ($1, $2, $3, '404')
       ON CONFLICT (provider, identifier) DO NOTHING`,
      [provider, identifier, board.companyName],
    )
    await db.query(
      `UPDATE companies
       SET ats_status = 'disabled', ats_provider = NULL, ats_identifier = NULL
       WHERE lower(ats_provider) = $1 AND lower(ats_identifier) = $2`,
      [provider, identifier],
    )
  }
}

async function retireUnseen(db: Sql, healthy: string[], cutoff: Date) {
  if (healthy.length === 0) return
  await db.query(
    `UPDATE jobs AS j
     SET consecutive_misses = j.consecutive_misses + 1
     FROM companies AS c
     WHERE c.id = j.company_id
       AND c.normalized_name = ANY($1::text[])
       AND j.last_seen_live_at IS NOT NULL
       AND j.last_seen_at < $2::timestamptz
       AND j.availability = 'active'`,
    [healthy, cutoff.toISOString()],
  )
  await db.query(
    `UPDATE jobs
     SET availability = 'unavailable'
     WHERE consecutive_misses >= 2
       AND availability = 'active'`,
  )
}

function logSourceWarnings(warnings: string[]) {
  if (warnings.length === 0) return
  console.warn(`Open Desk source warnings (${warnings.length})\n${warnings.join("\n")}`)
}

export async function setFeedback(
  input: Database,
  jobId: string,
  action: FeedbackAction,
  detail?: FeedbackDetail,
): Promise<void> {
  const db = asSql(input)
  if (action === "restore") {
    await db.query("DELETE FROM feedback WHERE job_id = $1 AND action = 'not_interested'", [jobId])
    return
  }

  if (action === "not_interested") {
    const reasons = validRejectionReasons(detail?.reasons ?? [])
    if (reasons.length === 0) throw new Error("Choose at least one reason")
    const note = detail?.note?.trim() ? detail.note.trim().slice(0, 1000) : null
    const existing = await db.query<{ id: string }>(
      "SELECT id FROM feedback WHERE job_id = $1 AND action = 'not_interested'",
      [jobId],
    )
    const feedbackId = existing.rows[0]?.id ?? randomUUID()
    if (!existing.rows[0]) {
      await db.query("INSERT INTO feedback (id, job_id, action, note) VALUES ($1, $2, 'not_interested', $3)", [
        feedbackId,
        jobId,
        note,
      ])
    } else {
      await db.query("UPDATE feedback SET note = $2 WHERE id = $1", [feedbackId, note])
    }
    await db.query("DELETE FROM feedback_reasons WHERE feedback_id = $1", [feedbackId])
    for (const reason of reasons) {
      await db.query("INSERT INTO feedback_reasons (id, feedback_id, reason) VALUES ($1, $2, $3)", [
        randomUUID(),
        feedbackId,
        reason,
      ])
    }
    return
  }

  const existing = await db.query<{ id: string }>(
    "SELECT id FROM feedback WHERE job_id = $1 AND action = $2",
    [jobId, action],
  )
  if (existing.rows[0]) {
    await db.query("DELETE FROM feedback WHERE job_id = $1 AND action = $2", [jobId, action])
    return
  }
  await db.query("INSERT INTO feedback (id, job_id, action) VALUES ($1, $2, $3)", [randomUUID(), jobId, action])
}

export async function listFeedback(input: Database): Promise<FeedbackRecord[]> {
  const db = asSql(input)
  const result = await db.query<{
    job_id: string
    action: string
    created_at: Date | string
    note: string | null
    reason: string | null
  }>(
    `SELECT f.job_id, f.action, f.created_at, f.note, r.reason
     FROM feedback f
     LEFT JOIN feedback_reasons r ON r.feedback_id = f.id
     ORDER BY f.created_at ASC`,
  )
  const grouped = new Map<string, FeedbackRecord>()
  for (const row of result.rows) {
    const key = `${row.job_id}:${row.action}`
    const existing = grouped.get(key)
    if (!existing) {
      grouped.set(key, {
        jobId: row.job_id,
        action: row.action,
        createdAt: asDate(row.created_at) ?? new Date(),
        note: row.note,
        reasons: row.reason ? [row.reason] : [],
      })
    } else if (row.reason && !existing.reasons.includes(row.reason)) {
      existing.reasons.push(row.reason)
    }
  }
  return [...grouped.values()]
}

export async function preferenceResetAt(input: Database): Promise<Date | null> {
  const db = asSql(input)
  const result = await db.query<{ reset_at: Date | string | null }>(
    "SELECT reset_at FROM preference_meta WHERE id = 'default'",
  )
  return asDate(result.rows[0]?.reset_at ?? null)
}

export async function resetLearnedPreferences(input: Database, now = new Date()): Promise<void> {
  const db = asSql(input)
  await db.query(
    `INSERT INTO preference_meta (id, reset_at) VALUES ('default', $1)
     ON CONFLICT (id) DO UPDATE SET reset_at = EXCLUDED.reset_at`,
    [now.toISOString()],
  )
}

export async function importExternalJob(
  input: Database,
  posting: RawPosting,
  action: "applied" | "save" | "desk",
  now = new Date(),
): Promise<{ jobId: string; created: boolean; title: string; companyName: string; feedBucket: string }> {
  const db = asSql(input)
  const processed = await processPostings([{ ...posting, discoveredFrom: "external_user", release: "search" }], now)
  const job = processed[0]
  if (!job) throw new Error("Open Desk could not read that job")
  const written: { id: string; created: boolean }[] = []
  await db.transaction(async (tx) => {
    await writeProcessed(tx, processed, now, { markNew: true, live: false, written })
  })
  const row = written[0]
  if (!row) throw new Error("Open Desk could not save that job")
  if (row.created) {
    await db.query("UPDATE jobs SET origin = 'external_user' WHERE id = $1", [row.id])
  }
  if (action === "applied" || action === "save") await setFeedback(db, row.id, action)
  return {
    jobId: row.id,
    created: row.created,
    title: job.title,
    companyName: job.companyName,
    feedBucket: job.feedBucket,
  }
}
