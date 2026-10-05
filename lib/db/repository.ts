import { randomUUID } from "node:crypto"
import type { PGlite } from "@electric-sql/pglite"
import { COMPANY_SEED } from "@/data/company-seed"
import { postingsFor } from "@/data/sample-postings"
import { createClassifier } from "@/lib/llm/classifier"
import type { Classification, QualificationRisk } from "@/lib/llm/types"
import type { ProcessedJob } from "@/lib/jobs/pipeline"
import { processPostings } from "@/lib/jobs/pipeline"
import { normalizeCompanyName } from "@/lib/jobs/text"
import { createHttpClient } from "@/lib/sources/http"
import { collectLivePostings, type CheckedCompany, type LiveCollection } from "@/lib/sources/live-search"
import type { SeedCompany } from "@/data/company-seed"

export type FeedbackAction = "save" | "applied" | "not_interested" | "restore"

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

function stamp(date: Date | null): string | null {
  return date ? date.toISOString() : null
}

export async function importLiveSearch(db: PGlite, now = new Date()): Promise<ImportSummary> {
  const saved = await listSavedCompanies(db)
  const collected = await collectLivePostings({
    companies: mergeSeedCompanies(COMPANY_SEED, saved),
    client: createHttpClient({ cache: sourceCache(db) }),
    now,
  })
  return importPostings(db, "search", now, collected)
}

