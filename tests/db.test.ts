import { PGlite } from "@electric-sql/pglite"
import { describe, expect, it } from "vitest"
import { applyMigration } from "@/lib/db/client"
import { importPostings, listDeskJobs, setFeedback } from "@/lib/db/repository"
import { jobInFeed } from "@/lib/jobs/feeds"

describe("local database", () => {
  it("seeds, dedupes, hides excluded roles, and flags only new search results", async () => {
    const db = new PGlite()
    await applyMigration(db)
    await importPostings(db, "seed", new Date("2026-10-05T15:00:00Z"))

    const seeded = await listDeskJobs(db)
    const lumen = seeded.find((job) => job.companyName === "Lumen & Co" && job.title === "Associate Product Manager")
    expect(lumen?.sources.map((source) => source.source).sort()).toEqual(["greenhouse", "linkedin"])
    expect(lumen?.applicationUrl).toBe("https://boards.greenhouse.io/lumenco/jobs/5738291")
    expect(lumen?.isNew).toBe(false)
    expect(seeded.some((job) => job.title === "Product Operations Associate")).toBe(false)
    expect(seeded.some((job) => job.companyName === "Brightline")).toBe(false)
    expect(seeded.some((job) => job.companyName === "Halden")).toBe(false)

    const cache = await db.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM classification_cache")
    expect(Number(cache.rows[0].count)).toBeGreaterThan(0)

    const summary = await importPostings(db, "search", new Date("2026-10-05T16:00:00Z"))
    expect(summary.jobsNew).toBe(2)
    const searched = await listDeskJobs(db)
    const arrived = searched.find((job) => job.title === "Product Operations Associate")
    expect(arrived?.isNew).toBe(true)
    expect(arrived?.feedBucket).toBe("main")
    expect(searched.find((job) => job.id === lumen?.id)?.isNew).toBe(false)

    await setFeedback(db, lumen!.id, "save")
    await setFeedback(db, lumen!.id, "not_interested", { reasons: ["wrong_function"], note: "Not the work I want" })
    const hidden = (await listDeskJobs(db)).find((job) => job.id === lumen?.id)
    expect(hidden?.actions).toContain("save")
    expect(hidden?.actions).toContain("not_interested")
    expect(jobInFeed(hidden!, "hidden")).toBe(true)
    expect(jobInFeed(hidden!, "top")).toBe(false)

    await setFeedback(db, lumen!.id, "restore")
    const restored = (await listDeskJobs(db)).find((job) => job.id === lumen?.id)
    expect(restored?.actions).not.toContain("not_interested")
    expect(restored?.actions).toContain("save")

    await db.close()
  }, 30000)
})