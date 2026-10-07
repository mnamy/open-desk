import { PGlite } from "@electric-sql/pglite"
import { describe, expect, it } from "vitest"
import { applyMigration } from "@/lib/db/client"
import { importPostings, listDeskJobs, listFeedback, saveInterpretation, setFeedback } from "@/lib/db/repository"
import { evaluateHardFilters } from "@/lib/jobs/evaluate"
import { jobInFeed } from "@/lib/jobs/feeds"
import { FEATURE_CAP, adjustRanking, buildProfile, featureWeight, type FeatureInput } from "@/lib/jobs/preferences"
import { promptFor } from "@/lib/llm/prompt"
import { keepAuthoritative, semanticDelta, SEMANTIC_CAP } from "@/lib/llm/rank"
import { InterpretationMemo, interpretText, type InterpretationStore, type LocalModel } from "@/lib/llm/runtime"
import {
  JOB_FEATURES,
  LOCAL_MODEL_ID,
  interpretationHash,
  parseFeedbackInterpretation,
  parseJobFeatures,
  type FeedbackInterpretation,
  type JobFeatures,
} from "@/lib/llm/schema"
import { jobsForLocalInterpretation, needsLocalInterpretation, shapeHits } from "@/lib/llm/select"
import { classifyDeterministic } from "@/lib/scoring/score"
import type { LiveCollection } from "@/lib/sources/live-search"
import type { RawPosting } from "@/lib/sources/types"

function blankFeatures(partial: Partial<JobFeatures> = {}): JobFeatures {
  const features = Object.fromEntries(JOB_FEATURES.map((key) => [key, 0])) as JobFeatures
  return { ...features, ...partial }
}

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

const ownershipNote: FeedbackInterpretation = {
  positive_preferences: { ownership: 0.9, strategy: 0.7, decision_making: 0.8 },
  negative_preferences: { administrative_execution: 0.8 },
}

describe("local interpretation parsing", () => {
  it("accepts structured feedback and clamps values into 0..1", () => {
    const parsed = parseFeedbackInterpretation(`Here is the read:
\`\`\`json
${JSON.stringify({
  positive_preferences: { ownership: 1.4, strategy: 0.7, unknown: 1 },
  negative_preferences: { administrative_execution: -3, technical_intensity: 0.25 },
})}
\`\`\``)
    expect(parsed).toEqual({
      positive_preferences: { ownership: 1, strategy: 0.7 },
      negative_preferences: { technical_intensity: 0.25 },
    })
  })

  it("drops a malformed model reply", () => {
    expect(parseFeedbackInterpretation("I think this is about ownership.")).toBeNull()
    expect(parseFeedbackInterpretation('{"positive_preferences": []}')).toBeNull()
    expect(parseJobFeatures('{"ownership": 0.4}')).toBeNull()
    expect(parseJobFeatures("[]")).toBeNull()
  })

  it("requires a complete job feature object", () => {
    const parsed = parseJobFeatures(JSON.stringify(blankFeatures({ ownership: 0.8, sales_intensity: 2 })))
    expect(parsed?.ownership).toBe(0.8)
    expect(parsed?.sales_intensity).toBe(1)
    expect(parsed && Object.keys(parsed)).toHaveLength(JOB_FEATURES.length)
  })
})

