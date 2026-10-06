import { PGlite } from "@electric-sql/pglite"
import { describe, expect, it } from "vitest"
import { applyMigration } from "@/lib/db/client"
import { continueLiveSearch, importPostings, latestSearchRun, listDeskJobs, setFeedback } from "@/lib/db/repository"
import { jobInFeed } from "@/lib/jobs/feeds"
import { normalizeCompanyName } from "@/lib/jobs/text"
import type { LiveCollection } from "@/lib/sources/live-search"
import type { HttpClient } from "@/lib/sources/http"
import type { RawPosting } from "@/lib/sources/types"

const BODY =
  "Entry-level product associate in Chicago. 0-1 years. Hybrid three days in the office. Talk to users and write feature requirements."

function posting(overrides: Partial<RawPosting> = {}): RawPosting {
  return {
    id: "acme-42",
    release: "search",
    source: "greenhouse",
    sourceUrl: "https://boards.greenhouse.io/acme/jobs/42",
    applicationUrl: "https://boards.greenhouse.io/acme/jobs/42",
    externalId: "42",
    atsProvider: "greenhouse",
    atsIdentifier: "acme",
    companyName: "Acme",
    companyWebsite: "https://acme.example",
    industry: "Consumer tech",
    discoveredFrom: "greenhouse",
    title: "Product Associate",
    description: BODY,
    locationRaw: "Chicago, IL",
    arrangementRaw: "Hybrid",
    employmentType: "Full-time",
    postedDaysAgo: 1,
    ...overrides,
  }
}

function live(postings: RawPosting[], companyName = "Acme"): LiveCollection {
  return {
    postings,
    companiesChecked: 1,
    warnings: [],
    staleBoards: [],
    checkedCompanies: [
      {
        name: companyName,
        normalizedName: normalizeCompanyName(companyName),
        atsProvider: "greenhouse",
        atsIdentifier: "acme",
        discoveredFrom: "greenhouse",
        sourceHealth: "ok",
      },
    ],
  }
}

async function memory() {
  const db = new PGlite()
  await applyMigration(db)
  return db
}

