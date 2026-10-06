import { describe, expect, it } from "vitest"
import { jobInFeed, type FeedJob } from "@/lib/jobs/feeds"
import {
  FEATURE_CAP,
  TOTAL_CAP,
  adjustRanking,
  buildProfile,
  featureWeight,
  summarizeProfile,
  type FeatureInput,
  type LearningEvent,
} from "@/lib/jobs/preferences"
import { normalizeCompanyName } from "@/lib/jobs/text"

function role(overrides: Partial<FeatureInput> & Pick<FeatureInput, "id" | "title" | "description">): FeatureInput {
  return {
    companyName: "Northwind",
    industry: null,
    roleFamily: null,
    workArrangement: "hybrid",
    city: "New York",
    ...overrides,
  }
}

const productCopy =
  "Entry-level hybrid role in New York. 0-1 years. Product strategy for a consumer music startup. Talk to users, run user research, and own a 0 to 1 feature with the founding team."

function productJob(id: string, company: string, title = "Product Strategy Associate"): FeatureInput {
  return role({
    id,
    title,
    companyName: company,
    industry: "Consumer technology",
    description: productCopy,
  })
}

function technicalJob(id: string): FeatureInput {
  return role({
    id,
    title: "Product Associate",
    companyName: `Apex ${id}`,
    description:
      "Entry-level hybrid product associate in New York. 0-1 years. Write technical specifications, query SQL, and debug API issues with the data pipeline.",
  })
}

function salesJob(id: string): FeatureInput {
  return role({
    id,
    title: "Product Associate",
    companyName: `Relay ${id}`,
    description:
      "Entry-level hybrid product associate in New York. 0-1 years. Spend most of the week on sales conversations and the outbound pipeline.",
  })
}

function event(jobId: string, action: LearningEvent["action"], reasons: string[] = [], day = 1): LearningEvent {
  return { jobId, action, reasons, createdAt: new Date(`2026-10-0${day}T12:00:00Z`) }
}

function feed(actions: string[], extras: Partial<FeedJob> = {}): FeedJob {
  return {
    feedBucket: "main",
    isNew: true,
    opportunityFit: 88,
    actions,
    availability: "active",
    ...extras,
  }
}

describe("applied roles leave discovery feeds", () => {
  it("keeps an applied role only on Applied, including when it is also saved", () => {
    const applied = feed(["applied", "save"])
    expect(jobInFeed(applied, "applied")).toBe(true)
    expect(jobInFeed(applied, "top")).toBe(false)
    expect(jobInFeed(applied, "new")).toBe(false)
    expect(jobInFeed(applied, "all")).toBe(false)
    expect(jobInFeed(applied, "stretch")).toBe(false)
    expect(jobInFeed(applied, "saved")).toBe(false)
    expect(jobInFeed(applied, "hidden")).toBe(false)
  })

  it("restores the role when Applied is cleared, unless it is hidden or unavailable", () => {
    expect(jobInFeed(feed(["save"]), "top")).toBe(true)
    expect(jobInFeed(feed(["save"]), "all")).toBe(true)
    expect(jobInFeed(feed(["save"]), "new")).toBe(true)
    expect(jobInFeed(feed(["save"]), "saved")).toBe(true)
    expect(jobInFeed(feed(["not_interested"]), "all")).toBe(false)
    expect(jobInFeed(feed(["not_interested"]), "hidden")).toBe(true)
    expect(jobInFeed(feed([], { availability: "unavailable" }), "all")).toBe(false)
    expect(jobInFeed(feed(["applied"], { feedBucket: "stretch" }), "stretch")).toBe(false)
    expect(jobInFeed(feed([], { feedBucket: "stretch", opportunityFit: 60 }), "stretch")).toBe(true)
  })

  it("does not let a learned boost put an ineligible role on a discovery feed", () => {
    const excluded = feed([], { feedBucket: "excluded", opportunityFit: 90 })
    expect(jobInFeed(excluded, "top")).toBe(false)
    expect(jobInFeed(excluded, "all")).toBe(false)
    expect(jobInFeed(excluded, "new")).toBe(false)
    expect(jobInFeed({ ...excluded, actions: ["applied"] }, "applied")).toBe(true)
    expect(jobInFeed({ ...excluded, actions: ["applied"] }, "top")).toBe(false)
    const mediocre = feed([], { opportunityFit: 70 })
    expect(jobInFeed(mediocre, "top")).toBe(false)
    expect(jobInFeed(mediocre, "all")).toBe(true)
  })
})