describe("local model fallback and cache", () => {
  it("uses the deterministic path when WebGPU is missing", async () => {
    let calls = 0
    const model: LocalModel = {
      interpret: async () => {
        calls += 1
        return JSON.stringify(ownershipNote)
      },
    }
    const result = await interpretText({
      webgpu: false,
      model,
      memo: new InterpretationMemo(),
      kind: "feedback",
      text: "too much execution, not enough ownership",
      hash: "missing-gpu",
      parse: parseFeedbackInterpretation,
    })
    expect(result).toBeNull()
    expect(calls).toBe(0)
  })

  it("does not parse the same text twice", async () => {
    let calls = 0
    const model: LocalModel = {
      interpret: async () => {
        calls += 1
        return JSON.stringify(ownershipNote)
      },
    }
    const values = new Map<string, FeedbackInterpretation | null>()
    const store: InterpretationStore<FeedbackInterpretation | null> = {
      read(hash) {
        return values.has(hash) ? values.get(hash) : undefined
      },
      write(hash, value) {
        values.set(hash, value)
      },
    }
    const hash = await interpretationHash("feedback", "too much execution, not enough ownership")
    const first = await interpretText({
      webgpu: true,
      model,
      memo: new InterpretationMemo(),
      store,
      kind: "feedback",
      text: "too much execution, not enough ownership",
      hash,
      parse: parseFeedbackInterpretation,
    })
    const second = await interpretText({
      webgpu: true,
      model,
      memo: new InterpretationMemo(),
      store,
      kind: "feedback",
      text: "too much execution, not enough ownership",
      hash,
      parse: parseFeedbackInterpretation,
    })
    expect(first?.positive_preferences.ownership).toBe(0.9)
    expect(second).toEqual(first)
    expect(calls).toBe(1)
  })

  it("caches a malformed reply instead of retrying it", async () => {
    let calls = 0
    const model: LocalModel = {
      interpret: async () => {
        calls += 1
        return "not json"
      },
    }
    const memo = new InterpretationMemo<FeedbackInterpretation | null>()
    const hash = "malformed"
    const options = {
      webgpu: true,
      model,
      memo,
      kind: "feedback" as const,
      text: "this sounds way too technical for what I want",
      hash,
      parse: parseFeedbackInterpretation,
    }
    expect(await interpretText(options)).toBeNull()
    expect(await interpretText(options)).toBeNull()
    expect(calls).toBe(1)
  })
})

