import { randomUUID } from "node:crypto"
import { atsKey, matchStoredJob, type IncomingIdentity, type StoredIdentity } from "@/lib/jobs/identity"
import type { ProcessedJob, ProcessedSource } from "@/lib/jobs/pipeline"
import { boardToken } from "@/lib/sources/html"
import type { Sql } from "@/lib/db/sql"

const CHUNK = 20

function chunks<T>(items: T[], size: number): T[][] {
  const groups: T[][] = []
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size))
  return groups
}

function stamp(date: Date | null): string | null {
  return date ? date.toISOString() : null
}

function tuples(rows: unknown[][], casts: string[]): { sql: string; params: unknown[] } {
  const params: unknown[] = []
  const sql = rows
    .map((row) => {
      const cells = row.map((value, index) => {
        params.push(value)
        return `$${params.length}${casts[index]}`
      })
      return `(${cells.join(", ")})`
    })
    .join(", ")
  return { sql, params }
}

async function upsertCompany(tx: Sql, job: ProcessedJob, now: Date): Promise<string> {
  const result = await tx.query<{ id: string }>(
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
      boardToken(job.atsIdentifier),
      job.industry,
      job.discoveredFrom,
      now.toISOString(),
    ],
  )
  return result.rows[0].id
}

interface ResolvedJob {
  id: string
  job: ProcessedJob
  isNew: boolean
  surfacedBefore: boolean
}

function atsProviderFor(provider: string | null | undefined, source: string | null | undefined): string | null {
  const value = (provider ?? source ?? "").toLowerCase()
  if (value === "greenhouse" || value === "ashby" || value === "lever") return value
  return null
}

function incomingIdentity(job: ProcessedJob): IncomingIdentity {
  const urls = [job.applicationUrl, job.canonicalUrl, job.sourceUrl, ...job.sources.flatMap((source) => [source.applicationUrl, source.sourceUrl])]
  const atsKeys = job.sources
    .map((source) => atsKey(atsProviderFor(source.atsProvider, source.source), source.externalId))
    .filter((key): key is string => Boolean(key))
  return {
    fingerprint: job.fingerprint,
    company: job.normalizedCompany,
    title: job.normalizedTitle,
    city: job.normalizedCity,
    description: job.description,
    urls,
    atsKeys,
  }
}

function mergeSources(current: ProcessedSource[], extra: ProcessedSource[]): ProcessedSource[] {
  const merged = [...current]
  for (const source of extra) {
    const exists = merged.some((item) => item.source === source.source && item.sourceUrl === source.sourceUrl)
    if (!exists) merged.push(source)
  }
  return merged
}

export async function writeProcessed(
  tx: Sql,
  jobs: ProcessedJob[],
  now: Date,
  options: { markNew: boolean; runId?: string; live?: boolean },
): Promise<number> {
  if (jobs.length === 0) return 0
  const stored = await loadStored(tx, jobs)
  const companyIds = new Map<string, string>()
  for (const job of jobs) {
    if (companyIds.has(job.normalizedCompany)) continue
    companyIds.set(job.normalizedCompany, await upsertCompany(tx, job, now))
  }

  const fresh: ResolvedJob[] = []
  const prior: ResolvedJob[] = []
  const claimed = new Map<string, ResolvedJob>()
  for (const job of jobs) {
    const match = matchStoredJob(incomingIdentity(job), stored)
    const claimedRow = match ? claimed.get(match.id) : undefined
    if (match && claimedRow) {
      claimedRow.job = { ...claimedRow.job, sources: mergeSources(claimedRow.job.sources, job.sources) }
      continue
    }
    if (match) {
      const surfacedBefore = Boolean(match.firstSurfacedAt)
      const isNew = options.markNew && job.feedBucket !== "excluded" && !surfacedBefore
      const row = { id: match.id, job, isNew, surfacedBefore }
      prior.push(row)
      claimed.set(match.id, row)
      continue
    }
    const isNew = options.markNew && job.feedBucket !== "excluded"
    const row = { id: randomUUID(), job, isNew, surfacedBefore: false }
    fresh.push(row)
    stored.push({
      id: row.id,
      fingerprint: job.fingerprint,
      company: job.normalizedCompany,
      title: job.normalizedTitle,
      city: job.normalizedCity ?? "",
      description: job.description,
      urls: incomingIdentity(job).urls,
      atsKeys: incomingIdentity(job).atsKeys,
      firstSeenAt: now.toISOString(),
      firstSurfacedAt: job.feedBucket === "excluded" ? null : now.toISOString(),
      actions: [],
    })
  }

  await insertJobs(tx, fresh, companyIds, now, options.live === true)
  await updateJobs(tx, prior, companyIds, now, options.live === true)
  await rememberSources(tx, [...fresh, ...prior], now)
  if (options.runId) await rememberRunJobs(tx, options.runId, fresh, prior)
  return [...fresh, ...prior].filter((row) => row.isNew).length
}

