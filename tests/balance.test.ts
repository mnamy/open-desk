import { describe, expect, it } from "vitest"
import { evaluateHardFilters } from "@/lib/jobs/evaluate"
import { DIVERSITY_BAND, orderWithDiversity } from "@/lib/jobs/diversity"
import { ROLE_FAMILY_CAP, adjustRanking, buildProfile, featureWeight, type FeatureInput, type LearningEvent } from "@/lib/jobs/preferences"
import { inferRoleFamily } from "@/lib/jobs/role-family"
import { classifyDeterministic } from "@/lib/scoring/score"

function judged(title: string, description: string) {
  const evaluation = evaluateHardFilters({
    title,
    description,
    locationRaw: "New York, NY",
    arrangementRaw: "Hybrid",
    employmentType: "Full-time",
  })
  if (evaluation.feedBucket === "excluded") return { evaluation, fit: null as number | null }
  const fit = classifyDeterministic({
    companyName: "Example",
    title,
    description,
    city: evaluation.city,
    workArrangement: evaluation.workArrangement,
    experienceLabel: evaluation.experience.label,
    experienceBucket: evaluation.feedBucket === "stretch" ? "stretch" : "main",
    requiredOrPreferred: evaluation.experience.requiredOrPreferred,
    industry: null,
    roleFamily: evaluation.roleFamily,
    roleTier: evaluation.tier,
    levelSignal: evaluation.levelSignal,
  }).opportunityFit
  return { evaluation, fit }
}

describe("target families are peers", () => {
  it("lets a strong bizops or growth role outrank a mediocre product role", () => {
    const mediocre = judged(
      "Product Associate",
      "0–1 years of experience. Day to day: write feature requirements and talk to users.",
    )
    const bizops = judged(
      "Business Operations Associate",
      "0–1 years of experience. Day to day: own the operating cadence end to end, run analytics, launch new workflows, and partner with a cross-functional team on strategic planning. Early-stage startup. You decide the next experiment.",
    )
    const growth = judged(
      "Growth Strategy Associate",
      "0–1 years of experience. Day to day: design retention experiments, read activation cohorts, and recommend the next lifecycle test with the growth team. Early-stage startup.",
    )
    expect(mediocre.evaluation.feedBucket).toBe("main")
    expect(bizops.evaluation.tier).toBe(1)
    expect(growth.evaluation.tier).toBe(1)
    expect(bizops.fit).toBeGreaterThanOrEqual(75)
    expect(growth.fit).toBeGreaterThanOrEqual(75)
    expect(bizops.fit!).toBeGreaterThan(mediocre.fit!)
    expect(growth.fit!).toBeGreaterThan(mediocre.fit!)
  })

  it("does not require product exposure for a high score", () => {
    const ops = judged(
      "Strategy & Operations Associate",
      "0–1 years of experience. Day to day: own process improvement end to end, build the analytics view, and launch the new operating plan with a cross-functional team. Early-stage startup. You decide what to try next.",
    )
    expect(ops.evaluation.roleFamily).toBe("Strategy & operations")
    expect(ops.fit).toBeGreaterThanOrEqual(75)
    expect(ops.evaluation.feedBucket).toBe("main")
  })
})