describe("feedback notes and hard filters", () => {
  const examples: { note: string; signals: FeedbackInterpretation }[] = [
    {
      note: "too much execution, not enough ownership",
      signals: {
        positive_preferences: { ownership: 0.9, decision_making: 0.7 },
        negative_preferences: { administrative_execution: 0.85 },
      },
    },
    {
      note: "I actually like that this is operations because it involves launches and strategy",
      signals: {
        positive_preferences: { operations: 0.8, strategy: 0.75 },
        negative_preferences: {},
      },
    },
    {
      note: "this sounds way too technical for what I want",
      signals: {
        positive_preferences: {},
        negative_preferences: { technical_intensity: 0.9 },
      },
    },
    {
      note: "I like the customer research and experimentation parts",
      signals: {
        positive_preferences: { user_research: 0.85, experimentation: 0.8 },
        negative_preferences: {},
      },
    },
  ]

  it("turns example notes into bounded preference signals", () => {
    for (const example of examples) {
      const parsed = parseFeedbackInterpretation(JSON.stringify(example.signals))
      expect(parsed).toEqual(example.signals)
      const profile = buildProfile(
        [role({ id: "source", title: "Operations Associate", description: "0-1 years. Hybrid in New York." })],
        [
          {
            jobId: "source",
            action: "not_interested",
            createdAt: new Date("2026-10-06T12:00:00Z"),
            reasons: ["other"],
            noteSignals: parsed,
          },
        ],
      )
      for (const feature of profile.features) {
        expect(Math.abs(feature.weight)).toBeLessThanOrEqual(FEATURE_CAP)
      }
    }

    const ownership = parseFeedbackInterpretation(JSON.stringify(examples[0].signals))!
    const profile = buildProfile(
      [role({ id: "source", title: "Operations Associate", description: "0-1 years." })],
      [
        {
          jobId: "source",
          action: "not_interested",
          createdAt: new Date("2026-10-06T12:00:00Z"),
          reasons: ["responsibilities"],
          noteSignals: ownership,
        },
      ],
    )
    expect(featureWeight(profile, "exposure:ownership")).toBeGreaterThan(0)
    expect(featureWeight(profile, "exposure:admin")).toBeLessThan(0)
    const owned = adjustRanking(
      role({
        id: "owned",
        title: "Strategy Associate",
        description: "0-1 years. Own the operating plan end to end. You decide the next strategy.",
      }),
      profile,
      70,
    )
    const admin = adjustRanking(
      role({
        id: "admin",
        title: "Operations Associate",
        description: "0-1 years. Calendar management, scheduling meetings, and expense reports.",
      }),
      profile,
      70,
    )
    expect(owned.delta).toBeGreaterThan(admin.delta)
    expect(owned.note).toMatch(/notes favor/i)

    const technical = buildProfile(
      [role({ id: "source", title: "Product Associate", description: "0-1 years." })],
      [
        {
          jobId: "source",
          action: "not_interested",
          createdAt: new Date("2026-10-06T12:00:00Z"),
          reasons: ["other"],
          noteSignals: examples[2].signals,
        },
      ],
    )
    expect(featureWeight(technical, "exposure:technical")).toBeLessThan(0)
    const ops = buildProfile(
      [role({ id: "source", title: "Operations Associate", description: "0-1 years." })],
      [
        {
          jobId: "source",
          action: "not_interested",
          createdAt: new Date("2026-10-06T12:00:00Z"),
          reasons: ["other"],
          noteSignals: examples[1].signals,
        },
      ],
    )
    expect(featureWeight(ops, "exposure:operations")).toBeGreaterThan(0)
    expect(featureWeight(ops, "exposure:strategy")).toBeGreaterThan(0)
    const research = buildProfile(
      [role({ id: "source", title: "User Research Associate", description: "0-1 years." })],
      [
        {
          jobId: "source",
          action: "not_interested",
          createdAt: new Date("2026-10-06T12:00:00Z"),
          reasons: ["other"],
          noteSignals: examples[3].signals,
        },
      ],
    )
    expect(featureWeight(research, "exposure:research")).toBeGreaterThan(0)
    expect(featureWeight(research, "exposure:experiment")).toBeGreaterThan(0)
  })

  it("keeps one family's note boost inside the feature cap", () => {
    const events = Array.from({ length: 8 }, (_, index) => ({
      jobId: `job-${index}`,
      action: "not_interested",
      createdAt: new Date(Date.UTC(2026, 9, index + 1)),
      reasons: ["other"],
      noteSignals: ownershipNote,
    }))
    const jobs = events.map((event) => role({ id: event.jobId, title: "Operations Associate", description: "0-1 years." }))
    const profile = buildProfile(jobs, events)
    expect(featureWeight(profile, "exposure:ownership")).toBeLessThanOrEqual(FEATURE_CAP)
    expect(featureWeight(profile, "exposure:ownership")).toBeGreaterThan(0)
  })

  it("does not let model features override a hard filter", () => {
    const glowing = blankFeatures({
      ownership: 1,
      strategy_exposure: 1,
      decision_making: 1,
      experimentation: 1,
      product_exposure: 1,
    })
    const excluded = keepAuthoritative(
      {
        feedBucket: "excluded" as const,
        opportunityFit: null,
        exclusionReason: "sales",
        actions: [],
      },
      glowing,
    )
    expect(excluded.feedBucket).toBe("excluded")
    expect(excluded.opportunityFit).toBeNull()
    expect(excluded.exclusionReason).toBe("sales")
    expect(excluded.actions).toEqual([])
    expect(excluded.semanticDelta).toBe(0)
    expect(jobInFeed({ ...excluded, isNew: false }, "top")).toBe(false)

    const eligible = keepAuthoritative(
      {
        feedBucket: "main" as const,
        opportunityFit: 70,
        exclusionReason: null,
        actions: [],
      },
      glowing,
    )
    expect(eligible.feedBucket).toBe("main")
    expect(eligible.opportunityFit).toBe(70)
    expect(eligible.semanticDelta).toBeGreaterThan(0)
    expect(eligible.semanticDelta).toBeLessThanOrEqual(SEMANTIC_CAP)
    expect(jobInFeed({ ...eligible, isNew: false }, "top")).toBe(false)
    expect(needsLocalInterpretation({
      feedBucket: "excluded",
      title: "Sales Development Representative",
      description: "0-1 years. Carry a quota and book outbound meetings.",
      roleFamily: "Sales",
      origin: "search",
    })).toBe(false)
  })
})

