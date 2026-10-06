import { randomUUID } from "node:crypto"
import { PGlite } from "@electric-sql/pglite"
import { describe, expect, it } from "vitest"
import { applyMigration } from "@/lib/db/client"
import {
  importExternalJob,
  importPostings,
  listDeskJobs,
  listFeedback,
  preferenceResetAt,
  resetLearnedPreferences,
  setFeedback,
} from "@/lib/db/repository"
import { fetchExternalJob, postingFromManual } from "@/lib/jobs/external-url"
import { jobInFeed } from "@/lib/jobs/feeds"
import { TOTAL_CAP } from "@/lib/jobs/preferences"
import { annotatePreferences, visibleJobs } from "@/lib/jobs/view"
import type { HttpClient } from "@/lib/sources/http"
import type { LiveCollection } from "@/lib/sources/live-search"
import type { RawPosting } from "@/lib/sources/types"

function posting(id: string, company: string, title: string, description: string, industry = "Consumer technology"): RawPosting {
  const slug = company.toLowerCase().replace(/[^a-z0-9]+/g, "")
  return {
    id: `${slug}-${id}`,
    release: "search",
    source: "greenhouse",
    sourceUrl: `https://boards.greenhouse.io/${slug}/jobs/${id}`,
    applicationUrl: `https://boards.greenhouse.io/${slug}/jobs/${id}`,
    externalId: id,
    atsProvider: "greenhouse",
    atsIdentifier: slug,
    companyName: company,
    industry,
    discoveredFrom: "greenhouse",
    title,
    description,
    locationRaw: "New York, NY",
    arrangementRaw: "Hybrid",
    employmentType: "Full-time",
    postedDaysAgo: 3,
  }
}

const base = "Entry-level hybrid role in New York. 0-1 years of experience."

async function desk() {
  const db = new PGlite()
  await applyMigration(db)
  return db
}

