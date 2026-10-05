import { describe, expect, it } from "vitest"
import { careerPostingsFromHtml, discoverCareerPage } from "@/lib/sources/career-page"
import { detectAts } from "@/lib/sources/html"
import type { HttpClient } from "@/lib/sources/http"

const now = new Date("2026-10-05T15:00:00Z")
const company = { name: "Northwind", website: "https://northwind.example", industry: "Music tech" }

describe("generic career-page parsing", () => {
  it("detects a Greenhouse board and does not invent openings from the embed", async () => {
    const html = `<a href="https://boards.greenhouse.io/northwind">See jobs</a>`
    expect(detectAts(html)?.identifier).toBe("northwind")
    const found = await discoverCareerPage(company, client({ "https://northwind.example/careers": html }), now)
    expect(found.ats).toEqual({ provider: "greenhouse", identifier: "northwind" })
    expect(found.careersUrl).toBe("https://northwind.example/careers")
    expect(found.postings).toHaveLength(0)
  })

  it("reads JSON-LD job postings when there is no ATS", () => {
    const html = `
      <script type="application/ld+json">
        ${JSON.stringify({
          "@type": "JobPosting",
          title: "Associate Product Manager",
          description: "<p>0-1 years. Hybrid product work.</p>",
          url: "https://northwind.example/careers/apm",
          datePosted: "2026-10-04",
          jobLocation: { address: { addressLocality: "Austin", addressRegion: "TX" } },
        })}
      </script>`
    const [posting] = careerPostingsFromHtml(html, "https://northwind.example/careers", company, now)
    expect(posting.source).toBe("career_page")
    expect(posting.title).toBe("Associate Product Manager")
    expect(posting.locationRaw).toBe("Austin, TX")
    expect(posting.description).toContain("0-1 years")
    expect(posting.applicationUrl).toBe("https://northwind.example/careers/apm")
    expect(posting.postedDaysAgo).toBe(1)
  })

  it("falls back to job links on a plain career page", () => {
    const html = `<a href="/careers/strategy-associate">Strategy Associate — Chicago</a><a href="/about">About</a>`
    const postings = careerPostingsFromHtml(html, "https://northwind.example/careers", company, now)
    expect(postings).toHaveLength(1)
    expect(postings[0].title).toContain("Strategy Associate")
    expect(postings[0].applicationUrl).toBe("https://northwind.example/careers/strategy-associate")
  })
})

function client(pages: Record<string, string>): HttpClient {
  return {
    async getJson() {
      throw new Error("not used")
    },
    async getText(url: string) {
      if (url in pages) return pages[url]
      throw new Error("404")
    },
  }
}
