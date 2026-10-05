import { describe, expect, it } from "vitest"
import { evaluateHardFilters } from "@/lib/jobs/evaluate"
import { inferRoleFamily } from "@/lib/jobs/role-family"
import { classifyDeterministic } from "@/lib/scoring/score"

const office = {
  locationRaw: "New York, NY",
  arrangementRaw: "Hybrid",
  employmentType: "Full-time",
}

function judged(title: string, description: string, employmentType = "Full-time") {
  return evaluateHardFilters({ ...office, title, description, employmentType })
}

const noisy = "Work with the team on the product in the New York office. Hybrid schedule."

describe("role family follows the title", () => {
  it("does not relabel obvious titles from description keywords", () => {
    expect(inferRoleFamily("Software Engineer - Full Stack", "Own growth experiments and retention.")).toBe("Engineering")
    expect(inferRoleFamily("Senior iOS Engineer", "Strategy and operations for the company.")).toBe("Engineering")
    expect(inferRoleFamily("Senior Director of Engineering", "Lead user research for the org.")).toBe("Engineering")
    expect(inferRoleFamily("Data Scientist", "Growth forecasting and user insights.")).toBe("Data science")
    expect(inferRoleFamily("Account Executive, Enterprise", "Figma creator tools.")).toBe("Sales")
    expect(inferRoleFamily("Product Designer", "Growth team.")).toBe("Product design")
    expect(inferRoleFamily("Product Manager", "Engineering support.")).toBe("Product")
    expect(inferRoleFamily("UX Researcher", "Strategy planning.")).toBe("User research")
    expect(inferRoleFamily("Business Operations Associate", "")).toBe("Strategy & operations")
    expect(inferRoleFamily("Founder's Associate", "")).toBe("Founder's office")
    expect(inferRoleFamily("Startup Generalist", "")).toBe("Founder's office")
    expect(inferRoleFamily("Founding Associate", "")).toBe("Founder's office")
    expect(inferRoleFamily("Research Associate", "")).toBe("User research")
    expect(inferRoleFamily("Strategist", "")).toBe("Strategy & operations")
    expect(inferRoleFamily("Product Development Associate", "")).toBe("Product")
  })
})

