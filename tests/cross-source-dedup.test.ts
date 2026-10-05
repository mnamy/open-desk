import { describe, expect, it } from "vitest"
import { applicationPreference, dedupePostings, type SourcePosting } from "@/lib/jobs/dedup"

const BODY =
  "Associate product manager in New York. Talk to listeners, write the first version of a feature, and ship it with a small product team. 0-1 years."

function posting(overrides: Partial<SourcePosting> & Pick<SourcePosting, "source" | "applicationUrl">): SourcePosting {
  return {
    companyName: "Northwind",
    title: "Associate Product Manager",
    city: "New York City",
    description: BODY,
    sourceUrl: overrides.applicationUrl,
    externalId: null,
    atsProvider: null,
    ...overrides,
  }
}

describe("cross-source dedup", () => {
  it("keeps one role when Greenhouse, YC, and the career page list it", () => {
    const groups = dedupePostings([
      posting({
        source: "yc",
        applicationUrl: "https://www.workatastartup.com/jobs/95760",
        description: `${BODY} Listed on YC.`,
      }),
      posting({
        source: "greenhouse",
        applicationUrl: "https://boards.greenhouse.io/northwind/jobs/42",
        externalId: "42",
        atsProvider: "greenhouse",
        description: `${BODY} Apply on Greenhouse.`,
      }),
      posting({
        source: "career_page",
        applicationUrl: "https://northwind.example/careers/associate-product-manager",
        description: `${BODY} On the company careers page.`,
      }),
      posting({
        source: "ashby",
        applicationUrl: "https://jobs.ashbyhq.com/northwind/job-1",
        externalId: "job-1",
        atsProvider: "ashby",
        description: "A different research role about clinic intake and patient interviews.",
        title: "User Research Associate",
      }),
    ])

    const product = groups.find((group) => group.title === "Associate Product Manager")
    expect(product?.postings).toHaveLength(3)
    expect(groups.find((group) => group.title === "User Research Associate")?.postings).toHaveLength(1)
  })
})

describe("canonical URL choice", () => {
  it("prefers the company ATS over YC and any other third-party link", () => {
    const [group] = dedupePostings([
      posting({
        source: "yc",
        applicationUrl: "https://www.workatastartup.com/jobs/95760",
        description: `${BODY} YC.`,
      }),
      posting({
        source: "indeed",
        applicationUrl: "https://www.indeed.com/viewjob?jk=95760",
        description: `${BODY} Indeed.`,
      }),
      posting({
        source: "greenhouse",
        applicationUrl: "https://boards.greenhouse.io/northwind/jobs/42",
        externalId: "42",
        atsProvider: "greenhouse",
        description: `${BODY} Greenhouse.`,
      }),
    ])

    expect(group.applicationUrl).toBe("https://boards.greenhouse.io/northwind/jobs/42")
    expect(applicationPreference("yc", "https://www.workatastartup.com/jobs/95760")).toBeLessThan(
      applicationPreference("indeed", "https://www.indeed.com/viewjob?jk=95760"),
    )
    expect(applicationPreference("greenhouse", group.applicationUrl)).toBeLessThan(
      applicationPreference("yc", "https://www.workatastartup.com/jobs/95760"),
    )
  })

  it("prefers a company apply link carried by YC over the Work at a Startup page", () => {
    const [group] = dedupePostings([
      posting({
        source: "yc",
        applicationUrl: "https://www.workatastartup.com/jobs/95760",
        description: `${BODY} Directory page.`,
      }),
      posting({
        source: "yc",
        applicationUrl: "https://northwind.example/careers/associate-product-manager",
        description: `${BODY} Company apply link from YC.`,
      }),
    ])
    expect(group.applicationUrl).toBe("https://northwind.example/careers/associate-product-manager")
  })
})
