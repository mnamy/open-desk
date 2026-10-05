import { describe, expect, it } from "vitest"
import { processPostings } from "@/lib/jobs/pipeline"
import { collectLivePostings } from "@/lib/sources/live-search"
import type { HttpClient } from "@/lib/sources/http"

const now = new Date("2026-10-05T15:00:00Z")

describe("live pipeline with partial source failures", () => {
  it("keeps jobs from healthy sources when one board fails", async () => {
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
        throw new Error(`unexpected ${url}`)
      },
      async getText() {
        throw new Error("unused")
      },
    }

    const collected = await collectLivePostings({
      now,
      fetchYc: false,
      discoverCareers: false,
      client,
      companies: [
        { name: "Broken Co", atsProvider: "greenhouse", atsIdentifier: "broken", website: "https://broken.example" },
        { name: "Ramp", atsProvider: "ashby", atsIdentifier: "ramp", website: "https://ramp.com", industry: "Fintech" },
      ],
    })

    expect(collected.warnings.some((warning) => warning.includes("Broken Co") && warning.includes("timed out"))).toBe(true)
    expect(collected.postings).toHaveLength(1)
    expect(collected.companiesChecked).toBe(2)

    const processed = await processPostings(collected.postings, now)
    const job = processed.find((item) => item.title === "Product Associate")
    expect(job?.feedBucket).toBe("main")
    expect(job?.normalizedCity).toBe("Chicago")
    expect(job?.workArrangement).toBe("hybrid")
    expect(job?.applicationUrl).toContain("ashbyhq.com")
    expect(job?.sources[0]?.source).toBe("ashby")
  })
})