describe("hard rejects stay out of the working feeds", () => {
  it.each([
    "Director, Marketing - Figma Weave",
    "Software Engineer - Full Stack",
    "Head of Influencers & Community",
    "Senior Data Scientist, Growth Forecasting",
    "Business Development Representative - NYC",
    "Director, Business Operations",
    "Machine Learning Engineer, Senior",
    "Senior Data Science Manager, User Growth",
    "Senior Digital Product Manager",
    "Senior Localization Program Manager",
    "Senior Product Manager, Marketing Enablement",
    "Staff Product Designer, Core Experience",
    "Design Systems Lead",
    "Senior Android Engineer",
    "Senior Data Scientist, User Growth",
    "Senior Director of Engineering",
    "Senior iOS Engineer",
    "Senior Machine Learning Engineer",
    "Sr. Manager, Customer Experience",
    "Tech Lead Manager",
    "Account Executive, Enterprise",
    "Account Executive, Mid-Market",
    "Account Executive, Strategic",
    "AI/ML Engineer",
    "Software Engineering Intern",
    "Summer Intern, Product",
    "Product Management Co-op",
  ])("rejects %s", (title) => {
    const result = judged(title, noisy)
    expect(result.feedBucket).toBe("excluded")
  })

  it("rejects a senior title even when the body is explicitly entry level", () => {
    const result = judged("Senior Product Manager", "New graduate role. 0–1 years of experience. Day to day: write the roadmap.")
    expect(result.feedBucket).toBe("excluded")
    expect(result.exclusionReason).toBe("seniority")
    expect(result.experience.label).toBe("0–1 years")
  })

  it("rejects an internship without treating internship experience on a full-time role as one", () => {
    expect(judged("Summer Intern", "Full-time new grad program for 2027.").exclusionReason).toBe("internship")
    const fullTime = judged(
      "Associate Product Designer",
      "Internship experience is welcome. 0–1 years. Day to day: design product screens and test them with shoppers.",
    )
    expect(fullTime.feedBucket).toBe("main")
    expect(fullTime.exclusionReason).toBeNull()
  })

  it("rejects pure engineering and keeps a prototyping design engineer", () => {
    const swe = judged(
      "Software Engineer - Full Stack",
      "Own growth experiments. No years of experience are listed.",
    )
    expect(swe.exclusionReason).toBe("engineering")
    expect(swe.roleFamily).toBe("Engineering")

    const backendDesign = judged(
      "Design Engineer",
      "Entry level. Day to day: build backend services and APIs in Go for the data platform.",
    )
    expect(backendDesign.feedBucket).toBe("excluded")
    expect(backendDesign.exclusionReason).toBe("engineering")

    const productDesignEngineer = judged(
      "Design Engineer",
      "Junior role. Day to day: prototype product interfaces in the browser with the design team.",
    )
    expect(productDesignEngineer.feedBucket).toBe("main")
    expect(productDesignEngineer.roleFamily).toBe("Design engineering")
  })

  it("rejects quota sales and keeps strategy-oriented business development", () => {
    expect(judged("Account Executive, Enterprise", "Spotify music technology. Hybrid in New York.").exclusionReason).toBe("sales")
    expect(judged("Business Development Representative - NYC", noisy).exclusionReason).toBe("sales")
    const quota = judged(
      "Business Development Associate",
      "Entry level. Carry a quota and book outbound prospecting meetings.",
    )
    expect(quota.exclusionReason).toBe("sales")

    const partnerships = judged(
      "Business Development Associate",
      "New graduate. Day to day: research partnership strategy with the product team and write what to build. This is not a sales role.",
    )
    expect(partnerships.feedBucket).not.toBe("excluded")
    expect(partnerships.exclusionReason).toBeNull()
  })

  it("ignores company history and benefits when reading years", () => {
    const result = judged(
      "Associate Product Manager",
      "We have been profitable for over 15 years. Sabbatical after 5 years. 0–1 years of experience. Day to day: write what to build with the product team.",
    )
    expect(result.feedBucket).toBe("main")
    expect(result.experience.label).toBe("0–1 years")
  })

  it("rejects support queues and mid-level preferred ranges", () => {
    const support = judged(
      "University Grad | Customer Experience Associate",
      "You will spend the day on live calls and support tickets. This is customer support.",
    )
    expect(support.feedBucket).toBe("excluded")
    expect(support.exclusionReason).toBe("relevance")

    const wide = judged(
      "Product Designer",
      "2–7 years designing product interfaces. Benefits include a 401(k).",
    )
    expect(wide.feedBucket).toBe("excluded")
    expect(wide.exclusionReason).toBe("experience")

    const tenured = judged(
      "Product Operations Specialist | Generalist",
      "As a tenured member of the team, you will assist junior members and own the operations roadmap.",
    )
    expect(tenured.feedBucket).toBe("excluded")
    expect(tenured.exclusionReason).toBe("seniority")
  })

  it("does not treat a blank year requirement as entry level", () => {
    const pm = judged("Product Manager", "Own a product area with engineering and design. No years are stated.")
    expect(pm.feedBucket).toBe("stretch")
    expect(pm.levelSignal).toBe("high")

    const peopleLead = judged(
      "Product Manager",
      "Manage a team of product managers and own company-wide strategy. No years are stated.",
    )
    expect(peopleLead.feedBucket).toBe("excluded")
    expect(peopleLead.exclusionReason).toBe("seniority")
  })

  it("infers level when years are unstated", () => {
    const junior = judged(
      "Product Manager",
      "Day to day: write feature requirements and talk to users. You will not manage people. No years are stated.",
    )
    expect(junior.feedBucket).toBe("main")
    expect(junior.exclusionReason).toBeNull()

    const ambiguous = judged("Product Designer", "Design the core product experience with the design team. No years are stated.")
    expect(ambiguous.feedBucket).toBe("main")

    const plain = judged("Researcher", "Study how people use the product and share findings. No years are stated.")
    expect(plain.feedBucket).toBe("stretch")
    expect(plain.exclusionReason).toBeNull()

    const seniorScope = judged(
      "Product Manager",
      "As a tenured member, you will manage a team of designers and own the function. No years are stated.",
    )
    expect(seniorScope.feedBucket).toBe("excluded")
    expect(seniorScope.exclusionReason).toBe("seniority")
  })

  it("keeps a two-year requirement visible and rejects three or more", () => {
    const two = judged(
      "Product Manager",
      "2 years of experience required. Day to day: talk to users and write what to build with the product team.",
    )
    expect(two.feedBucket).toBe("stretch")
    expect(two.exclusionReason).toBeNull()

    const three = judged(
      "Product Associate",
      "3+ years of experience required. Day to day: talk to users and write what to build.",
    )
    expect(three.feedBucket).toBe("excluded")
    expect(three.exclusionReason).toBe("experience")
  })

  it("does not let company boilerplate keep marketing titles", () => {
    const boilerplate = "Talk to users, run user research, prototype the product, and launch the product with the product team."
    expect(judged("Product Marketing Associate", boilerplate).feedBucket).toBe("excluded")
    expect(judged("Brand Strategy Associate", boilerplate).feedBucket).toBe("excluded")
    expect(judged("Social Media Manager", boilerplate).feedBucket).toBe("excluded")
  })

  it("keeps a weird startup title when the work is product-heavy", () => {
    const ranger = judged(
      "Zero to One Ranger",
      "Day to day: talk to users, run user research, prototype the first version, and launch the product with the product team.",
    )
    expect(ranger.feedBucket).not.toBe("excluded")
    expect(ranger.roleFamily).toBe("Adjacent")
  })

  it("keeps product, research, design, and strategy roles when they look entry level", () => {
    const cases = [
      ["Early Career, Product Designer", "Design product interfaces and prototype flows with the product team."],
      ["Product Associate", "New graduate. Day to day: write feature requirements and talk to users."],
      ["Associate Product Manager", "0–1 years of experience. Day to day: decide what to build with the product team."],
      ["Product Operations Associate", "Entry level. Day to day: turn a launch into a product checklist with the product team."],
      ["Strategy & Operations Associate", "Less than 2 years of experience. Day to day: write an operating plan with the product team."],
      ["UX Research Associate", "New graduate role. Day to day: interview users and bring findings to the product team."],
      ["Consumer Insights Associate", "Entry level. Day to day: interview shoppers and write what the product should change."],
      ["Founder's Associate", "Early career. Day to day: decide what to build with the founder and write the product brief."],
    ] as const
    for (const [title, description] of cases) {
      const result = judged(title, description)
      expect(result.feedBucket, title).not.toBe("excluded")
      expect(["main", "stretch"]).toContain(result.feedBucket)
    }
  })
})