export async function importPostings(
  db: PGlite,
  mode: "seed" | "search",
  now = new Date(),
  live?: LiveCollection,
): Promise<ImportSummary> {
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

  await db.exec("BEGIN")
  try {
    if (mode === "search") {
      await db.query("UPDATE jobs SET is_new = FALSE")
    }

    for (const job of processed) {
      const companyId = await upsertCompany(db, job, now)
      const existing = await db.query<{ id: string }>("SELECT id FROM jobs WHERE fingerprint = $1", [job.fingerprint])
      let jobId: string
      if (existing.rows[0]) {
        jobId = existing.rows[0].id
        await updateJob(db, jobId, companyId, job, now)
      } else {
        jobId = randomUUID()
        const isNew = mode === "search" && job.feedBucket !== "excluded"
        if (isNew) summary.jobsNew += 1
        await insertJob(db, jobId, companyId, job, now, isNew)
      }
      await replaceSources(db, jobId, job, now)
    }

    if (live) {
      await saveCheckedCompanies(db, live.checkedCompanies, now)
    }

    if (mode === "search") {
      const finished = new Date()
      await db.query(
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
    }

    await db.exec("COMMIT")
    return summary
  } catch (error) {
    await db.exec("ROLLBACK")
    throw error
  }
}

async function upsertCompany(db: PGlite, job: ProcessedJob, now: Date): Promise<string> {
  const result = await db.query<{ id: string }>(
    `INSERT INTO companies (
      id, name, normalized_name, website, careers_url, ats_provider, ats_identifier, industry, discovered_from, last_checked_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (normalized_name) DO UPDATE SET
      website = COALESCE(EXCLUDED.website, companies.website),
      careers_url = COALESCE(EXCLUDED.careers_url, companies.careers_url),
      ats_provider = COALESCE(EXCLUDED.ats_provider, companies.ats_provider),
      ats_identifier = COALESCE(EXCLUDED.ats_identifier, companies.ats_identifier),
      industry = COALESCE(EXCLUDED.industry, companies.industry),
      last_checked_at = EXCLUDED.last_checked_at
    RETURNING id`,
    [
      randomUUID(),
      job.companyName,
      job.normalizedCompany,
      job.companyWebsite,
      job.careersUrl,
      job.atsProvider,
      job.atsIdentifier,
      job.industry,
      job.discoveredFrom,
      now.toISOString(),
    ],
  )
  return result.rows[0].id
}

async function insertJob(db: PGlite, jobId: string, companyId: string, job: ProcessedJob, now: Date, isNew: boolean) {
  await db.query(
    `INSERT INTO jobs (
      id, company_id, title, normalized_title, role_family, description, location_raw, normalized_city,
      work_arrangement, experience_min, experience_max, experience_required_or_preferred, experience_label,
      employment_type, posted_at, first_seen_at, last_seen_at, application_url, canonical_url, source, source_url,
      opportunity_fit, qualification_risk, why_match, stretch_reason, status, fingerprint, content_hash,
      feed_bucket, exclusion_reason, is_new
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, $11, $12, $13,
      $14, $15, $16, $17, $18, $19, $20, $21,
      $22, $23, $24, $25, $26, $27, $28,
      $29, $30, $31
    )`,
    [
      jobId,
      companyId,
      job.title,
      job.normalizedTitle,
      job.roleFamily,
      job.description,
      job.locationRaw,
      job.normalizedCity,
      job.workArrangement,
      job.experienceMin,
      job.experienceMax,
      job.experienceRequiredOrPreferred,
      job.experienceLabel,
      job.employmentType,
      stamp(job.postedAt),
      now.toISOString(),
      now.toISOString(),
      job.applicationUrl,
      job.canonicalUrl,
      job.source,
      job.sourceUrl,
      job.opportunityFit,
      job.qualificationRisk,
      job.whyMatch,
      job.stretchReason,
      job.status,
      job.fingerprint,
      job.contentHash,
      job.feedBucket,
      job.exclusionReason,
      isNew,
    ],
  )
}

async function updateJob(db: PGlite, jobId: string, companyId: string, job: ProcessedJob, now: Date) {
  await db.query(
    `UPDATE jobs SET
      company_id = $2,
      title = $3,
      normalized_title = $4,
      role_family = $5,
      description = $6,
      location_raw = $7,
      normalized_city = $8,
      work_arrangement = $9,
      experience_min = $10,
      experience_max = $11,
      experience_required_or_preferred = $12,
      experience_label = $13,
      employment_type = $14,
      posted_at = $15,
      last_seen_at = $16,
      application_url = $17,
      canonical_url = $18,
      source = $19,
      source_url = $20,
      opportunity_fit = $21,
      qualification_risk = $22,
      why_match = $23,
      stretch_reason = $24,
      status = $25,
      content_hash = $26,
      feed_bucket = $27,
      exclusion_reason = $28,
      is_new = FALSE
    WHERE id = $1`,
    [
      jobId,
      companyId,
      job.title,
      job.normalizedTitle,
      job.roleFamily,
      job.description,
      job.locationRaw,
      job.normalizedCity,
      job.workArrangement,
      job.experienceMin,
      job.experienceMax,
      job.experienceRequiredOrPreferred,
      job.experienceLabel,
      job.employmentType,
      stamp(job.postedAt),
      now.toISOString(),
      job.applicationUrl,
      job.canonicalUrl,
      job.source,
      job.sourceUrl,
      job.opportunityFit,
      job.qualificationRisk,
      job.whyMatch,
      job.stretchReason,
      job.status,
      job.contentHash,
      job.feedBucket,
      job.exclusionReason,
    ],
  )
}

async function replaceSources(db: PGlite, jobId: string, job: ProcessedJob, now: Date) {
  await db.query("DELETE FROM job_sources WHERE job_id = $1", [jobId])
  for (const source of job.sources) {
    await db.query(
      `INSERT INTO job_sources (id, job_id, source, source_url, application_url, external_id, discovered_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [randomUUID(), jobId, source.source, source.sourceUrl, source.applicationUrl, source.externalId, now.toISOString()],
    )
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
}

export async function listDeskJobs(db: PGlite): Promise<DeskJob[]> {
  const jobs = await db.query<JobRow>(
    `SELECT
      j.id, j.title, j.role_family, j.normalized_city, j.work_arrangement, j.experience_label,
      j.posted_at, j.first_seen_at, j.application_url, j.source, j.opportunity_fit, j.qualification_risk,
      j.why_match, j.stretch_reason, j.feed_bucket, j.is_new,
      c.name AS company_name, c.industry, c.discovered_from
    FROM jobs j
    JOIN companies c ON c.id = j.company_id
    WHERE j.feed_bucket <> 'excluded'`,
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
    sample: row.discovered_from === "sample import",
    sources: sources.rows
      .filter((source) => source.job_id === row.id)
      .sort((a, b) => Number(b.source === row.source) - Number(a.source === row.source))
      .map((source) => ({ source: source.source, sourceUrl: source.source_url })),
    actions: feedback.rows.filter((item) => item.job_id === row.id).map((item) => item.action),
  }))
  const liveExists = mapped.some((job) => !job.sample)
  if (!liveExists) return mapped
  return mapped.filter((job) => !job.sample || job.actions.includes("save") || job.actions.includes("applied"))
}

export async function latestSearchRun(db: PGlite): Promise<SearchRun | null> {
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
  }
}

function sourceCache(db: PGlite) {
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

async function listSavedCompanies(db: PGlite): Promise<SeedCompany[]> {
  const result = await db.query<{
    name: string
    website: string | null
    careers_url: string | null
    industry: string | null
    ats_provider: string | null
    ats_identifier: string | null
    discovered_from: string | null
  }>(
    `SELECT name, website, careers_url, industry, ats_provider, ats_identifier, discovered_from
     FROM companies
     WHERE discovered_from IS DISTINCT FROM 'sample import'`,
  )
  return result.rows.map((row) => ({
    name: row.name,
    website: row.website ?? undefined,
    careersUrl: row.careers_url ?? undefined,
    industry: row.industry ?? undefined,
    atsProvider:
      row.ats_provider === "greenhouse" || row.ats_provider === "ashby" || row.ats_provider === "lever"
        ? row.ats_provider
        : undefined,
    atsIdentifier: row.ats_identifier ?? undefined,
  }))
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

async function saveCheckedCompanies(db: PGlite, companies: CheckedCompany[], now: Date) {
  for (const company of companies) {
    await db.query(
      `INSERT INTO companies (
        id, name, normalized_name, website, careers_url, ats_provider, ats_identifier, industry, discovered_from, last_checked_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (normalized_name) DO UPDATE SET
        website = COALESCE(EXCLUDED.website, companies.website),
        careers_url = COALESCE(EXCLUDED.careers_url, companies.careers_url),
        ats_provider = COALESCE(EXCLUDED.ats_provider, companies.ats_provider),
        ats_identifier = COALESCE(EXCLUDED.ats_identifier, companies.ats_identifier),
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
        company.atsProvider ?? null,
        company.atsIdentifier ?? null,
        company.industry ?? null,
        company.discoveredFrom,
        now.toISOString(),
      ],
    )
  }
}

export async function setFeedback(db: PGlite, jobId: string, action: FeedbackAction): Promise<void> {
  if (action === "restore") {
    await db.query("DELETE FROM feedback WHERE job_id = $1 AND action = 'not_interested'", [jobId])
    return
  }

  if (action === "not_interested") {
    const existing = await db.query<{ id: string }>(
      "SELECT id FROM feedback WHERE job_id = $1 AND action = 'not_interested'",
      [jobId],
    )
    if (!existing.rows[0]) {
      await db.query("INSERT INTO feedback (id, job_id, action) VALUES ($1, $2, 'not_interested')", [
        randomUUID(),
        jobId,
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