describe("ambiguous descriptions", () => {
  const early = "Entry-level hybrid role in New York. 0–1 years of experience."
  const postings: { title: string; description: string; origin?: string; features: Partial<JobFeatures> }[] = [
    {
      title: "Growth Associate",
      description: `${early} Sit with the growth team and prepare the weekly update.`,
      features: { growth_exposure: 0.7, administrative_intensity: 0.8, cross_functional: 0.3 },
    },
    {
      title: "Operations Associate",
      description: `${early} Help the team keep internal projects moving.`,
      features: { operations_exposure: 0.6, administrative_intensity: 0.7 },
    },
    {
      title: "Special Projects Associate",
      description: `${early} Join a small team and pick up projects as they come.`,
      features: { ownership: 0.4, cross_functional: 0.5, strategy_exposure: 0.3 },
    },
    {
      title: "Founder's Associate",
      description: `${early} Help the founders with whatever is most urgent.`,
      features: { ownership: 0.6, decision_making: 0.5, cross_functional: 0.6 },
    },
    {
      title: "Innovation Associate",
      description: `${early} Explore new ideas with a small team.`,
      features: { ownership: 0.7, strategy_exposure: 0.4, experimentation: 0.5 },
    },
    {
      title: "New Ventures Associate",
      description: `${early} Look for new bets the company could start.`,
      features: { ownership: 0.8, strategy_exposure: 0.6, decision_making: 0.5 },
    },
    {
      title: "Strategic Initiatives Associate",
      description: `${early} Support a handful of company projects.`,
      features: { strategy_exposure: 0.7, cross_functional: 0.5, administrative_intensity: 0.4 },
    },
    {
      title: "Startup Generalist",
      description: `${early} Work across the company on whatever needs an owner.`,
      features: { ownership: 0.8, cross_functional: 0.7, decision_making: 0.4 },
    },
    {
      title: "Studio Associate",
      description: `${early} Talk to users, run a small experiment, and share analytics with a cross-functional product team.`,
      origin: "external_user",
      features: { research_exposure: 0.6, experimentation: 0.7, user_interaction: 0.8, cross_functional: 0.7, product_exposure: 0.5 },
    },
    {
      title: "BizOps Generalist",
      description: `${early} Figure out what the team should do next.`,
      features: { operations_exposure: 0.7, strategy_exposure: 0.6, decision_making: 0.7, ownership: 0.5 },
    },
  ]

  it("compares deterministic eligibility with bounded semantic features", () => {
    const clear = needsLocalInterpretation({
      feedBucket: "main",
      title: "Associate Product Manager",
      description: `${early} Own the roadmap end to end, run experiments with the product team, talk to users, and decide what to build. Early-stage startup.`,
      roleFamily: "Product",
      origin: "search",
    })
    expect(clear).toBe(false)

    const rows = postings.map((posting) => {
      const evaluation = evaluateHardFilters({
        title: posting.title,
        description: posting.description,
        locationRaw: "New York, NY",
        arrangementRaw: "Hybrid",
      })
      const features = blankFeatures(posting.features)
      const fit =
        evaluation.feedBucket === "excluded"
          ? null
          : classifyDeterministic({
              companyName: "Northwind",
              title: posting.title,
              description: posting.description,
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
      const kept = keepAuthoritative(
        {
          feedBucket: evaluation.feedBucket,
          opportunityFit: fit,
          exclusionReason: evaluation.exclusionReason,
          actions: [],
        },
        features,
      )
      return {
        title: posting.title,
        family: evaluation.roleFamily,
        tier: evaluation.tier,
        feed: evaluation.feedBucket,
        hits: shapeHits(`${posting.title}\n${posting.description}`),
        interpret: needsLocalInterpretation({
          feedBucket: evaluation.feedBucket,
          title: posting.title,
          description: posting.description,
          roleFamily: evaluation.roleFamily,
          origin: posting.origin ?? "search",
        }),
        fit,
        semanticDelta: kept.semanticDelta,
        keptFeed: kept.feedBucket,
      }
    })
    expect(rows.filter((row) => row.interpret)).toHaveLength(10)
    for (const row of rows) {
      expect(row.feed).not.toBe("excluded")
      expect(row.keptFeed).toBe(row.feed)
      expect(Math.abs(row.semanticDelta)).toBeLessThanOrEqual(SEMANTIC_CAP)
    }
    expect(jobsForLocalInterpretation(rows.map((row, index) => ({
      feedBucket: row.feed,
      title: postings[index].title,
      description: postings[index].description,
      roleFamily: row.family,
      origin: postings[index].origin ?? "search",
    }))).length).toBeLessThanOrEqual(5)
    expect(promptFor("feedback", "note").system).toContain("positive_preferences")
    expect(promptFor("job", "role").system).toContain("ownership")
    expect(promptFor("feedback", "note").system.toLowerCase()).not.toContain("api key")
  })
})

describe("stored interpretations", () => {
  it("saves a note reading without changing filters or history", async () => {
    const db = new PGlite()
    await applyMigration(db)
    const description = "Entry-level hybrid role in New York. 0–1 years of experience. Help the team keep internal projects moving."
    const posting: RawPosting = {
      id: "northwind-ops",
      release: "search",
      source: "greenhouse",
      sourceUrl: "https://boards.greenhouse.io/northwind/jobs/ops",
      applicationUrl: "https://boards.greenhouse.io/northwind/jobs/ops",
      externalId: "ops",
      atsProvider: "greenhouse",
      atsIdentifier: "northwind",
      companyName: "Northwind",
      industry: "Consumer technology",
      discoveredFrom: "greenhouse",
      title: "Operations Associate",
      description,
      locationRaw: "New York, NY",
      arrangementRaw: "Hybrid",
      employmentType: "Full-time",
      postedDaysAgo: 2,
    }
    await importPostings(db, "search", new Date("2026-10-06T15:00:00Z"), {
      postings: [posting],
      companiesChecked: 1,
      warnings: [],
      staleBoards: [],
      checkedCompanies: [],
    } satisfies LiveCollection)
    const job = (await listDeskJobs(db))[0]
    const beforeFit = job.opportunityFit
    const beforeFeed = job.feedBucket
    await setFeedback(db, job.id, "not_interested", {
      reasons: ["responsibilities"],
      note: "this feels like mostly executing processes other people designed and I want more ownership",
    })
    const note = "this feels like mostly executing processes other people designed and I want more ownership"
    const signals = {
      positive_preferences: { ownership: 0.9, strategy: 0.7, decision_making: 0.8 },
      negative_preferences: { administrative_execution: 0.8 },
    }
    const hash = await interpretationHash("feedback", note)
    expect(await saveInterpretation(db, {
      kind: "feedback",
      jobId: job.id,
      rawText: note,
      signals,
      modelId: LOCAL_MODEL_ID,
      contentHash: hash,
    })).toBe("saved")
    expect(await saveInterpretation(db, {
      kind: "feedback",
      jobId: job.id,
      rawText: note,
      signals: { positive_preferences: { ownership: "high" } },
      modelId: LOCAL_MODEL_ID,
      contentHash: hash,
    })).toBe("ignored")
    const stored = await db.query<{ raw_text: string; model_id: string; content_hash: string; parsed_at: Date }>(
      "SELECT raw_text, model_id, content_hash, parsed_at FROM interpretations WHERE kind = 'feedback'",
    )
    expect(stored.rows).toHaveLength(1)
    expect(stored.rows[0].raw_text).toMatch(/ownership/)
    expect(stored.rows[0].model_id).toBe(LOCAL_MODEL_ID)
    expect(stored.rows[0].content_hash).toBe(hash)
    expect(stored.rows[0].parsed_at).toBeTruthy()
    const feedback = await listFeedback(db)
    expect(feedback[0].note).toMatch(/ownership/)
    expect(feedback[0].noteSignals?.positive_preferences.ownership).toBe(0.9)
    const again = (await listDeskJobs(db))[0]
    expect(again.feedBucket).toBe(beforeFeed)
    expect(again.opportunityFit).toBe(beforeFit)
    expect(again.actions).toEqual(["not_interested"])
    expect(again.actions).not.toContain("applied")

    const jobHash = await interpretationHash("job", `${job.title}\n${description}`)
    const jobSignals = blankFeatures({ operations_exposure: 0.4, administrative_intensity: 0.8, ownership: 0.2 })
    expect(await saveInterpretation(db, {
      kind: "job",
      jobId: job.id,
      rawText: `${job.title}\n${description}`,
      signals: jobSignals,
      modelId: LOCAL_MODEL_ID,
      contentHash: jobHash,
    })).toBe("saved")
    const withFeatures = (await listDeskJobs(db))[0]
    expect(withFeatures.feedBucket).toBe(beforeFeed)
    expect(withFeatures.opportunityFit).toBe(beforeFit)
    expect(withFeatures.semanticFeatures?.administrative_intensity).toBe(0.8)
    expect(Math.abs(semanticDelta(withFeatures.semanticFeatures, withFeatures.feedBucket))).toBeLessThanOrEqual(SEMANTIC_CAP)
    await db.close()
  })
})
