import { createHash } from "node:crypto"
import type { Classification, ClassificationInput, QualificationRisk } from "@/lib/llm/types"
import { plainText } from "@/lib/jobs/text"
import { arrangementLabel } from "@/lib/jobs/work-arrangement"

export const FIT_WEIGHTS = {
  role: 0.34,
  level: 0.18,
  product: 0.18,
  ownership: 0.12,
  industry: 0.1,
  startup: 0.08,
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
    .update(`relevance-v2\n${input.companyName}\n${input.title}\n${input.description}`)
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

function roleScore(tier: ClassificationInput["roleTier"]): number {
  if (tier === 1) return 96
  if (tier === 2) return 80
  if (tier === 3) return 58
  return 12
}

function levelScore(signal: ClassificationInput["levelSignal"]): number {
  if (signal === "entry") return 94
  if (signal === "modest") return 66
  return 40
}

function productScore(text: string): number {
  if (/\b(user research|ux research|prototype|prototyp|product requirement|what to build|roadmap|experiment|product strategy|interaction design|user experience)\b/i.test(text)) {
    return 92
  }
  if (/\b(product|feature|design|research|insight)\b/i.test(text)) return 68
  return 28
}

function ownershipScore(text: string): number {
  if (/\b(end to end|0 to 1|0→1|zero to one|cross-functional|own (?:this|a slice|the))\b/i.test(text)) return 90
  if (/\b(product team|partner with)\b/i.test(text)) return 70
  return 38
}

export function classifyDeterministic(input: ClassificationInput): Classification {
  const text = plainText(`${input.title}\n${input.description}`)
  const duty = dutyLine(input.description)
  const sales = salesHeavy(text)
  const seniorTitle = /\b(senior|sr\.?|staff|principal|director|head of|vice president|\bvp\b|chief|tech lead|engineering manager)\b/i.test(input.title)
  const industryLabel = industryMatch(input)
  const industry = industryLabel ? 90 : 42
  const startup = /early-stage|early stage|\bseed\b|series a|small team|startup|founding/i.test(text) ? 86 : 46
  const product = productScore(text)
  const ownership = ownershipScore(text)

  let opportunityFit = clamp(
    FIT_WEIGHTS.role * roleScore(input.roleTier) +
      FIT_WEIGHTS.level * levelScore(input.levelSignal) +
      FIT_WEIGHTS.product * product +
      FIT_WEIGHTS.ownership * ownership +
      FIT_WEIGHTS.industry * industry +
      FIT_WEIGHTS.startup * startup,
  )
  if (input.roleTier === 3 && product < 90) opportunityFit = Math.min(opportunityFit, 72)
  if (input.roleTier === 0 || sales || seniorTitle) opportunityFit = Math.min(opportunityFit, 24)
  if (/\b(accountant|attorney|recruiter|registered nurse|supply chain|merchandis)/i.test(input.title)) {
    opportunityFit = Math.min(opportunityFit, 20)
  }

  const tool = preferredTool(input.description)
  let qualificationRisk: QualificationRisk = "LOW"
  if (input.levelSignal === "high" || seniorTitle || sales) qualificationRisk = "HIGH"
  else if (
    input.levelSignal === "modest" ||
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
  if (industryLabel) sentences.push(`The company sits in ${industryLabel}.`)
  if (/early-stage|early stage|\bseed\b|small team/i.test(text)) {
    sentences.push("The team is early-stage, so the work is broad.")
  }
  if (sales) {
    sentences.push("Most of the day is outbound selling against a quota, which is a weak match for the work you want.")
  }

  const stretchBits: string[] = []
  if (input.experienceBucket === "stretch") {
    if (input.levelSignal === "high" && /no stated experience/i.test(input.experienceLabel)) {
      stretchBits.push(
        `${input.companyName} does not state a year requirement, and the title is not clearly early-career, so it stays in Stretch.`,
      )
    } else {
      stretchBits.push(
        `${input.companyName} asks for ${input.experienceLabel.toLowerCase()}, which is past a genuine 0–1 year role, so it stays in Stretch.`,
      )
    }
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
