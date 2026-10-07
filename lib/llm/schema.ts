export const LOCAL_MODEL_ID = "Llama-3.2-1B-Instruct-q4f16_1-MLC"

export const FEEDBACK_DIMENSIONS = [
  "ownership",
  "strategy",
  "decision_making",
  "experimentation",
  "user_research",
  "cross_functional",
  "growth",
  "operations",
  "product",
  "administrative_execution",
  "technical_intensity",
  "sales_intensity",
] as const

export type FeedbackDimension = (typeof FEEDBACK_DIMENSIONS)[number]

export interface FeedbackInterpretation {
  positive_preferences: Partial<Record<FeedbackDimension, number>>
  negative_preferences: Partial<Record<FeedbackDimension, number>>
}

export const JOB_FEATURES = [
  "product_exposure",
  "strategy_exposure",
  "operations_exposure",
  "growth_exposure",
  "research_exposure",
  "design_exposure",
  "technical_intensity",
  "sales_intensity",
  "experimentation",
  "user_interaction",
  "ownership",
  "decision_making",
  "administrative_intensity",
  "people_management",
  "cross_functional",
] as const

export type JobFeature = (typeof JOB_FEATURES)[number]
export type JobFeatures = Record<JobFeature, number>

const DIMENSION_SET = new Set<string>(FEEDBACK_DIMENSIONS)

export function interpretationSource(kind: "feedback" | "job", text: string): string {
  const limit = kind === "feedback" ? 1000 : 8000
  return text.trim().replace(/\s+/g, " ").slice(0, limit)
}

export async function interpretationHash(kind: "feedback" | "job", text: string): Promise<string> {
  const source = interpretationSource(kind, text)
  const body = new TextEncoder().encode(`open-desk-interpret-v1\n${kind}\n${source}`)
  const digest = await crypto.subtle.digest("SHA-256", body)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

export function extractJson(text: string): unknown {
  const trimmed = text.trim()
  const direct = parse(trimmed)
  if (direct !== undefined) return direct
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) {
    const inner = parse(fenced[1].trim())
    if (inner !== undefined) return inner
  }
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start >= 0 && end > start) {
    const sliced = parse(trimmed.slice(start, end + 1))
    if (sliced !== undefined) return sliced
  }
  return null
}

function parse(text: string): unknown | undefined {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function unit(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100
}

function preferenceMap(value: unknown): Partial<Record<FeedbackDimension, number>> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const result: Partial<Record<FeedbackDimension, number>> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (!DIMENSION_SET.has(key)) continue
    const score = unit(raw)
    if (score === null || score === 0) continue
    result[key as FeedbackDimension] = score
  }
  return result
}

export function parseFeedbackInterpretation(text: string): FeedbackInterpretation | null {
  const parsed = extractJson(text)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  if (!("positive_preferences" in record) || !("negative_preferences" in record)) return null
  const positive = preferenceMap(record.positive_preferences)
  const negative = preferenceMap(record.negative_preferences)
  if (!positive || !negative) return null
  for (const key of Object.keys(positive) as FeedbackDimension[]) {
    const against = negative[key]
    if (against === undefined) continue
    if (against > (positive[key] ?? 0)) delete positive[key]
    else if ((positive[key] ?? 0) > against) delete negative[key]
    else {
      delete positive[key]
      delete negative[key]
    }
  }
  return { positive_preferences: positive, negative_preferences: negative }
}

export function parseJobFeatures(text: string): JobFeatures | null {
  const parsed = extractJson(text)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  const features = {} as JobFeatures
  for (const key of JOB_FEATURES) {
    const score = unit(record[key])
    if (score === null) return null
    features[key] = score
  }
  return features
}

export function feedbackSignalsJson(value: FeedbackInterpretation): string {
  return JSON.stringify(value)
}

export function jobSignalsJson(value: JobFeatures): string {
  return JSON.stringify(value)
}
