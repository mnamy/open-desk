import type { FeedbackInterpretation } from "@/lib/llm/schema"

export const FEEDBACK_FEATURES: Record<
  keyof FeedbackInterpretation["positive_preferences"] | string,
  { key: string; label: string; up: string; down: string }
> = {
  ownership: {
    key: "exposure:ownership",
    label: "0→1 ownership",
    up: "0→1 roles",
    down: "ownership-heavy responsibilities",
  },
  strategy: {
    key: "exposure:strategy",
    label: "Product strategy",
    up: "product strategy roles",
    down: "strategy responsibilities",
  },
  decision_making: {
    key: "exposure:decision",
    label: "Decision-making",
    up: "decision-making roles",
    down: "decision-making responsibilities",
  },
  experimentation: {
    key: "exposure:experiment",
    label: "Experimentation",
    up: "experimentation roles",
    down: "experimentation responsibilities",
  },
  user_research: {
    key: "exposure:research",
    label: "User research",
    up: "user research roles",
    down: "user research responsibilities",
  },
  cross_functional: {
    key: "exposure:cross-functional",
    label: "Cross-functional work",
    up: "cross-functional roles",
    down: "cross-functional responsibilities",
  },
  growth: {
    key: "exposure:growth",
    label: "Growth work",
    up: "growth roles",
    down: "growth responsibilities",
  },
  operations: {
    key: "exposure:operations",
    label: "Operations work",
    up: "operations roles",
    down: "operations-heavy responsibilities",
  },
  product: {
    key: "exposure:product",
    label: "Product work",
    up: "product roles",
    down: "product responsibilities",
  },
  administrative_execution: {
    key: "exposure:admin",
    label: "Administrative execution",
    up: "administrative roles",
    down: "administrative execution",
  },
  technical_intensity: {
    key: "exposure:technical",
    label: "Highly technical roles",
    up: "technical roles",
    down: "highly technical responsibilities",
  },
  sales_intensity: {
    key: "exposure:sales",
    label: "Sales-heavy work",
    up: "sales roles",
    down: "sales-heavy responsibilities",
  },
}

export const NOTE_SIGNAL_STEP = 2.4
export const NOTE_SIGNAL_CAP = 3.5

export interface NoteAddition {
  key: string
  amount: number
  label: string
  upPhrase: string
  downPhrase: string
  source: "noted"
}

export function noteAdditions(signals: FeedbackInterpretation): NoteAddition[] {
  const additions: NoteAddition[] = []
  for (const [dimension, value] of Object.entries(signals.positive_preferences)) {
    const meta = FEEDBACK_FEATURES[dimension]
    if (!meta || !value) continue
    additions.push({
      key: meta.key,
      amount: value * NOTE_SIGNAL_STEP,
      label: meta.label,
      upPhrase: meta.up,
      downPhrase: meta.down,
      source: "noted",
    })
  }
  for (const [dimension, value] of Object.entries(signals.negative_preferences)) {
    const meta = FEEDBACK_FEATURES[dimension]
    if (!meta || !value) continue
    additions.push({
      key: meta.key,
      amount: -value * NOTE_SIGNAL_STEP,
      label: meta.label,
      upPhrase: meta.up,
      downPhrase: meta.down,
      source: "noted",
    })
  }
  const total = additions.reduce((sum, item) => sum + Math.abs(item.amount), 0)
  if (total <= NOTE_SIGNAL_CAP || total === 0) return additions
  const factor = NOTE_SIGNAL_CAP / total
  return additions.map((item) => ({ ...item, amount: item.amount * factor }))
}