describe("feedback reasons and external jobs", () => {
  it("requires a reason, keeps it across a later search, and accepts legacy rows", async () => {
    const db = await desk()
    const now = new Date("2026-10-05T15:00:00Z")
    await importPostings(db, "search", now, {
      postings: [posting("1", "Northwind", "Product Strategy Associate", `${base} Product strategy for a consumer music startup. Talk to users.`)],
      companiesChecked: 1,
      warnings: [],
      staleBoards: [],
      checkedCompanies: [],
    } satisfies LiveCollection)
    const job = (await listDeskJobs(db))[0]
    await expect(setFeedback(db, job.id, "not_interested")).rejects.toThrow(/reason/i)
    await setFeedback(db, job.id, "not_interested", { reasons: ["too_technical", "other"], note: "Too much implementation work" })
    await importPostings(db, "search", new Date("2026-10-06T15:00:00Z"), {
      postings: [posting("1", "Northwind", "Product Strategy Associate", `${base} Product strategy for a consumer music startup. Talk to users. Updated.`)],
      companiesChecked: 1,
      warnings: [],
      staleBoards: [],
      checkedCompanies: [],
    })
    const feedback = await listFeedback(db)
    const hidden = feedback.find((item) => item.action === "not_interested")
    expect(hidden?.reasons.sort()).toEqual(["other", "too_technical"])
    expect(hidden?.note).toMatch(/implementation/i)
    expect(jobInFeed((await listDeskJobs(db))[0], "hidden")).toBe(true)

    const legacyId = randomUUID()
    await db.query("INSERT INTO feedback (id, job_id, action) VALUES ($1, $2, 'not_interested')", [legacyId, job.id])
    await db.query("DELETE FROM feedback_reasons WHERE feedback_id IN (SELECT id FROM feedback WHERE job_id = $1)", [job.id])
    await applyMigration(db)
    const reasons = await db.query<{ reason: string }>("SELECT reason FROM feedback_reasons")
    expect(reasons.rows.map((row) => row.reason)).toContain("legacy")
    await db.close()
  })

  it("removes Applied roles from discovery feeds and restores them", async () => {
    const db = await desk()
    await importPostings(db, "search", new Date("2026-10-05T15:00:00Z"), {
      postings: [
        posting("10", "Fieldnote", "Associate Product Manager", `${base} Product strategy, user research, and a roadmap for a consumer startup.`),
        posting("11", "Harbor", "UX Research Associate", `${base} User research. Interview customers and share findings with the product team.`),
      ],
      companiesChecked: 2,
      warnings: [],
      staleBoards: [],
      checkedCompanies: [],
    })
    const jobs = await listDeskJobs(db)
    const target = jobs.find((job) => job.title === "Associate Product Manager")!
    expect(jobInFeed(target, "all")).toBe(true)
    await setFeedback(db, target.id, "save")
    await setFeedback(db, target.id, "applied")
    const applied = (await listDeskJobs(db)).find((job) => job.id === target.id)!
    expect(applied.actions).toEqual(expect.arrayContaining(["save", "applied"]))
    for (const feed of ["top", "new", "all", "stretch", "saved"] as const) {
      expect(jobInFeed(applied, feed)).toBe(false)
    }
    expect(jobInFeed(applied, "applied")).toBe(true)
    const ranked = annotatePreferences(await listDeskJobs(db), await listFeedback(db), null)
    expect(visibleJobs(ranked.jobs, "top", {}).some((job) => job.id === target.id)).toBe(false)
    expect(visibleJobs(ranked.jobs, "applied", {}).some((job) => job.id === target.id)).toBe(true)

    await setFeedback(db, target.id, "applied")
    const restored = (await listDeskJobs(db)).find((job) => job.id === target.id)!
    expect(restored.actions).not.toContain("applied")
    expect(restored.actions).toContain("save")
    expect(jobInFeed(restored, "all")).toBe(true)
    expect(jobInFeed(restored, "saved")).toBe(true)
    expect(jobInFeed(restored, "applied")).toBe(false)
    await db.close()
  })

  it("imports an external URL, dedupes it, and lets Applied teach the profile", async () => {
    const db = await desk()
    const client: HttpClient = {
      async getJson(url) {
        if (url.endsWith("/boards/northwind")) return { name: "Northwind" }
        if (url.includes("/jobs/555")) {
          return {
            id: 555,
            title: "Product Strategy Associate",
            absolute_url: "https://boards.greenhouse.io/northwind/jobs/555",
            location: { name: "New York, NY" },
            content:
              "<p>Entry-level hybrid role in New York. 0-1 years. Product strategy for a consumer music startup. Talk to users and own a 0 to 1 feature.</p>",
          }
        }
        throw new Error(`unexpected ${url}`)
      },
      async getText(url) {
        if (url.includes("lullaby.example")) {
          return `<script type="application/ld+json">${JSON.stringify({
            "@type": "JobPosting",
            title: "Founder's Associate",
            description:
              "Early-stage consumer startup in New York. Hybrid. 0-1 years. Product strategy, user research, and a 0 to 1 roadmap with the founding team.",
            hiringOrganization: { "@type": "Organization", name: "Lullaby" },
            jobLocation: { "@type": "Place", address: { addressLocality: "New York", addressRegion: "NY" } },
            url: "https://lullaby.example/jobs/founder",
          })}</script>`
        }
        return "<html><title>No job here</title></html>"
      },
    }
    const parsed = await fetchExternalJob("https://boards.greenhouse.io/northwind/jobs/555", client)
    expect(parsed.status).toBe("ready")
    if (parsed.status !== "ready") return
    expect(parsed.posting.source).toBe("greenhouse")
    expect(parsed.posting.discoveredFrom).toBe("external_user")
    expect(parsed.posting.companyName).toBe("Northwind")
    expect(parsed.posting.externalId).toBe("555")

    const html = await fetchExternalJob("https://lullaby.example/jobs/founder", client)
    expect(html.status).toBe("ready")
    const empty = await fetchExternalJob("https://example.com/careers/nope", client)
    expect(empty.status).toBe("manual")

    const first = await importExternalJob(db, parsed.posting, "applied")
    const second = await importExternalJob(db, parsed.posting, "desk")
    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.jobId).toBe(first.jobId)
    const count = await db.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM jobs WHERE title = 'Product Strategy Associate'")
    expect(count.rows[0].count).toBe("1")
    const origin = await db.query<{ origin: string; source: string }>("SELECT origin, source FROM jobs WHERE id = $1", [first.jobId])
    expect(origin.rows[0]).toMatchObject({ origin: "external_user", source: "greenhouse" })

    if (html.status === "ready") await importExternalJob(db, html.posting, "desk")
    const manual = postingFromManual({
      url: "https://jobs.example.com/manual",
      title: "Strategy Associate",
      company: "Harbor",
      location: "New York, NY",
      arrangement: "Hybrid",
      source: "career_page",
      description: `${base} Product strategy for a consumer social startup. User research and a 0 to 1 roadmap.`,
    })
    await importExternalJob(db, manual!, "desk")

    const jobs = await listDeskJobs(db)
    const learned = annotatePreferences(jobs, await listFeedback(db), null)
    const harbor = learned.jobs.find((job) => job.companyName === "Harbor")
    expect(harbor?.preferenceDelta).toBeGreaterThan(0)
    expect(learned.summary.boosting.length).toBeGreaterThan(0)
    expect(jobInFeed(jobs.find((job) => job.id === first.jobId)!, "top")).toBe(false)
    expect(jobInFeed(jobs.find((job) => job.id === first.jobId)!, "applied")).toBe(true)
    await db.close()
  })

  it("resets ranking adjustments without deleting job actions", async () => {
    const db = await desk()
    await importPostings(db, "search", new Date("2026-10-05T15:00:00Z"), {
      postings: [
        posting("21", "Northwind", "Product Strategy Associate", `${base} Product strategy for a consumer music startup. Talk to users and own a 0 to 1 feature.`),
        posting("22", "Harbor", "Strategy Associate", `${base} Product strategy for a consumer social startup. User research and a roadmap.`),
      ],
      companiesChecked: 2,
      warnings: [],
      staleBoards: [],
      checkedCompanies: [],
    })
    const jobs = await listDeskJobs(db)
    const applied = jobs.find((job) => job.companyName === "Northwind")!
    await setFeedback(db, applied.id, "applied")
    await setFeedback(db, applied.id, "save")
    const before = annotatePreferences(await listDeskJobs(db), await listFeedback(db), await preferenceResetAt(db))
    expect(before.jobs.find((job) => job.companyName === "Harbor")?.preferenceDelta).toBeGreaterThan(0)

    await resetLearnedPreferences(db, new Date("2026-10-20T00:00:00Z"))
    const feedback = await listFeedback(db)
    expect(feedback.map((item) => item.action).sort()).toEqual(["applied", "save"])
    const after = annotatePreferences(await listDeskJobs(db), feedback, await preferenceResetAt(db))
    expect(after.jobs.every((job) => job.preferenceDelta === 0)).toBe(true)
    expect(after.summary.boosting).toEqual([])
    expect((await listDeskJobs(db)).find((job) => job.id === applied.id)?.actions).toEqual(expect.arrayContaining(["applied", "save"]))
    await db.close()
  })
})

