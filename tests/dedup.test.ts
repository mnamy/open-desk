import { describe, expect, it } from "vitest"
import { applicationPreference, dedupePostings, type SourcePosting } from "@/lib/jobs/dedup"

const BODY =
  "Associate product manager on the discovery team. Talk to listeners, write feature requirements, and launch small experiments with a four person product team at an early stage music company in New York."

function posting(overrides: Partial<SourcePosting> & Pick<SourcePosting, "source" | "applicationUrl">): SourcePosting {
  return {
    companyName: "Lumen & Co",
    title: "Associate Product Manager",
    city: "New York City",
    description: BODY,
    sourceUrl: overrides.applicationUrl,
    externalId: null,
    atsProvider: null,
    ...overrides,
  }
}

describe("canonical application URL", () => {
  it("shows a LinkedIn and Greenhouse pair once and prefers the Greenhouse URL", () => {
    const groups = dedupePostings([
      posting({
        source: "linkedin",
        applicationUrl: "https://www.linkedin.com/jobs/view/4829103341?trk=public_jobs",
        sourceUrl: "https://www.linkedin.com/jobs/view/4829103341",
        description: `${BODY} Listed on LinkedIn.`,
      }),
      posting({
        source: "greenhouse",
        applicationUrl: "https://boards.greenhouse.io/lumenco/jobs/5738291",
        sourceUrl: "https://boards.greenhouse.io/lumenco/jobs/5738291",
        description: `${BODY} Apply on the company board.`,
        externalId: "5738291",
        atsProvider: "greenhouse",
      }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].postings).toHaveLength(2)
    expect(groups[0].applicationUrl).toBe("https://boards.greenhouse.io/lumenco/jobs/5738291")
    expect(groups[0].canonicalSource).toBe("greenhouse")
    expect(groups[0].applicationUrl).not.toContain("linkedin.com")
  })

  it("prefers a company career page over YC and LinkedIn", () => {
    const groups = dedupePostings([
      posting({
        source: "linkedin",
        applicationUrl: "https://www.linkedin.com/jobs/view/1",
      }),
      posting({
        source: "yc",
        applicationUrl: "https://www.workatastartup.com/jobs/99",
        description: `${BODY} YC listing.`,
      }),
      posting({
        source: "career_page",
        applicationUrl: "https://lumenco.example/careers/associate-product-manager",
        description: `${BODY} Company careers page.`,
      }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].applicationUrl).toBe("https://lumenco.example/careers/associate-product-manager")
  })

  it("prefers YC over LinkedIn when that is the direct link", () => {
    const groups = dedupePostings([
      posting({
        source: "linkedin",
        applicationUrl: "https://www.linkedin.com/jobs/view/1",
      }),
      posting({
        source: "yc",
        applicationUrl: "https://www.workatastartup.com/jobs/99",
        description: `${BODY} YC listing.`,
      }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].applicationUrl).toBe("https://www.workatastartup.com/jobs/99")
  })

  it("keeps LinkedIn when it is the only URL", () => {
    const groups = dedupePostings([
      posting({
        source: "linkedin",
        applicationUrl: "https://www.linkedin.com/jobs/view/9001123",
      }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].applicationUrl).toBe("https://www.linkedin.com/jobs/view/9001123")
  })

  it("does not merge different roles at the same company", () => {
    const groups = dedupePostings([
      posting({
        source: "greenhouse",
        applicationUrl: "https://boards.greenhouse.io/lumenco/jobs/1",
        title: "Associate Product Manager",
      }),
      posting({
        source: "greenhouse",
        applicationUrl: "https://boards.greenhouse.io/lumenco/jobs/2",
        title: "User Research Associate",
        description: "Interview patients about clinic intake and synthesize themes for the product trio.",
      }),
    ])

    expect(groups).toHaveLength(2)
  })

  it("does not merge the same title when the descriptions are different jobs", () => {
    const groups = dedupePostings([
      posting({
        source: "greenhouse",
        applicationUrl: "https://boards.greenhouse.io/lumenco/jobs/1",
        description: BODY,
      }),
      posting({
        source: "linkedin",
        applicationUrl: "https://www.linkedin.com/jobs/view/2",
        description:
          "Manage paid social campaigns and quarterly brand budgets for the marketing organization across regions.",
      }),
    ])

    expect(groups).toHaveLength(2)
  })

  it("merges on ATS job id even when the title wording differs", () => {
    const groups = dedupePostings([
      posting({
        source: "greenhouse",
        applicationUrl: "https://boards.greenhouse.io/lumenco/jobs/5738291",
        title: "Associate Product Manager",
        externalId: "5738291",
        atsProvider: "greenhouse",
      }),
      posting({
        source: "greenhouse",
        applicationUrl: "https://boards.greenhouse.io/lumenco/jobs/5738291?utm_source=share",
        title: "APM",
        description: "A shorter board card.",
        externalId: "5738291",
        atsProvider: "greenhouse",
      }),
    ])

    expect(groups).toHaveLength(1)
    expect(applicationPreference("greenhouse", groups[0].applicationUrl)).toBeLessThan(
      applicationPreference("linkedin", "https://www.linkedin.com/jobs/view/1"),
    )
  })
})
