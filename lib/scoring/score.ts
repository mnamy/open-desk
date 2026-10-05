import { createHash } from "node:crypto"
import type { Classification, ClassificationInput, QualificationRisk } from "@/lib/llm/types"
import { arrangementLabel } from "@/lib/jobs/work-arrangement"

export const FIT_WEIGHTS = {
  responsibilities: 0.3,
  industry: 0.2,
  product: 0.15,
  startup: 0.15,
  ownership: 0.1,
  title: 0.05,
  skills: 0.05,
} as const

const INDUSTRY_BOOSTS: { re: RegExp; label: string }[] = [
  { re: /music/i, label: "Music technology" },
  { re: /mental health|therapy|behavioral health/i, label: "Mental health technology" },
  { re: /education|edtech|learning/i, label: "Education technology" },
  { re: /fashion|beauty|apparel/i, label: "Fashion" },
  { re: /fitness|wellness/i, label: "Fitness" },
  { re: /fintech|payments|banking/i, label: "Fintech" },
  { re: /entertainment|film|streaming/i, label: "Entertainment" },
  { re: /social product|consumer social/i, label: "Social products" },
  { re: /retail/i, label: "Retail technology" },
  { re: /creator/i, label: "Creator tools" },
  { re: /accessibility/i, label: "Accessibility" },
  { re: /health tech|healthtech|digital health/i, label: "Health technology" },
  { re: /consumer/i, label: "Consumer technology" },
]

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function contentHash(input: Pick<ClassificationInput, "companyName" | "title" | "description">): string {
  return createHash("sha256")
    .update(`${input.companyName}\n${input.title}\n${input.description}`)
    .digest("hex")
}

function dutyLine(description: string): string | null {
  const match = description.match(/Day to day:\s*([^.]+)\./i)
  return match?.[1]?.trim() ?? null
}

function preferredTool(description: string): string | null {
  const match = description.match(/Preferred:\s*([^.]+)\./i)
  return match?.[1]?.trim() ?? null
}

function industryMatch(input: ClassificationInput): string | null {
  const text = `${input.industry ?? ""} ${input.description}`
  for (const boost of INDUSTRY_BOOSTS) {
    if (boost.re.test(text)) return input.industry || boost.label
  }
  return null
}

function salesHeavy(text: string): boolean {
  return /\b(sdr|bdr|quota|cold email|cold call|outbound meetings|sales development|book \d+ outbound)\b/i.test(text)
}

export function classifyDeterministic(input: ClassificationInput): Classification {
  const text = `${input.title}\n${input.description}`
  const duty = dutyLine(input.description)
  const dutyText = duty ?? input.description
  const sales = salesHeavy(text)
  const admin = /\b(calendar management|status reports?|scheduling meetings)\b/i.test(text)

  let responsibilities = 38
  const themes: RegExp[] = [
    /talk|interview|listen/,
    /writ|brief|requirement/,
    /launch|ship/,
    /experiment/,
    /prototype|design/,
    /analy/,
    /onboarding|activation|retention/,
  ]
  let themeHits = 0
  for (const theme of themes) {
    if (theme.test(dutyText)) {
      responsibilities += theme === themes[0] ? 14 : 12
      themeHits += 1
    }
  }
  if (sales) responsibilities -= 58
  if (admin && themeHits < 2) responsibilities -= 28
  responsibilities = clamp(responsibilities)

  const industryLabel = industryMatch(input)
  const industry = industryLabel ? 92 : input.industry ? 48 : 55

  const product = /requirement|roadmap|what (?:should|to) build|product decision|feature/.test(text.toLowerCase())
    ? 92
    : /\bproduct\b/i.test(text)
      ? 74
      : 36

  const startup = /early-stage|early stage|\bseed\b|series a|small team|startup|founding/i.test(text) ? 90 : 56

  const ownership = /own (?:this|a slice|the)|end to end|0 to 1|0→1|zero to one/i.test(text) ? 90 : 44

  const title = sales ? 8 : input.roleFamily === "Other" ? 40 : 90

  const skills = 80

  const opportunityFit = clamp(
    FIT_WEIGHTS.responsibilities * responsibilities +
      FIT_WEIGHTS.industry * industry +
      FIT_WEIGHTS.product * product +
      FIT_WEIGHTS.startup * startup +
      FIT_WEIGHTS.ownership * ownership +
      FIT_WEIGHTS.title * title +
      FIT_WEIGHTS.skills * skills,
  )

  const tool = preferredTool(input.description)
  let qualificationRisk: QualificationRisk = "LOW"
  if (input.experienceBucket === "stretch" || sales) qualificationRisk = "HIGH"
  else if (
    tool ||
    input.experienceLabel === "1 year" ||
    input.experienceLabel === "1+ year" ||
    input.experienceLabel === "Some experience preferred"
  ) {
    qualificationRisk = "MEDIUM"
  }

  const where = input.city ? `${input.companyName} in ${input.city}` : input.companyName
  const arrangement = arrangementLabel(input.workArrangement).toLowerCase()
  const sentences = [
    `${input.experienceLabel} ${arrangement} role at ${where}.`,
  ]
  if (duty) sentences.push(`Day to day, ${duty.charAt(0).toLowerCase()}${duty.slice(1)}.`)
  if (industryLabel) sentences.push(`${industryLabel} is a close industry match.`)
  if (/early-stage|early stage|\bseed\b|small team/i.test(text)) {
    sentences.push("The team is early-stage, so the work is broad.")
  }
  if (sales) {
    sentences.push("Most of the day is outbound selling against a quota, which is a weak match for the work you want.")
  }

  const stretchBits: string[] = []
  if (input.experienceBucket === "stretch") {
    stretchBits.push(
      `${input.companyName} asks for ${input.experienceLabel.toLowerCase()}, which is past a genuine 0–1 year role, so it stays in Stretch.`,
    )
  }
  if (tool) {
    stretchBits.push(`They prefer ${tool.charAt(0).toLowerCase()}${tool.slice(1)}.`)
  }
  const preferredYear = input.description.match(
    /(\d+\s*(?:-|–|—|\+)?\s*(?:to\s+\d+\s*)?years?(?:\s+of experience)?\s+preferred)/i,
  )
  if (preferredYear && input.experienceBucket === "main") {
    stretchBits.push(
      `They also say “${preferredYear[1].trim()},” and that preference does not raise the bar for the main feed.`,
    )
  }
  if (stretchBits.length === 0) {
    stretchBits.push(
      `${input.companyName} sets this at ${input.experienceLabel.toLowerCase()} and does not add a preferred tool or a higher year bar.`,
    )
  }

  return {
    opportunityFit,
    qualificationRisk,
    whyMatch: sentences.join(" "),
    stretchReason: stretchBits.join(" "),
    roleFamily: input.roleFamily,
    contentHash: contentHash(input),
  }
}