describe("job memory across searches", () => {
  it("keeps Not Interested, Saved, and Applied on the same logical job", async () => {
    const db = await memory()
    const firstAt = new Date("2026-10-05T15:00:00Z")
    const first = await importPostings(db, "search", firstAt, live([posting(), posting({
      id: "north-1",
      source: "ashby",
      sourceUrl: "https://jobs.ashbyhq.com/north/job-1",
      applicationUrl: "https://jobs.ashbyhq.com/north/job-1",
      externalId: "job-1",
      atsProvider: "ashby",
      atsIdentifier: "north",
      companyName: "North Co",
      title: "Product Analyst",
      description: "Entry-level product analyst in Chicago. 0-1 years. Hybrid. Talk to customers and write requirements.",
    }), posting({
      id: "south-1",
      sourceUrl: "https://boards.greenhouse.io/acme/jobs/77",
      applicationUrl: "https://boards.greenhouse.io/acme/jobs/77",
      externalId: "77",
      title: "UX Researcher",
      description: "UX researcher in Chicago. 0-1 years. Hybrid. Interview customers and share findings with the product team.",
    })]))

    const jobs = await listDeskJobs(db)
    const associate = jobs.find((job) => job.title === "Product Associate")
    const analyst = jobs.find((job) => job.title === "Product Analyst")
    const research = jobs.find((job) => job.title === "UX Researcher")
    expect(first.jobsNew).toBe(3)
    expect(associate?.isNew).toBe(true)

    await setFeedback(db, associate!.id, "not_interested", { reasons: ["wrong_function"] })
    await setFeedback(db, analyst!.id, "save")
    await setFeedback(db, research!.id, "applied")
    await setFeedback(db, research!.id, "save")

    const seen = await db.query<{ id: string; first_seen_at: Date | string; first_surfaced_at: Date | string }>(
      "SELECT id, first_seen_at, first_surfaced_at FROM jobs WHERE id = $1",
      [associate!.id],
    )

    const second = await importPostings(db, "search", new Date("2026-10-06T15:00:00Z"), live([
      posting({ description: `${BODY} The team updated the posting.` }),
      posting({
        id: "acme-42-linkedin",
        source: "linkedin",
        sourceUrl: "https://www.linkedin.com/jobs/view/99",
        applicationUrl: "https://www.linkedin.com/jobs/view/99?trk=public_jobs",
        externalId: undefined,
        atsProvider: undefined,
        atsIdentifier: undefined,
        description: `${BODY} Listed on LinkedIn.`,
      }),
      posting({
        applicationUrl: "https://boards.greenhouse.io/acme/jobs/42?gh_src=email&utm_source=share",
        sourceUrl: "https://boards.greenhouse.io/acme/jobs/42?gh_src=email",
        title: "product associate",
      }),
    ]))

    expect(second.jobsNew).toBe(0)
    const again = await listDeskJobs(db)
    const hidden = again.find((job) => job.title.toLowerCase() === "product associate")
    expect(again.filter((job) => job.title.toLowerCase() === "product associate")).toHaveLength(1)
    expect(hidden?.id).toBe(associate!.id)
    expect(hidden?.actions).toContain("not_interested")
    expect(hidden?.isNew).toBe(false)
    expect(jobInFeed(hidden!, "all")).toBe(false)
    expect(jobInFeed(hidden!, "hidden")).toBe(true)
    expect(jobInFeed(hidden!, "new")).toBe(false)

    const saved = again.find((job) => job.id === analyst!.id)
    const applied = again.find((job) => job.id === research!.id)
    expect(saved?.actions).toEqual(expect.arrayContaining(["save"]))
    expect(applied?.actions).toEqual(expect.arrayContaining(["save", "applied"]))
    expect(jobInFeed(saved!, "saved")).toBe(true)
    expect(jobInFeed(applied!, "applied")).toBe(true)
    expect(jobInFeed(applied!, "saved")).toBe(false)
    expect(jobInFeed(applied!, "all")).toBe(false)
    expect(jobInFeed(applied!, "top")).toBe(false)
    expect(jobInFeed(applied!, "new")).toBe(false)

    const after = await db.query<{ first_seen_at: Date | string; first_surfaced_at: Date | string }>(
      "SELECT first_seen_at, first_surfaced_at FROM jobs WHERE id = $1",
      [associate!.id],
    )
    expect(new Date(after.rows[0].first_seen_at).toISOString()).toBe(new Date(seen.rows[0].first_seen_at).toISOString())
    expect(new Date(after.rows[0].first_surfaced_at).toISOString()).toBe(new Date(seen.rows[0].first_surfaced_at).toISOString())

    const sources = await db.query<{ source: string }>("SELECT source FROM job_sources WHERE job_id = $1", [associate!.id])
    expect(sources.rows.map((row) => row.source)).toEqual(expect.arrayContaining(["greenhouse", "linkedin"]))

    const company = await db.query<{ ats_identifier: string }>(
      "SELECT ats_identifier FROM companies WHERE normalized_name = 'acme'",
    )
    expect(company.rows[0].ats_identifier).toBe("acme")

    const third = await importPostings(db, "search", new Date("2026-10-07T15:00:00Z"), live([posting()]))
    expect(third.jobsNew).toBe(0)
    const count = await db.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM jobs WHERE normalized_title = 'product associate'")
    expect(count.rows[0].count).toBe("1")
    await db.close()
  }, 30000)

  it("marks a job unavailable after repeated live checks and keeps it in history", async () => {
    const db = await memory()
    await importPostings(db, "search", new Date("2026-10-05T15:00:00Z"), live([
      posting(),
      posting({
        id: "other",
        externalId: "43",
        sourceUrl: "https://boards.greenhouse.io/acme/jobs/43",
        applicationUrl: "https://boards.greenhouse.io/acme/jobs/43",
        title: "Strategy Associate",
        description: "Strategy associate in Chicago. 0-1 years. Hybrid. Work with the product team on a new initiative.",
      }),
    ]))
    const original = (await listDeskJobs(db)).find((job) => job.title === "Product Associate")
    await importPostings(db, "search", new Date("2026-10-06T15:00:00Z"), live([
      posting({
        id: "other",
        externalId: "43",
        sourceUrl: "https://boards.greenhouse.io/acme/jobs/43",
        applicationUrl: "https://boards.greenhouse.io/acme/jobs/43",
        title: "Strategy Associate",
        description: "Strategy associate in Chicago. 0-1 years. Hybrid. Work with the product team on a new initiative.",
      }),
    ]))
    const once = await db.query<{ consecutive_misses: number; availability: string }>(
      "SELECT consecutive_misses, availability FROM jobs WHERE id = $1",
      [original!.id],
    )
    expect(Number(once.rows[0].consecutive_misses)).toBe(1)
    expect(once.rows[0].availability).toBe("active")

    await importPostings(db, "search", new Date("2026-10-07T15:00:00Z"), live([
      posting({
        id: "other",
        externalId: "43",
        sourceUrl: "https://boards.greenhouse.io/acme/jobs/43",
        applicationUrl: "https://boards.greenhouse.io/acme/jobs/43",
        title: "Strategy Associate",
        description: "Strategy associate in Chicago. 0-1 years. Hybrid. Work with the product team on a new initiative.",
      }),
    ]))
    const closed = (await listDeskJobs(db)).find((job) => job.id === original!.id)
    expect(closed?.availability).toBe("unavailable")
    expect(closed?.actions).not.toContain("not_interested")
    expect(jobInFeed(closed!, "all")).toBe(false)
    expect(jobInFeed(closed!, "hidden")).toBe(false)
    const row = await db.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM jobs WHERE id = $1", [original!.id])
    expect(row.rows[0].count).toBe("1")
    await db.close()
  }, 30000)

  it("disables a dead board and still finishes the search", async () => {
    const db = await memory()
    const client: HttpClient = {
      async getJson(url) {
        if (url.includes("/dead/")) throw new Error("404 Not Found")
        if (url.includes("api.ashbyhq.com")) {
          return {
            jobs: [
              {
                id: "job-1",
                title: "Product Associate",
                location: "Chicago, IL",
                descriptionPlain: BODY,
                jobUrl: "https://jobs.ashbyhq.com/ramp/job-1",
                applyUrl: "https://jobs.ashbyhq.com/ramp/job-1/application",
                workplaceType: "Hybrid",
                isListed: true,
              },
            ],
          }
        }
        throw new Error("timed out")
      },
      async getText() {
        throw new Error("timed out")
      },
    }
    const companies = [
      { name: "Dead Co", atsProvider: "greenhouse" as const, atsIdentifier: "dead", website: "https://dead.example" },
      { name: "Ramp", atsProvider: "ashby" as const, atsIdentifier: "ramp", website: "https://ramp.com", industry: "Fintech" },
      { name: "Slow Co", atsProvider: "lever" as const, atsIdentifier: "slow", website: "https://slow.example" },
    ]

    let steps = 0
    let last
    do {
      last = await continueLiveSearch(db, {
        now: new Date("2026-10-05T15:00:00Z"),
        client,
        fetchYc: false,
        fetchMarketplaces: false,
        companies,
      })
      steps += 1
    } while (!last.done && steps < 12)

    expect(last?.done).toBe(true)
    const first = await latestSearchRun(db)
    expect(first?.warnings.some((warning) => warning.includes("Dead Co") && warning.includes("404"))).toBe(true)
    expect(first?.warnings.some((warning) => warning.includes("Slow Co") && warning.includes("timed out"))).toBe(true)
    const disabled = await db.query<{ identifier: string }>("SELECT identifier FROM disabled_sources")
    expect(disabled.rows.map((row) => row.identifier)).toEqual(["dead"])
    expect((await listDeskJobs(db)).some((job) => job.title === "Product Associate")).toBe(true)

    steps = 0
    do {
      last = await continueLiveSearch(db, {
        now: new Date("2026-10-06T15:00:00Z"),
        client,
        fetchYc: false,
        fetchMarketplaces: false,
        companies,
      })
      steps += 1
    } while (!last.done && steps < 12)

    const second = await latestSearchRun(db)
    expect(second?.jobsNew).toBe(0)
    expect(second?.warnings.some((warning) => warning.includes("404"))).toBe(false)
    expect(second?.warnings.some((warning) => warning.includes("Slow Co"))).toBe(true)
    const ids = await db.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM jobs WHERE normalized_title = 'product associate'",
    )
    expect(ids.rows[0].count).toBe("1")
    await db.close()
  }, 30000)
})
