import { describe, expect, it } from "vitest"
import { ashbyJobsToPostings } from "@/lib/sources/ashby"
import { greenhouseJobsToPostings } from "@/lib/sources/greenhouse"
import { leverJobsToPostings } from "@/lib/sources/lever"
import { ycDetailToPosting } from "@/lib/sources/yc"

const now = new Date("2026-10-05T15:00:00Z")

describe("Greenhouse normalization", () => {
  it("maps a public board job into the raw posting model", () => {
    const [posting] = greenhouseJobsToPostings(
      [
        {
          id: 42,
          title: "Associate Product Manager",
          absolute_url: "https://boards.greenhouse.io/seatgeek/jobs/42",
          location: { name: "New York, NY" },
          offices: [{ name: "New York" }],
          content: "<p>Entry-level product work. <strong>0–1 years</strong> of experience. Hybrid in New York.</p>",
          first_published: "2026-10-03T15:00:00Z",
        },
      ],
      { name: "SeatGeek", website: "https://seatgeek.com", industry: "Entertainment", atsIdentifier: "seatgeek" },
      now,
    )

    expect(posting.source).toBe("greenhouse")
    expect(posting.companyName).toBe("SeatGeek")
    expect(posting.title).toBe("Associate Product Manager")
    expect(posting.locationRaw).toContain("New York, NY")
    expect(posting.description).toContain("0–1 years")
    expect(posting.description).not.toContain("<p>")
    expect(posting.applicationUrl).toBe("https://boards.greenhouse.io/seatgeek/jobs/42")
    expect(posting.sourceUrl).toBe(posting.applicationUrl)
    expect(posting.externalId).toBe("42")
    expect(posting.atsProvider).toBe("greenhouse")
    expect(posting.postedDaysAgo).toBe(2)
    expect(posting.industry).toBe("Entertainment")
  })
})

describe("Ashby normalization", () => {
  it("keeps the apply URL, workplace type, and plain description", () => {
    const [posting] = ashbyJobsToPostings(
      [
        {
          id: "job-1",
          title: "Product Associate",
          location: "Chicago, IL",
          secondaryLocations: ["Austin, TX"],
          descriptionPlain: "New grad product associate. 0-1 years preferred.",
          jobUrl: "https://jobs.ashbyhq.com/ramp/job-1",
          applyUrl: "https://jobs.ashbyhq.com/ramp/job-1/application",
          publishedAt: "2026-10-04T15:00:00Z",
          employmentType: "FullTime",
          workplaceType: "Hybrid",
          isListed: true,
        },
      ],
      { name: "Ramp", website: "https://ramp.com", industry: "Fintech", atsIdentifier: "ramp" },
      now,
    )

    expect(posting.source).toBe("ashby")
    expect(posting.companyName).toBe("Ramp")
    expect(posting.locationRaw).toBe("Chicago, IL · Austin, TX")
    expect(posting.arrangementRaw).toBe("Hybrid")
    expect(posting.applicationUrl).toBe("https://jobs.ashbyhq.com/ramp/job-1/application")
    expect(posting.sourceUrl).toBe("https://jobs.ashbyhq.com/ramp/job-1")
    expect(posting.externalId).toBe("job-1")
    expect(posting.atsProvider).toBe("ashby")
    expect(posting.description).toContain("0-1 years")
    expect(posting.postedDaysAgo).toBe(1)
  })
})

describe("Lever normalization", () => {
  it("combines the posting sections and hosted URL", () => {
    const [posting] = leverJobsToPostings(
      [
        {
          id: "abc",
          text: "Strategy Associate",
          categories: { location: "Boston, MA", commitment: "Full-time", allLocations: ["Boston, MA", "Miami, FL"] },
          descriptionPlain: "Help the operations team in Boston.",
          openingPlain: "0-1 years of experience.",
          hostedUrl: "https://jobs.lever.co/spotify/abc",
          applyUrl: "https://jobs.lever.co/spotify/abc/apply",
          createdAt: Date.parse("2026-10-05T12:00:00Z"),
          workplaceType: "on-site",
        },
      ],
      { name: "Spotify", website: "https://www.spotify.com", industry: "Music tech", atsIdentifier: "spotify" },
      now,
    )

    expect(posting.source).toBe("lever")
    expect(posting.title).toBe("Strategy Associate")
    expect(posting.locationRaw).toBe("Boston, MA · Miami, FL")
    expect(posting.arrangementRaw).toBe("On-site")
    expect(posting.description).toContain("0-1 years of experience.")
    expect(posting.applicationUrl).toContain("/apply")
    expect(posting.sourceUrl).toBe("https://jobs.lever.co/spotify/abc")
    expect(posting.externalId).toBe("abc")
    expect(posting.atsProvider).toBe("lever")
    expect(posting.postedDaysAgo).toBe(0)
  })
})

describe("YC normalization", () => {
  it("reads a Work at a Startup job page into the same model", () => {
    const html = `<div data-page="${escapeAttr(
      JSON.stringify({
        props: {
          job: {
            id: 95760,
            title: "Product Associate",
            location: "New York, NY",
            jobType: "Full-time",
            descriptionHtml: "<p>Entry-level product work with listeners in New York. 0-1 years.</p>",
          },
          company: {
            name: "Northwind",
            url: "https://northwind.example",
            industry: "Music tech",
          },
        },
      }),
    )}"></div>`

    const posting = ycDetailToPosting(html, now)
    expect(posting?.source).toBe("yc")
    expect(posting?.companyName).toBe("Northwind")
    expect(posting?.title).toBe("Product Associate")
    expect(posting?.locationRaw).toBe("New York, NY")
    expect(posting?.description).toContain("0-1 years")
    expect(posting?.applicationUrl).toBe("https://www.workatastartup.com/jobs/95760")
    expect(posting?.sourceUrl).toBe(posting?.applicationUrl)
    expect(posting?.externalId).toBe("95760")
    expect(posting?.companyWebsite).toBe("https://northwind.example")
    expect(posting?.industry).toBe("Music tech")
    expect(posting?.postedDaysAgo).toBeNull()
  })
})

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;")
}
