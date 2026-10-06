import { describe, expect, it } from "vitest"
import { matchStoredJob, type StoredIdentity } from "@/lib/jobs/identity"

const stored: StoredIdentity = {
  id: "job-1",
  fingerprint: "legacy-description-hash",
  company: "acme",
  title: "product associate",
  city: "Chicago",
  description: "Entry-level product associate in Chicago. 0-1 years. Hybrid three days in the office.",
  urls: ["https://boards.greenhouse.io/acme/jobs/42"],
  atsKeys: ["greenhouse:42"],
  firstSeenAt: "2026-10-01T00:00:00.000Z",
  firstSurfacedAt: "2026-10-01T00:00:00.000Z",
  actions: ["not_interested"],
}

describe("stable job identity", () => {
  it("reuses the ATS id before the URL or the description", () => {
    const match = matchStoredJob(
      {
        fingerprint: "different",
        company: "acme",
        title: "product associate",
        city: "Chicago",
        description: "A rewritten description that would not pass similarity on its own, ".repeat(8),
        urls: ["https://example.com/other"],
        atsKeys: ["greenhouse:42"],
      },
      [stored],
    )
    expect(match?.id).toBe("job-1")
  })

  it("reuses a normalized application URL when the ATS id is absent", () => {
    const match = matchStoredJob(
      {
        fingerprint: "different",
        company: "somewhere else",
        title: "other",
        city: "Austin",
        description: "unrelated",
        urls: ["https://boards.greenhouse.io/acme/jobs/42?gh_src=email&utm_source=share"],
        atsKeys: [],
      },
      [{ ...stored, atsKeys: [] }],
    )
    expect(match?.id).toBe("job-1")
  })

  it("reuses company, title, city, and a similar description", () => {
    const match = matchStoredJob(
      {
        fingerprint: "different",
        company: "Acme",
        title: "Product Associate",
        city: "Chicago",
        description: "Entry-level product associate in Chicago. 0-1 years. Hybrid three days in the office. Listed on LinkedIn.",
        urls: ["https://www.linkedin.com/jobs/view/99"],
        atsKeys: [],
      },
      [{ ...stored, atsKeys: [], urls: ["https://example.com/old"] }],
    )
    expect(match?.id).toBe("job-1")
  })

  it("prefers the row that already has Not Interested feedback", () => {
    const other: StoredIdentity = { ...stored, id: "job-2", actions: [], firstSeenAt: "2026-09-01T00:00:00.000Z" }
    const match = matchStoredJob(
      {
        fingerprint: "legacy-description-hash",
        company: "acme",
        title: "product associate",
        city: "Chicago",
        description: stored.description,
        urls: stored.urls,
        atsKeys: ["greenhouse:42"],
      },
      [other, stored],
    )
    expect(match?.id).toBe("job-1")
  })
})
