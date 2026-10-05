export type WorkArrangement = "onsite" | "hybrid" | "remote" | "unclear"

function classifyBlob(text: string): WorkArrangement | null {
  const value = text.toLowerCase()
  if (!value.trim()) return null

  if (/\b(not|no|isn't|is not)\s+(a\s+)?(fully\s+)?remote\b/.test(value) && !/\bhybrid\b/.test(value)) {
    return "onsite"
  }

  const hybrid = /\bhybrid\b/.test(value)
  const onsite = /\bon[- ]?site\b|\bin[- ]person\b|\bin[- ]office\b|\bin office\b/.test(value)
  const remoteOnly =
    /\bremote[- ]only\b|\bfully remote\b|\bwork from anywhere\b|\bfully distributed\b|\bremote[- ]first\b|\b100%\s*remote\b/.test(
      value,
    )
  const remoteWord = /\bremote\b/.test(value)

  if (hybrid) return "hybrid"
  if (onsite && remoteWord) return "hybrid"
  if (onsite) return "onsite"
  if (remoteOnly || remoteWord) return "remote"
  return null
}

export function parseWorkArrangement(input: {
  arrangementRaw?: string | null
  locationRaw?: string | null
  description?: string | null
}): WorkArrangement {
  const primary = classifyBlob(`${input.arrangementRaw ?? ""} ${input.locationRaw ?? ""}`)
  if (primary) return primary
  const fromDescription = classifyBlob(input.description ?? "")
  return fromDescription ?? "unclear"
}

export function arrangementLabel(value: WorkArrangement | string): string {
  switch (value) {
    case "onsite":
      return "On-site"
    case "hybrid":
      return "Hybrid"
    case "remote":
      return "Remote"
    case "unclear":
      return "Unclear"
    default:
      return value
  }
}