describe("preference learning", () => {
  it("moves a technical role a little after one rejection and more after repeated ones", () => {
    const jobs = [technicalJob("t1"), technicalJob("t2"), technicalJob("t3"), technicalJob("t4"), productJob("p1", "Northwind")]
    const once = buildProfile(jobs, [event("t1", "not_interested", ["too_technical"])])
    const onceDelta = adjustRanking(technicalJob("future"), once, 80).delta
    expect(onceDelta).toBeLessThan(-0.5)
    expect(onceDelta).toBeGreaterThan(-2.2)
    expect(adjustRanking(productJob("other", "Kindred"), once, 80).delta).toBe(0)
    expect(adjustRanking(technicalJob("future"), once, 80).note).toBeNull()

    const repeated = buildProfile(jobs, [
      event("t1", "not_interested", ["too_technical"], 1),
      event("t2", "not_interested", ["too_technical"], 2),
      event("t3", "not_interested", ["too_technical"], 3),
      event("t4", "not_interested", ["too_technical"], 4),
    ])
    const repeatedDelta = adjustRanking(technicalJob("future"), repeated, 80).delta
    expect(repeatedDelta).toBeLessThan(onceDelta)
    expect(featureWeight(repeated, "exposure:technical")).toBeGreaterThanOrEqual(-FEATURE_CAP)
    expect(repeatedDelta).toBeGreaterThanOrEqual(-TOTAL_CAP)
    expect(adjustRanking(technicalJob("future"), repeated, 80).note).toMatch(/Ranked lower/i)
    expect(adjustRanking(technicalJob("future"), repeated, 80).note).toMatch(/technical/i)
  })

  it("learns the dimension the reason names", () => {
    const marketing = role({
      id: "m1",
      title: "Product Associate",
      companyName: "Billboard",
      industry: "Consumer technology",
      description: "Entry-level hybrid role. 0-1 years. Run brand campaigns, social media, and performance marketing.",
    })
    const fintech = productJob("f1", "Ledger")
    fintech.industry = "Fintech"
    fintech.description = "Entry-level hybrid product associate in New York. 0-1 years. Payments and banking product work."
    const company = productJob("c1", "Initech")
    const duties = role({
      id: "d1",
      title: "Product Associate",
      companyName: "Globex",
      description:
        "Entry-level hybrid role in New York. 0-1 years. Enterprise implementation, business operations, and process improvement for a larger company.",
    })
    const wrong = role({
      id: "w1",
      title: "Growth Associate",
      companyName: "Spark",
      description: "Entry-level hybrid growth associate. 0-1 years. Run experiments with the product team.",
    })

    const profile = buildProfile(
      [marketing, fintech, company, duties, wrong],
      [
        event("m1", "not_interested", ["too_marketing"]),
        event("f1", "not_interested", ["industry"]),
        event("c1", "not_interested", ["company"]),
        event("d1", "not_interested", ["responsibilities"]),
        event("w1", "not_interested", ["wrong_function"]),
      ],
    )

    expect(featureWeight(profile, "exposure:marketing")).toBeLessThan(0)
    expect(featureWeight(profile, `company:${normalizeCompanyName("Billboard")}`)).toBe(0)
    expect(featureWeight(profile, "industry:fintech")).toBeLessThan(0)
    expect(featureWeight(profile, `company:${normalizeCompanyName("Ledger")}`)).toBe(0)
    expect(featureWeight(profile, `company:${normalizeCompanyName("Initech")}`)).toBeLessThan(0)
    expect(featureWeight(profile, "role:Product")).toBe(0)
    expect(featureWeight(profile, `company:${normalizeCompanyName("Globex")}`)).toBe(0)
    expect(featureWeight(profile, "exposure:operations")).toBeLessThan(0)
    expect(featureWeight(profile, "role:Growth")).toBeLessThan(0)

    const sibling = { ...duties, id: "d2", companyName: "Other Co" }
    expect(adjustRanking(sibling, profile, 70).delta).toBeLessThan(0)
    expect(featureWeight(profile, `company:${normalizeCompanyName("Other Co")}`)).toBe(0)
  })

  it("boosts later roles that share applied traits without requiring the same title", () => {
    const applied = [
      productJob("a1", "Northwind"),
      productJob("a2", "Lullaby", "Founder's Associate"),
      productJob("a3", "Chorus", "Associate Product Manager"),
    ]
    const profile = buildProfile(applied, applied.map((job, index) => event(job.id, "applied", [], index + 1)))
    const similar = productJob("next", "Harbor", "Strategy Associate")
    similar.description =
      "Entry-level hybrid strategy associate in New York. 0-1 years. Product strategy for a consumer social startup. User research and a 0 to 1 roadmap with the founding team."
    const unrelated = role({
      id: "ops",
      title: "Business Operations Associate",
      companyName: "Umbrella",
      description: "Entry-level hybrid business operations associate in Chicago. 0-1 years. Process improvement and scheduling for a larger company.",
    })
    const similarDelta = adjustRanking(similar, profile, 78).delta
    const unrelatedDelta = adjustRanking(unrelated, profile, 78).delta
    expect(similarDelta).toBeGreaterThan(1)
    expect(similarDelta).toBeGreaterThan(unrelatedDelta)
    expect(similarDelta).toBeLessThanOrEqual(TOTAL_CAP)
    expect(adjustRanking(similar, profile, 78).note).toMatch(/Ranked higher because you've applied to similar/i)

    const onlyRole = role({
      id: "plain",
      title: "Product Associate",
      companyName: "Plain Co",
      city: "Austin",
      description: "Entry-level hybrid associate in Austin. 0-1 years. Coordinates a weekly status update.",
    })
    const only = adjustRanking(onlyRole, profile, 70)
    expect(only.delta).toBeLessThanOrEqual(FEATURE_CAP)
    expect(70 + only.delta).toBeLessThan(80)
  })

  it("caps learned weights and ignores feedback from before a reset", () => {
    const jobs = Array.from({ length: 8 }, (_, index) => productJob(`a${index}`, `Co ${index}`))
    const events = jobs.map((job, index) => event(job.id, "applied", [], Math.min(index + 1, 9)))
    const profile = buildProfile(jobs, events)
    for (const feature of profile.features) {
      expect(Math.abs(feature.weight)).toBeLessThanOrEqual(FEATURE_CAP)
    }
    const delta = adjustRanking(productJob("clone", "Clone"), profile, 62).delta
    expect(Math.abs(delta)).toBeLessThanOrEqual(TOTAL_CAP)
    expect(62 + delta).toBeLessThan(90)

    const reset = buildProfile(jobs, events, new Date("2026-10-20T00:00:00Z"))
    expect(reset.features).toEqual([])
    expect(summarizeProfile(profile).boosting.length).toBeGreaterThan(0)
    expect(summarizeProfile(profile).boosting.join(" ")).not.toMatch(/\d/)
  })

  it("does not learn from legacy not-interested rows", () => {
    const job = technicalJob("old")
    const profile = buildProfile([job], [event("old", "not_interested", ["legacy"])])
    expect(profile.features).toEqual([])
  })
})