async function loadStored(tx: Sql, jobs: ProcessedJob[]): Promise<StoredIdentity[]> {
  const companies = [...new Set(jobs.map((job) => job.normalizedCompany))]
  const fingerprints = [...new Set(jobs.map((job) => job.fingerprint))]
  const externalIds = [
    ...new Set(jobs.flatMap((job) => job.sources.map((source) => source.externalId).filter((id): id is string => Boolean(id)))),
  ]
  const result = await tx.query<{
    id: string
    fingerprint: string
    normalized_name: string
    normalized_title: string
    normalized_city: string | null
    description: string
    application_url: string | null
    canonical_url: string | null
    source_url: string | null
    first_seen_at: Date | string
    first_surfaced_at: Date | string | null
  }>(
    `SELECT j.id, j.fingerprint, c.normalized_name, j.normalized_title, j.normalized_city, j.description,
            j.application_url, j.canonical_url, j.source_url, j.first_seen_at, j.first_surfaced_at
     FROM jobs j
     JOIN companies c ON c.id = j.company_id
     WHERE c.normalized_name = ANY($1::text[])
        OR j.fingerprint = ANY($2::text[])
        OR EXISTS (
          SELECT 1 FROM job_sources s
          WHERE s.job_id = j.id AND s.external_id = ANY($3::text[])
        )`,
    [companies, fingerprints, externalIds.length > 0 ? externalIds : ["__none__"]],
  )
  const ids = result.rows.map((row) => row.id)
  const sources = ids.length
    ? await tx.query<{
        job_id: string
        source: string
        source_url: string
        application_url: string | null
        external_id: string | null
        ats_provider: string | null
      }>(
        "SELECT job_id, source, source_url, application_url, external_id, ats_provider FROM job_sources WHERE job_id = ANY($1::text[])",
        [ids],
      )
    : { rows: [] }
  const feedback = ids.length
    ? await tx.query<{ job_id: string; action: string }>(
        "SELECT job_id, action FROM feedback WHERE job_id = ANY($1::text[])",
        [ids],
      )
    : { rows: [] }

  return result.rows.map((row) => {
    const related = sources.rows.filter((source) => source.job_id === row.id)
    const urls = [row.application_url, row.canonical_url, row.source_url, ...related.flatMap((source) => [source.application_url, source.source_url])]
    const atsKeys = related
      .map((source) => atsKey(atsProviderFor(source.ats_provider, source.source), source.external_id))
      .filter((key): key is string => Boolean(key))
    return {
      id: row.id,
      fingerprint: row.fingerprint,
      company: row.normalized_name,
      title: row.normalized_title,
      city: row.normalized_city ?? "",
      description: row.description,
      urls: urls.filter((url): url is string => Boolean(url)),
      atsKeys,
      firstSeenAt: row.first_seen_at instanceof Date ? row.first_seen_at.toISOString() : String(row.first_seen_at),
      firstSurfacedAt: row.first_surfaced_at
        ? row.first_surfaced_at instanceof Date
          ? row.first_surfaced_at.toISOString()
          : String(row.first_surfaced_at)
        : null,
      actions: feedback.rows.filter((item) => item.job_id === row.id).map((item) => item.action),
    }
  })
}

