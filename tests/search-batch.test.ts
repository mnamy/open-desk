import { PGlite } from "@electric-sql/pglite"
import { describe, expect, it } from "vitest"
import { applyMigration } from "@/lib/db/client"
import { continueLiveSearch, latestSearchRun, listDeskJobs } from "@/lib/db/repository"
import { runSummary } from "@/lib/jobs/view"
import type { HttpClient } from "@/lib/sources/http"

const now = new Date("2026-10-05T15:00:00Z")

describe("batched live search", () => {
  it("keeps a healthy board when an earlier board fails and finishes the run", async () => {
    const db = new PGlite()
    await applyMigration(db)
    const client: HttpClient = {
      async getJson(url) {
        if (url.includes("/broken/")) throw new Error("timed out")
        if (url.includes("api.ashbyhq.com")) {
          return {
            jobs: [
              {
                id: "job-1",
                title: "Product Associate",
                location: "Chicago, IL",
                descriptionPlain: "Entry-level product associate in Chicago. 0-1 years. Hybrid three days in the office.",
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

    let steps = 0
    let last
    do {
      last = await continueLiveSearch(db, {
        now,
        client,
        fetchYc: false,
        fetchMarketplaces: false,
        companies: [
          { name: "Broken Co", atsProvider: "greenhouse", atsIdentifier: "broken", website: "https://broken.example" },
          { name: "Ramp", atsProvider: "ashby", atsIdentifier: "ramp", website: "https://ramp.com", industry: "Fintech" },
        ],
      })
      steps += 1
    } while (!last.done && steps < 12)

    expect(last?.done).toBe(true)
    const jobs = await listDeskJobs(db)
    expect(jobs.some((job) => job.title === "Product Associate" && job.city === "Chicago")).toBe(true)
    const run = await latestSearchRun(db)
    expect(run?.status).toBe("complete")
    expect(run?.warnings.some((warning) => warning.includes("Broken Co") && warning.includes("timed out"))).toBe(true)
    expect(run?.companiesChecked).toBe(2)
    expect(runSummary(run)).toContain("Checked 2 companies")
    await db.close()
  })

  it("saves a large board across passes and keeps a null byte from aborting the write", async () => {
    const db = new PGlite()
    await applyMigration(db)
    const jobs = Array.from({ length: 45 }, (_, index) => ({
      id: index + 1,
      title: `Operator ${index}`,
      absolute_url: `https://boards.greenhouse.io/bigco/jobs/${index + 1}`,
      location: { name: "Chicago, IL" },
      content: index === 0 ? "Chicago hybrid role. 0-1 years.\u0000 Own the operating plan." : "Chicago hybrid role. 0-1 years.",
    }))
    const client: HttpClient = {
      async getJson(url) {
        if (url.includes("/bigco/")) return { jobs }
        throw new Error("timed out")
      },
      async getText() {
        throw new Error("timed out")
      },
    }
    const companies = [{ name: "Big Co", atsProvider: "greenhouse" as const, atsIdentifier: "bigco", website: "https://big.example" }]

    const first = await continueLiveSearch(db, { now, client, fetchYc: false, fetchMarketplaces: false, companies })
    expect(first.done).toBe(false)
    expect(first.progress).toContain("fetched 40 postings")

    let steps = 0
    let last = first
    do {
      last = await continueLiveSearch(db, { now, client, fetchYc: false, fetchMarketplaces: false, companies })
      steps += 1
    } while (!last.done && steps < 8)

    expect(last.done).toBe(true)
    const stored = await db.query<{ count: string; description: string }>(
      "SELECT COUNT(*)::text AS count, MIN(description) AS description FROM jobs",
    )
    expect(stored.rows[0].count).toBe("45")
    const poisoned = await db.query<{ description: string }>(
      "SELECT description FROM jobs WHERE source_url = 'https://boards.greenhouse.io/bigco/jobs/1'",
    )
    expect(poisoned.rows[0].description.includes("\u0000")).toBe(false)
    expect(poisoned.rows[0].description).toContain("operating plan")
    await db.close()
  })
})