describe("growth and operations stay selective", () => {
  it("keeps good growth and rejects quota, lead-gen, and performance marketing", () => {
    expect(inferRoleFamily("Growth Strategy Analyst")).toBe("Growth")
    expect(inferRoleFamily("Growth Operations Associate")).toBe("Growth")
    expect(inferRoleFamily("Growth Marketing Associate")).toBe("Marketing")

    const activation = judged(
      "Growth Associate",
      "0–1 years of experience. Day to day: run activation and retention experiments and read the cohort analytics. Early-stage startup.",
    )
    expect(activation.evaluation.feedBucket).toBe("main")
    expect(activation.evaluation.tier).toBe(1)
    expect(activation.fit).toBeGreaterThanOrEqual(75)

    for (const title of ["Performance Marketing Associate", "Demand Generation Associate", "Paid Acquisition Associate", "Business Development Representative"]) {
      expect(judged(title, "0–1 years of experience. Day to day: book outbound meetings.").evaluation.exclusionReason, title).toBe("sales")
    }
    expect(judged("Lead Generation Associate", "0–1 years of experience. Day to day: book outbound meetings.").evaluation.feedBucket).toBe("excluded")
    const quota = judged(
      "Growth Associate",
      "0–1 years of experience. Carry a quota and book outbound sales meetings.",
    )
    expect(quota.evaluation.exclusionReason).toBe("sales")
    expect(quota.fit).toBeNull()
  })

  it("keeps analytical ops and rejects scheduling-heavy admin", () => {
    expect(inferRoleFamily("Product Operations Associate")).toBe("Strategy & operations")
    expect(inferRoleFamily("Operations Analyst")).toBe("Strategy & operations")
    expect(inferRoleFamily("Product Development Associate")).toBe("Product")
    expect(inferRoleFamily("Customer Operations Associate")).toBe("Customer experience")

    const analyst = judged(
      "Operations Analyst",
      "0–1 years of experience. Day to day: process improvement, analytics, and cross-functional launches. Early-stage startup. You own the rollout end to end.",
    )
    expect(analyst.evaluation.feedBucket).toBe("main")
    expect(analyst.evaluation.tier).toBe(1)
    expect(analyst.fit).toBeGreaterThanOrEqual(75)

    const admin = judged(
      "Operations Associate",
      "0–1 years of experience. Day to day: calendar management, scheduling meetings, and expense reports.",
    )
    expect(admin.evaluation.feedBucket).toBe("excluded")
    expect(admin.fit).toBeNull()

    const logistics = judged(
      "Operations Associate",
      "0–1 years of experience. Day to day: logistics coordination and data entry for the warehouse.",
    )
    expect(logistics.evaluation.feedBucket).toBe("excluded")
  })

  it("still rejects senior, engineering, and data science titles", () => {
    expect(judged("Senior Product Manager", "0–1 years of experience. Day to day: write the roadmap.").evaluation.exclusionReason).toBe("seniority")
    expect(judged("Software Engineer", "0–1 years of experience. Day to day: ship the product.").evaluation.exclusionReason).toBe("engineering")
    expect(judged("Data Scientist", "0–1 years of experience. Day to day: forecast growth.").evaluation.exclusionReason).toBe("engineering")
  })
})

describe("top picks mix strong families without admitting weak ones", () => {
  it("breaks a near tie toward a missing family and leaves a clear gap alone", () => {
    const product = (title: string, score: number) => ({ title, roleFamily: "Product", score })
    const ops = { title: "Business Operations Associate", roleFamily: "Strategy & operations", score: 88 }
    const near = orderWithDiversity(
      [product("APM A", 90), product("APM B", 90), product("APM C", 90), ops],
      (job) => job.score,
    )
    expect(near[0].title).toBe("APM A")
    expect(near[1].title).toBe("Business Operations Associate")
    expect(near[1].score).toBeGreaterThanOrEqual(near[0].score - DIVERSITY_BAND)

    const far = orderWithDiversity(
      [product("P1", 92), product("P2", 92), product("P3", 92), product("P4", 92), product("P5", 92), { ...ops, score: 80 }],
      (job) => job.score,
    )
    expect(far.slice(0, 5).every((job) => job.roleFamily === "Product")).toBe(true)
    expect(far[5].title).toBe("Business Operations Associate")

    const weak = orderWithDiversity([product("APM", 92), { ...ops, score: 70 }], (job) => job.score)
    expect(weak.map((job) => job.title)).toEqual(["APM", "Business Operations Associate"])
  })
})

describe("learned role-family boost stays capped", () => {
  it("does not let repeated product applications suppress an ops role", () => {
    const applied = Array.from({ length: 6 }, (_, index) => ({
      id: `p${index}`,
      title: "Product Strategy Associate",
      companyName: `Co ${index}`,
      industry: "Consumer technology",
      description:
        "Entry-level hybrid role. Product strategy for a consumer startup. Talk to users, run user research, and own a 0 to 1 feature.",
      roleFamily: "Product",
      workArrangement: "hybrid",
      city: "New York",
    }))
    const events: LearningEvent[] = applied.map((job, index) => ({
      jobId: job.id,
      action: "applied",
      reasons: [],
      createdAt: new Date(`2026-10-0${index + 1}T12:00:00Z`),
    }))
    const profile = buildProfile(applied, events)
    expect(featureWeight(profile, "role:Product")).toBeGreaterThan(0)
    expect(featureWeight(profile, "role:Product")).toBeLessThanOrEqual(ROLE_FAMILY_CAP)
    expect(featureWeight(profile, "role:Strategy & operations")).toBe(0)

    const ops: FeatureInput = {
      id: "ops",
      title: "Business Operations Associate",
      companyName: "Umbrella",
      industry: null,
      description: "Entry-level. Process improvement, analytics, and a launch plan for the operations team.",
      roleFamily: "Strategy & operations",
      workArrangement: "hybrid",
      city: "Chicago",
    }
    expect(adjustRanking(ops, profile, 82).delta).toBeGreaterThanOrEqual(0)
    const productDelta = adjustRanking(applied[0], profile, 70).delta
    expect(productDelta).toBeLessThanOrEqual(10)
    expect(70 + productDelta).toBeLessThan(82 + adjustRanking(ops, profile, 82).delta)
  })
})
