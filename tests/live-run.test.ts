import { describe, expect, it } from "vitest"
import { getDb } from "@/lib/db/client"
import { importLiveSearch } from "@/lib/db/repository"

const enabled = process.env.LIVE_SEARCH === "1"

describe.skipIf(!enabled)("live search", () => {
  it("checks Greenhouse, Ashby, Lever, YC, and career pages", async () => {
    const db = await getDb()
    const summary = await importLiveSearch(db)
    console.log(JSON.stringify(summary, null, 2))
    expect(summary.companiesChecked).toBeGreaterThan(0)
    expect(summary.postingsFetched).toBeGreaterThan(0)
  }, 600_000)
})