async function insertJobs(
  tx: Sql,
  rows: ResolvedJob[],
  companyIds: Map<string, string>,
  now: Date,
  live: boolean,
) {
  const casts = [
    "::text",
    "::text",
    "::text",
    "::text",
    "::text",
    "::text",
    "::text",
    "::text",
    "::text",
    "::integer",
    "::integer",
    "::text",
    "::text",
    "::text",
    "::timestamptz",
    "::timestamptz",
    "::timestamptz",
    "::text",
    "::text",
    "::text",
    "::text",
    "::integer",
    "::text",
    "::text",
    "::text",
    "::text",
    "::text",
    "::text",
    "::text",
    "::text",
    "::boolean",
    "::timestamptz",
    "::timestamptz",
    "::text",
    "::integer",
  ]
  for (const group of chunks(rows, CHUNK)) {
    const { sql, params } = tuples(
      group.map((row) => [
        row.id,
        companyIds.get(row.job.normalizedCompany),
        row.job.title,
        row.job.normalizedTitle,
        row.job.roleFamily,
        row.job.description,
        row.job.locationRaw,
        row.job.normalizedCity,
        row.job.workArrangement,
        row.job.experienceMin,
        row.job.experienceMax,
        row.job.experienceRequiredOrPreferred,
        row.job.experienceLabel,
        row.job.employmentType,
        stamp(row.job.postedAt),
        now.toISOString(),
        now.toISOString(),
        row.job.applicationUrl,
        row.job.canonicalUrl,
        row.job.source,
        row.job.sourceUrl,
        row.job.opportunityFit,
        row.job.qualificationRisk,
        row.job.whyMatch,
        row.job.stretchReason,
        row.job.status,
        row.job.fingerprint,
        row.job.contentHash,
        row.job.feedBucket,
        row.job.exclusionReason,
        row.isNew,
        row.job.feedBucket === "excluded" ? null : now.toISOString(),
        live ? now.toISOString() : null,
        "active",
        0,
      ]),
      casts,
    )
    await tx.query(
      `INSERT INTO jobs (
        id, company_id, title, normalized_title, role_family, description, location_raw, normalized_city,
        work_arrangement, experience_min, experience_max, experience_required_or_preferred, experience_label,
        employment_type, posted_at, first_seen_at, last_seen_at, application_url, canonical_url, source, source_url,
        opportunity_fit, qualification_risk, why_match, stretch_reason, status, fingerprint, content_hash,
        feed_bucket, exclusion_reason, is_new, first_surfaced_at, last_seen_live_at, availability, consecutive_misses
      ) VALUES ${sql}`,
      params,
    )
  }
}

