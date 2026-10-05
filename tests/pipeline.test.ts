import { describe, expect, it } from "vitest"
import { SAMPLE_POSTINGS } from "@/data/sample-postings"
import { processPostings } from "@/lib/jobs/pipeline"

describe("sample pipeline", () => {
  it("dedupes, filters, and scores the imported set", async () => {
    const jobs = await processPostings(SAMPLE_POSTINGS, new Date("2026-10-05T15:00:00Z"))
    const byTitle = (company: string, title: string) =>
      jobs.find((job) => job.companyName === company && job.title === title)

    const lumen = byTitle("Lumen & Co", "Associate Product Manager")
    expect(lumen).toBeDefined()
    expect(jobs.filter((job) => job.title === "Associate Product Manager" && job.companyName === "Lumen & Co")).toHaveLength(1)
    expect(lumen?.sources.map((source) => source.source).sort()).toEqual(["greenhouse", "linkedin"])
    expect(lumen?.applicationUrl).toBe("https://boards.greenhouse.io/lumenco/jobs/5738291")
    expect(lumen?.feedBucket).toBe("main")
    expect(lumen?.opportunityFit).toBeGreaterThanOrEqual(75)
    expect(lumen?.qualificationRisk).toBe("MEDIUM")
    expect(lumen?.whyMatch).toContain("listeners")
    expect(lumen?.stretchReason.toLowerCase()).toContain("experimentation tools")

    const seniorTitle = byTitle("Kindred Social", "Senior Product Manager")
    expect(seniorTitle?.feedBucket).toBe("excluded")
    expect(seniorTitle?.exclusionReason).toBe("seniority")
    expect(seniorTitle?.experienceLabel).toBe("0–1 years")

    expect(byTitle("Northshore Health", "Customer Experience Associate")?.workArrangement).toBe("unclear")
    expect(byTitle("Northshore Health", "Customer Experience Associate")?.feedBucket).toBe("main")

    expect(byTitle("Fieldnote", "Product Strategy Associate")?.feedBucket).toBe("main")
    expect(byTitle("Barton Supply", "Business Operations Associate")?.feedBucket).toBe("main")
    expect(byTitle("Harborlight", "UX Researcher")?.feedBucket).toBe("stretch")
    expect(byTitle("Kindred Social", "Growth Strategy Analyst")?.feedBucket).toBe("stretch")
    expect(byTitle("Fieldnote", "Product Strategy Associate")?.qualificationRisk).toBe("MEDIUM")
    expect(byTitle("Fieldnote", "Product Strategy Associate")?.opportunityFit).toBeGreaterThanOrEqual(75)

    expect(byTitle("Wayline", "Product Associate")?.exclusionReason).toBe("remote")
    expect(byTitle("Sable", "Associate Product Manager, Distributed")?.exclusionReason).toBe("location")
    expect(byTitle("Brightline", "Associate Product Manager")?.exclusionReason).toBe("location")
    expect(byTitle("Cedar Study", "Junior UX Researcher")?.exclusionReason).toBe("location")
    expect(byTitle("Halden", "Product Operations Associate")?.exclusionReason).toBe("experience")
    expect(byTitle("Cove Strategy", "Strategy Associate")?.exclusionReason).toBe("experience")
    expect(byTitle("Cinder Metals", "Design Engineer")?.exclusionReason).toBe("relevance")

    const sdr = byTitle("Relay Outreach", "Sales Development Representative")
    expect(sdr?.feedBucket).toBe("excluded")
    expect(sdr?.exclusionReason).toBe("sales")
    expect(sdr?.opportunityFit).toBeNull()

    const undated = byTitle("Fieldnote", "Strategy & Operations Associate")
    expect(undated?.postedAt).toBeNull()
    expect(undated?.feedBucket).toBe("main")

    const cities = new Set(jobs.filter((job) => job.feedBucket !== "excluded").map((job) => job.normalizedCity))
    expect(cities).toEqual(new Set(["New York City", "Chicago", "Boston", "Miami", "Austin"]))
  })
})
