import { describe, expect, it } from "vitest"
import { wellfoundHtmlToPostings } from "@/lib/sources/wellfound"
import { readWelcomeConfig, welcomeHitsToPostings, type WelcomeHit } from "@/lib/sources/welcome"

const now = new Date("2026-10-05T15:00:00Z")

describe("Wellfound normalization", () => {
  it("reads public role-page jobs and prefers an ATS apply link", () => {
    const html = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: {
        pageProps: {
          role: "product-manager",
          location: "new-york",
          apolloState: {
            data: {
              "StartupResult:1": {
                __typename: "StartupResult",
                id: "1",
                name: "Harmony",
                slug: "harmony",
                highConcept: "Fintech",
                highlightedJobListings: [{ __ref: "JobListingSearchResult:99" }],
              },
              "JobListingSearchResult:99": {
                __typename: "JobListingSearchResult",
                id: "99",
                title: "Product Associate",
                slug: "product-associate",
                description: "Talk to users in New York. Apply at https://boards.greenhouse.io/harmony/jobs/99.",
                jobType: "full-time",
                locationNames: ["New York City"],
                remote: false,
                remoteConfig: { kind: "ONSITE", wfhFlexible: true },
                yearsExperienceMin: null,
                liveStartAt: "2026-10-01T00:00:00Z",
              },
            },
          },
        },
      },
    })}</script></html>`

    const [posting] = wellfoundHtmlToPostings(html, now)
    expect(posting?.source).toBe("wellfound")
    expect(posting?.companyName).toBe("Harmony")
    expect(posting?.title).toBe("Product Associate")
    expect(posting?.locationRaw).toBe("New York City")
    expect(posting?.arrangementRaw).toBe("Hybrid")
    expect(posting?.applicationUrl).toBe("https://boards.greenhouse.io/harmony/jobs/99")
    expect(posting?.sourceUrl).toBe("https://wellfound.com/jobs/99-product-associate")
    expect(posting?.discoveredFrom).toBe("wellfound")
  })

  it("returns nothing when the page is not a role search", () => {
    expect(wellfoundHtmlToPostings("<html>no data</html>", now)).toEqual([])
  })
})

describe("Welcome to the Jungle normalization", () => {
  it("reads the public search config and a job hit", () => {
    const html = `window.env = {"ALGOLIA_APPLICATION_ID":"APP","ALGOLIA_API_KEY_CLIENT":"key","ALGOLIA_JOBS_INDEX_PREFIX":"wttj_jobs_production"}\nwindow._toCdnUrl`
    expect(readWelcomeConfig(html)).toEqual({
      appId: "APP",
      apiKey: "key",
      indexName: "wttj_jobs_production_en",
    })
    expect(readWelcomeConfig("<html></html>")).toBeNull()

    const hit: WelcomeHit = {
      name: "Product Associate",
      slug: "product-associate_new-york",
      reference: "job-1",
      summary: "Talk to users and write what to build.",
      key_missions: ["Interview customers in the New York office."],
      contract_type: "full_time",
      remote: "partial",
      experience_level_minimum: 2,
      published_at: "2026-10-01T00:00:00Z",
      offices: [
        { city: "Toronto" },
        { city: "New York" },
      ],
      organization: { name: "Northwind", slug: "northwind" },
      sectors: [{ parent_name: "Consumer technology" }],
    }
    const [posting] = welcomeHitsToPostings([hit], now)
    expect(posting?.source).toBe("welcome_to_the_jungle")
    expect(posting?.companyName).toBe("Northwind")
    expect(posting?.locationRaw).toBe("New York")
    expect(posting?.arrangementRaw).toBe("Hybrid")
    expect(posting?.employmentType).toBe("Full-time")
    expect(posting?.description).toContain("2 years of experience.")
    expect(posting?.applicationUrl).toBe(
      "https://www.welcometothejungle.com/en/companies/northwind/jobs/product-associate_new-york",
    )
    expect(posting?.industry).toBe("Consumer technology")
  })
})