async function updateJobs(
  tx: Sql,
  rows: ResolvedJob[],
  companyIds: Map<string, string>,
  now: Date,
  live: boolean,
) {
  const casts = [
    "::text",
    "::text",
    "::text",
    "::text",
    "::text",
    "::text",
    "::text",
    "::text",
    "::text",
    "::integer",
    "::integer",
    "::text",
    "::text",
    "::text",
    "::timestamptz",
    "::timestamptz",
    "::text",
    "::text",
    "::text",
    "::text",
    "::integer",
    "::text",
    "::text",
    "::text",
    "::text",
    "::text",
    "::text",
    "::text",
    "::timestamptz",
    "::timestamptz",
    "::boolean",
  ]
  for (const group of chunks(rows, CHUNK)) {
    const { sql, params } = tuples(
      group.map((row) => [
        row.id,
        companyIds.get(row.job.normalizedCompany),
        row.job.title,
        row.job.normalizedTitle,
        row.job.roleFamily,
        row.job.description,
        row.job.locationRaw,
        row.job.normalizedCity,
        row.job.workArrangement,
        row.job.experienceMin,
        row.job.experienceMax,
        row.job.experienceRequiredOrPreferred,
        row.job.experienceLabel,
        row.job.employmentType,
        stamp(row.job.postedAt),
        now.toISOString(),
        row.job.applicationUrl,
        row.job.canonicalUrl,
        row.job.source,
        row.job.sourceUrl,
        row.job.opportunityFit,
        row.job.qualificationRisk,
        row.job.whyMatch,
        row.job.stretchReason,
        row.job.status,
        row.job.contentHash,
        row.job.feedBucket,
        row.job.exclusionReason,
        row.surfacedBefore || row.job.feedBucket === "excluded" ? null : now.toISOString(),
        live ? now.toISOString() : null,
        row.isNew,
      ]),
      casts,
    )
    await tx.query(
      `UPDATE jobs AS j SET
        company_id = v.company_id,
        title = v.title,
        normalized_title = v.normalized_title,
        role_family = v.role_family,
        description = v.description,
        location_raw = v.location_raw,
        normalized_city = v.normalized_city,
        work_arrangement = v.work_arrangement,
        experience_min = v.experience_min,
        experience_max = v.experience_max,
        experience_required_or_preferred = v.experience_required_or_preferred,
        experience_label = v.experience_label,
        employment_type = v.employment_type,
        posted_at = v.posted_at,
        last_seen_at = v.last_seen_at,
        application_url = v.application_url,
        canonical_url = v.canonical_url,
        source = v.source,
        source_url = v.source_url,
        opportunity_fit = v.opportunity_fit,
        qualification_risk = v.qualification_risk,
        why_match = v.why_match,
        stretch_reason = v.stretch_reason,
        status = v.status,
        content_hash = v.content_hash,
        feed_bucket = v.feed_bucket,
        exclusion_reason = v.exclusion_reason,
        first_surfaced_at = COALESCE(j.first_surfaced_at, v.first_surfaced_at),
        last_seen_live_at = COALESCE(v.last_seen_live_at, j.last_seen_live_at),
        availability = 'active',
        consecutive_misses = 0,
        is_new = CASE
          WHEN j.first_surfaced_at IS NULL AND v.first_surfaced_at IS NOT NULL THEN v.is_new
          ELSE j.is_new
        END
      FROM (VALUES ${sql}) AS v(
        id, company_id, title, normalized_title, role_family, description, location_raw, normalized_city,
        work_arrangement, experience_min, experience_max, experience_required_or_preferred, experience_label,
        employment_type, posted_at, last_seen_at, application_url, canonical_url, source, source_url,
        opportunity_fit, qualification_risk, why_match, stretch_reason, status, content_hash,
        feed_bucket, exclusion_reason, first_surfaced_at, last_seen_live_at, is_new
      )
      WHERE j.id = v.id`,
      params,
    )
  }
}

async function rememberSources(tx: Sql, rows: ResolvedJob[], now: Date) {
  const sources = rows.flatMap((row) =>
    row.job.sources.map((source) => [
      randomUUID(),
      row.id,
      source.source,
      source.sourceUrl,
      source.applicationUrl,
      source.externalId,
      source.atsProvider,
      now.toISOString(),
    ]),
  )
  for (const group of chunks(sources, CHUNK)) {
    const { sql, params } = tuples(group, [
      "::text",
      "::text",
      "::text",
      "::text",
      "::text",
      "::text",
      "::text",
      "::timestamptz",
    ])
    await tx.query(
      `INSERT INTO job_sources (id, job_id, source, source_url, application_url, external_id, ats_provider, discovered_at)
       VALUES ${sql}
       ON CONFLICT (job_id, source, source_url) DO UPDATE SET
         application_url = EXCLUDED.application_url,
         external_id = COALESCE(EXCLUDED.external_id, job_sources.external_id),
         ats_provider = COALESCE(EXCLUDED.ats_provider, job_sources.ats_provider)`,
      params,
    )
  }
}

async function rememberRunJobs(tx: Sql, runId: string, fresh: ResolvedJob[], prior: ResolvedJob[]) {
  const rows = [...fresh, ...prior].map((row) => [
    runId,
    row.job.fingerprint,
    row.job.feedBucket,
    row.job.exclusionReason,
    row.isNew,
  ])
  for (const group of chunks(rows, CHUNK)) {
    const { sql, params } = tuples(group, ["::text", "::text", "::text", "::text", "::boolean"])
    await tx.query(
      `INSERT INTO search_run_jobs (run_id, fingerprint, feed_bucket, exclusion_reason, is_new)
       VALUES ${sql}
       ON CONFLICT (run_id, fingerprint) DO NOTHING`,
      params,
    )
  }
}
