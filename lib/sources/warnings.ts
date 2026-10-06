export type WarningKind = "stale" | "blocked" | "rate_limited" | "timeout" | "other"

const LABELS: Record<WarningKind, string> = {
  stale: "Stale or removed",
  blocked: "Temporarily blocked",
  rate_limited: "Rate limited",
  timeout: "Timed out",
  other: "Could not be read",
}

export function classifyWarning(message: string): WarningKind {
  const text = message.toLowerCase()
  if (text.includes("429") || text.includes("rate limit") || text.includes("too many")) return "rate_limited"
  if (text.includes("timed out") || text.includes("timeout") || text.includes("aborted")) return "timeout"
  if (text.includes("403") || text.includes("401") || text.includes("forbidden") || text.includes("blocked")) return "blocked"
  if (text.includes("404") || text.includes("410") || text.includes("not found")) return "stale"
  return "other"
}

export function isStaleFailure(message: string): boolean {
  return classifyWarning(message) === "stale"
}

export interface WarningSummary {
  count: number
  headline: string
  groups: { label: string; count: number }[]
}

export function summarizeWarnings(warnings: string[]): WarningSummary {
  const counts = new Map<WarningKind, number>()
  for (const warning of warnings) {
    const kind = classifyWarning(warning)
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  const order: WarningKind[] = ["stale", "blocked", "rate_limited", "timeout", "other"]
  const groups = order
    .filter((kind) => counts.has(kind))
    .map((kind) => ({ label: LABELS[kind], count: counts.get(kind) ?? 0 }))
  const count = warnings.length
  const noun = count === 1 ? "source" : "sources"
  return {
    count,
    headline: count === 0 ? "" : `${count} ${noun} could not be checked`,
    groups,
  }
}
