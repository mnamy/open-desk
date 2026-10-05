import { randomUUID } from "node:crypto"
import type { ProcessedJob } from "@/lib/jobs/pipeline"
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
      job.atsIdentifier,
      job.industry,
      job.discoveredFrom,
      now.toISOString(),
    ],
  )
  return result.rows[0].id
}

export async function writeProcessed(
  tx: Sql,
  jobs: ProcessedJob[],
  now: Date,
  options: { markNew: boolean; runId?: string },
): Promise<number> {
  if (jobs.length === 0) return 0
  const existing = await tx.query<{ id: string; fingerprint: string }>(
    "SELECT id, fingerprint FROM jobs WHERE fingerprint = ANY($1::text[])",
    [jobs.map((job) => job.fingerprint)],
  )
  const ids = new Map(existing.rows.map((row) => [row.fingerprint, row.id]))
  const companyIds = new Map<string, string>()
  for (const job of jobs) {
    if (companyIds.has(job.normalizedCompany)) continue
    companyIds.set(job.normalizedCompany, await upsertCompany(tx, job, now))
  }

  const fresh: { id: string; job: ProcessedJob; isNew: boolean }[] = []
  const prior: { id: string; job: ProcessedJob }[] = []
  for (const job of jobs) {
    const id = ids.get(job.fingerprint)
    if (id) prior.push({ id, job })
    else {
      const isNew = options.markNew && job.feedBucket !== "excluded"
      fresh.push({ id: randomUUID(), job, isNew })
    }
  }

  await insertJobs(tx, fresh, companyIds, now)
  await updateJobs(tx, prior, companyIds, now)
  const all = [...fresh.map((row) => row.id), ...prior.map((row) => row.id)]
  await replaceSources(tx, all, [...fresh, ...prior], now)
  if (options.runId) await rememberRunJobs(tx, options.runId, fresh, prior)
  return fresh.filter((row) => row.isNew).length
}

async function insertJobs(
  tx: Sql,
  rows: { id: string; job: ProcessedJob; isNew: boolean }[],
  companyIds: Map<string, string>,
  now: Date,
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
      ]),
      casts,
    )
    await tx.query(
      `INSERT INTO jobs (
        id, company_id, title, normalized_title, role_family, description, location_raw, normalized_city,
        work_arrangement, experience_min, experience_max, experience_required_or_preferred, experience_label,
        employment_type, posted_at, first_seen_at, last_seen_at, application_url, canonical_url, source, source_url,
        opportunity_fit, qualification_risk, why_match, stretch_reason, status, fingerprint, content_hash,
        feed_bucket, exclusion_reason, is_new
      ) VALUES ${sql}`,
      params,
    )
  }
}

async function updateJobs(
  tx: Sql,
  rows: { id: string; job: ProcessedJob }[],
  companyIds: Map<string, string>,
  now: Date,
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
        is_new = j.is_new
      FROM (VALUES ${sql}) AS v(
        id, company_id, title, normalized_title, role_family, description, location_raw, normalized_city,
        work_arrangement, experience_min, experience_max, experience_required_or_preferred, experience_label,
        employment_type, posted_at, last_seen_at, application_url, canonical_url, source, source_url,
        opportunity_fit, qualification_risk, why_match, stretch_reason, status, content_hash,
        feed_bucket, exclusion_reason
      )
      WHERE j.id = v.id`,
      params,
    )
  }
}

async function replaceSources(
  tx: Sql,
  jobIds: string[],
  rows: { id: string; job: ProcessedJob }[],
  now: Date,
) {
  if (jobIds.length === 0) return
  await tx.query("DELETE FROM job_sources WHERE job_id = ANY($1::text[])", [jobIds])
  const sources = rows.flatMap((row) =>
    row.job.sources.map((source) => [
      randomUUID(),
      row.id,
      source.source,
      source.sourceUrl,
      source.applicationUrl,
      source.externalId,
      now.toISOString(),
    ]),
  )
  for (const group of chunks(sources, CHUNK)) {
    const { sql, params } = tuples(group, ["::text", "::text", "::text", "::text", "::text", "::text", "::timestamptz"])
    await tx.query(
      `INSERT INTO job_sources (id, job_id, source, source_url, application_url, external_id, discovered_at)
       VALUES ${sql}`,
      params,
    )
  }
}

async function rememberRunJobs(
  tx: Sql,
  runId: string,
  fresh: { id: string; job: ProcessedJob; isNew: boolean }[],
  prior: { id: string; job: ProcessedJob }[],
) {
  const rows = [
    ...fresh.map((row) => [runId, row.job.fingerprint, row.job.feedBucket, row.job.exclusionReason, row.isNew]),
    ...prior.map((row) => [runId, row.job.fingerprint, row.job.feedBucket, row.job.exclusionReason, false]),
  ]
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
