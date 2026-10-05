export function postedDaysAgo(value: string | number | null | undefined, now: Date): number | null {
  if (value === null || value === undefined || value === "") return null
  const time = typeof value === "number" ? (value < 10_000_000_000 ? value * 1000 : value) : Date.parse(value)
  if (Number.isNaN(time)) return null
  const days = Math.floor((now.getTime() - time) / 86_400_000)
  return days < 0 ? 0 : days
}
