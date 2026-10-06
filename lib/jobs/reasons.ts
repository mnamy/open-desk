export const REJECTION_REASONS = [
  { id: "too_senior", label: "Too senior" },
  { id: "wrong_function", label: "Wrong job function" },
  { id: "too_technical", label: "Too technical / engineering-heavy" },
  { id: "too_sales", label: "Too sales-heavy" },
  { id: "too_marketing", label: "Too marketing-heavy" },
  { id: "too_operations", label: "Too operations/admin-heavy" },
  { id: "industry", label: "Not interested in the industry" },
  { id: "company", label: "Not interested in the company" },
  { id: "responsibilities", label: "Responsibilities do not interest me" },
  { id: "location", label: "Location / work arrangement" },
  { id: "compensation", label: "Compensation" },
  { id: "other", label: "Other" },
] as const

export type RejectionReasonId = (typeof REJECTION_REASONS)[number]["id"]

export const LEGACY_REASON = "legacy"

const REASON_IDS = new Set<string>(REJECTION_REASONS.map((reason) => reason.id))

export function rejectionReasonLabel(id: string): string {
  return REJECTION_REASONS.find((reason) => reason.id === id)?.label ?? "Unknown / earlier feedback"
}

export function validRejectionReasons(reasons: string[]): RejectionReasonId[] {
  const unique = [...new Set(reasons.map((reason) => reason.trim()))]
  return unique.filter((reason): reason is RejectionReasonId => REASON_IDS.has(reason))
}