describe("ranking fixture", () => {
  it("reorders top picks without an extreme swing", async () => {
    const db = await desk()
    const consumer = (company: string, title: string, extra: string) =>
      posting(
        company.replace(/\W/g, "").slice(0, 12),
        company,
        title,
        `${base} ${extra} Product strategy for a consumer music and social startup. Talk to users, run user research, and own a 0 to 1 roadmap with the founding team.`,
      )
    const plain = (company: string, title: string, extra: string, industry?: string) =>
      posting(company.replace(/\W/g, "").slice(0, 12), company, title, `${base} ${extra}`, industry)
    const postings = [
      consumer("Northwind", "Product Strategy Associate", "Early-stage."),
      consumer("Lullaby", "Founder's Associate", "Founding team."),
      consumer("Chorus", "Associate Product Manager", "Early-stage."),
      consumer("Fieldnote", "Product Strategy Associate", "Small team."),
      plain("Kindred", "UX Research Associate", "User research for a consumer wellness startup. Interview customers."),
      plain("Harbor", "Strategy Associate", "Product strategy and a roadmap with the product team at an early-stage company."),
      plain("Apex", "Product Associate", "Write technical specifications, query SQL, and debug API issues in the data pipeline."),
      plain("Apex Two", "Product Associate", "Write technical specifications, query SQL, and debug API issues in the data pipeline."),
      plain("Apex Three", "Product Associate", "Write technical specifications, query SQL, and debug API issues in the data pipeline."),
      plain("Relay", "Product Associate", "Spend the week on sales conversations and the outbound pipeline while partnering with the product team."),
      plain("Relay Two", "Product Associate", "Spend the week on sales conversations and the outbound pipeline while partnering with the product team."),
      plain("Billboard", "Product Associate", "Run brand campaigns, social media, and performance marketing with the product team."),
      plain("Ledger", "Product Associate", "Payments product work with the product team.", "Fintech"),
      plain("Initech", "Product Associate", "Feature work with the product team on a roadmap."),
      plain("Globex", "Business Operations Associate", "Enterprise implementation, business operations, and process improvement for a larger company. Partner with the product team on strategy."),
      plain("Umbrella", "Business Operations Associate", "Business operations and process improvement for a larger company. Partner with the product team."),
      plain("Picnic", "Product Analyst", "Analytics for the product team. Talk to users about a new feature."),
      plain("Sable", "User Research Associate", "User research for a consumer startup. Interview customers and share findings with the product team."),
      plain("Wren", "Product Operations Associate", "Product operations with the product team. Write requirements and follow a roadmap."),
      plain("Maple", "Special Projects Associate", "Special projects with the product team. Help decide what to build."),
      plain("Olive", "Program Associate", "Program management with the product team. User research and a roadmap."),
      plain("Cedar", "Customer Experience Associate", "Customer experience and voice of customer with the product team."),
      plain(
        "Keel",
        "Business Operations Associate",
        "Cross-functional process improvement, sales pipeline support, and technical specifications with SQL for a larger company.",
      ),
      consumer("Meadow", "Product Strategy Associate", "Early-stage."),
      consumer("Bramble", "Founder's Associate", "Founding team."),
      consumer("Pebble", "Associate Product Manager", "Small team."),
      plain("Nimbus", "UX Research Associate", "User research for a consumer startup. Interview customers."),
      plain("Juniper", "Strategy Associate", "Product strategy and a roadmap at an early-stage consumer company."),
      plain("Holly", "Product Associate", "Feature work and a roadmap with the product team."),
      plain("Ivy", "Product Operations Associate", "Product operations. Write requirements and follow a roadmap."),
      plain("Fern", "Special Projects Associate", "Special projects with the product team. Help decide what to build."),
      plain("Moss", "User Research Associate", "User research and customer interviews for a consumer product."),
      plain("Alder", "Product Associate", "Product work plus brand campaigns and social media with the product team."),
      plain("Cobalt", "Product Associate", "Write technical specifications, query SQL, and debug API issues in the data pipeline."),
      plain("Dune", "Product Associate", "Product work, plus sales conversations and pipeline support with the product team."),
    ]
    await importPostings(db, "search", new Date("2026-10-05T15:00:00Z"), {
      postings,
      companiesChecked: postings.length,
      warnings: [],
      staleBoards: [],
      checkedCompanies: [],
    })
    const loaded = await listDeskJobs(db)
    const byCompany = (name: string) => loaded.find((job) => job.companyName === name)
    for (const name of ["Northwind", "Lullaby", "Chorus", "Fieldnote"]) {
      await setFeedback(db, byCompany(name)!.id, "applied")
    }
    for (const name of ["Kindred", "Sable"]) await setFeedback(db, byCompany(name)!.id, "save")
    for (const name of ["Apex", "Apex Two"]) {
      await setFeedback(db, byCompany(name)!.id, "not_interested", { reasons: ["too_technical"] })
    }
    await setFeedback(db, byCompany("Relay")!.id, "not_interested", { reasons: ["too_sales"] })
    await setFeedback(db, byCompany("Billboard")!.id, "not_interested", { reasons: ["too_marketing"] })
    await setFeedback(db, byCompany("Ledger")!.id, "not_interested", { reasons: ["industry"] })
    await setFeedback(db, byCompany("Initech")!.id, "not_interested", { reasons: ["company"] })
    await setFeedback(db, byCompany("Globex")!.id, "not_interested", { reasons: ["responsibilities"] })

    const feedback = await listFeedback(db)
    const current = await listDeskJobs(db)
    const beforePool = current
      .filter((job) => jobInFeed(job, "top"))
      .sort((a, b) => (b.opportunityFit ?? 0) - (a.opportunityFit ?? 0) || a.title.localeCompare(b.title))
    const learned = annotatePreferences(current, feedback, null)
    const after = visibleJobs(learned.jobs, "top", {})
    const line = (index: number, job: { opportunityFit: number | null; preferenceDelta?: number; title: string; companyName: string }) =>
      `${String(index + 1).padStart(2, " ")}. ${String(job.opportunityFit ?? 0).padStart(3, " ")} ${job.preferenceDelta !== undefined && job.preferenceDelta !== 0 ? `(${job.preferenceDelta > 0 ? "+" : ""}${job.preferenceDelta.toFixed(1)}) ` : ""}${job.title} — ${job.companyName}`
    const beforeTop = beforePool.slice(0, 20)
    const afterTop = after.slice(0, 20)
    const afterIds = new Set(afterTop.map((job) => job.id))
    const fell = beforeTop
      .filter((job) => !afterIds.has(job.id))
      .map((job) => learned.jobs.find((item) => item.id === job.id) ?? job)
    const report = [
      "BEFORE top picks by base fit",
      ...beforeTop.map((job, index) => line(index, job)),
      "",
      "AFTER top picks with learned adjustment",
      ...afterTop.map((job, index) => line(index, job)),
      ...(fell.length > 0 ? ["", "Left the top 20", ...fell.map((job) => line(0, job))] : []),
    ].join("\n")
    console.log(`\n${report}\n`)

    expect(after.length).toBeGreaterThan(5)
    expect(learned.jobs.every((job) => Math.abs(job.preferenceDelta) <= TOTAL_CAP)).toBe(true)
    expect(after.some((job) => job.preferenceDelta >= 1.5)).toBe(true)
    expect(learned.jobs.some((job) => job.preferenceDelta < -0.3)).toBe(true)
    const harbor = learned.jobs.find((job) => job.companyName === "Harbor")
    const relay = learned.jobs.find((job) => job.companyName === "Relay Two")
    const keel = learned.jobs.find((job) => job.companyName === "Keel")
    expect(harbor && relay && harbor.preferenceDelta > relay.preferenceDelta).toBe(true)
    expect(keel && keel.preferenceDelta).toBeLessThan(0)
    const bestBase = [...after].sort((a, b) => (b.opportunityFit ?? 0) - (a.opportunityFit ?? 0))[0]
    expect(after.slice(0, 5).some((job) => job.id === bestBase.id)).toBe(true)
    const weakest = [...after].sort((a, b) => (a.opportunityFit ?? 0) - (b.opportunityFit ?? 0))[0]
    expect(after[0].id).not.toBe(weakest.id)
    expect(after.some((job) => job.actions.includes("applied") || job.actions.includes("not_interested"))).toBe(false)
    const beforeOrder = beforePool.map((job) => job.id).join()
    const afterOrder = after.map((job) => job.id).join()
    expect(afterOrder).not.toBe(beforeOrder)
    expect(learned.summary.boosting.length).toBeGreaterThan(0)
    expect(learned.summary.rankingDown.length).toBeGreaterThan(0)
    await db.close()
  }, 30000)
})
