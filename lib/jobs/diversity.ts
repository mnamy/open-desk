/** Reorder only among jobs already this close in rank score. */
export const DIVERSITY_BAND = 4

export function diversityGroup(roleFamily: string | null, title: string): string {
  const family = roleFamily ?? "Other"
  const text = title.toLowerCase()
  if (/\bproduct operations\b|\bproduct ops\b/.test(text)) return "Ops"
  if (family === "Product" || family === "Product design") return "Product"
  if (family === "Strategy & operations") {
    if (/\bstrateg/.test(text) && !/\b(operations|biz\s?ops)\b/.test(text)) return "Strategy"
    return "Ops"
  }
  if (family === "Growth") return "Growth"
  if (family === "Founder's office") return "Founder"
  if (family === "User research" || family === "Insights") return "Research"
  if (family === "Innovation" || family === "Special projects") return "Innovation"
  if (family === "Customer experience") return "Experience"
  if (family === "Program" || family === "Community") return "Program"
  if (family === "Consulting") return "Consulting"
  return family
}

export function orderWithDiversity<T extends { title: string; roleFamily: string | null }>(
  jobs: T[],
  score: (job: T) => number,
): T[] {
  const remaining = [...jobs]
  const counts = new Map<string, number>()
  const ordered: T[] = []
  while (remaining.length > 0) {
    let best = -Infinity
    for (const job of remaining) best = Math.max(best, score(job))
    const band = remaining.filter((job) => best - score(job) <= DIVERSITY_BAND)
    band.sort((a, b) => {
      const groupA = counts.get(diversityGroup(a.roleFamily, a.title)) ?? 0
      const groupB = counts.get(diversityGroup(b.roleFamily, b.title)) ?? 0
      if (groupA !== groupB) return groupA - groupB
      return score(b) - score(a) || a.title.localeCompare(b.title)
    })
    const pick = band[0]
    ordered.push(pick)
    const group = diversityGroup(pick.roleFamily, pick.title)
    counts.set(group, (counts.get(group) ?? 0) + 1)
    remaining.splice(remaining.indexOf(pick), 1)
  }
  return ordered
}