describe("fit and risk follow eligibility", () => {
  it("does not give a senior or wrong-function role a low risk or a high score", () => {
    const senior = classifyDeterministic({
      companyName: "Duolingo",
      title: "Senior Director of Engineering",
      description: "Lead the engineering organization. Education technology.",
      city: "New York City",
      workArrangement: "hybrid",
      experienceLabel: "No stated experience requirement",
      experienceBucket: "main",
      requiredOrPreferred: "none",
      industry: "Education technology",
      roleFamily: "Engineering",
      roleTier: 0,
      levelSignal: "high",
    })
    expect(senior.qualificationRisk).toBe("HIGH")
    expect(senior.opportunityFit).toBeLessThanOrEqual(24)

    const sales = classifyDeterministic({
      companyName: "Figma",
      title: "Account Executive, Enterprise",
      description: "Creator tools. Carry a quota.",
      city: "New York City",
      workArrangement: "hybrid",
      experienceLabel: "No stated experience requirement",
      experienceBucket: "main",
      requiredOrPreferred: "none",
      industry: "Creator tools",
      roleFamily: "Sales",
      roleTier: 0,
      levelSignal: "high",
    })
    expect(sales.qualificationRisk).toBe("HIGH")
    expect(sales.opportunityFit).toBeLessThanOrEqual(24)

    const engineer = classifyDeterministic({
      companyName: "Spotify",
      title: "Senior Machine Learning Engineer",
      description: "Music technology. Build ranking models.",
      city: "New York City",
      workArrangement: "hybrid",
      experienceLabel: "No stated experience requirement",
      experienceBucket: "main",
      requiredOrPreferred: "none",
      industry: "Music technology",
      roleFamily: "Engineering",
      roleTier: 0,
      levelSignal: "high",
    })
    expect(engineer.opportunityFit).toBeLessThanOrEqual(24)
    expect(engineer.qualificationRisk).toBe("HIGH")
  })
})
