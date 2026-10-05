const TIME_ZONE = "America/New_York"

export type PostedFilter = "today" | "yesterday" | "3d" | "7d" | "older" | "unknown"

export interface Freshness {
  postedLabel: string | null
  discoveredLabel: string
  postedFilter: PostedFilter
}

export function formatDeskDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)
}

export function formatDeskTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date)
}

function zonedDayNumber(date: Date): number {
  const key = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
  const [year, month, day] = key.split("-").map(Number)
  return Date.UTC(year, month - 1, day) / 86_400_000
}

export function freshness(postedAt: Date | null, firstSeenAt: Date, now: Date): Freshness {
  if (!postedAt) {
    return {
      postedLabel: null,
      discoveredLabel: `First discovered ${formatDeskDate(firstSeenAt)}`,
      postedFilter: "unknown",
    }
  }

  const diff = zonedDayNumber(now) - zonedDayNumber(postedAt)
  if (diff <= 0) {
    return {
      postedLabel: "Posted today",
      discoveredLabel: `Discovered ${formatDeskDate(firstSeenAt)}`,
      postedFilter: "today",
    }
  }
  if (diff === 1) {
    return {
      postedLabel: "Posted yesterday",
      discoveredLabel: `Discovered ${formatDeskDate(firstSeenAt)}`,
      postedFilter: "yesterday",
    }
  }
  if (diff <= 3) {
    return {
      postedLabel: "Posted within 3 days",
      discoveredLabel: `Discovered ${formatDeskDate(firstSeenAt)}`,
      postedFilter: "3d",
    }
  }
  if (diff <= 7) {
    return {
      postedLabel: "Posted within 7 days",
      discoveredLabel: `Discovered ${formatDeskDate(firstSeenAt)}`,
      postedFilter: "7d",
    }
  }
  return {
    postedLabel: "Older",
    discoveredLabel: `Discovered ${formatDeskDate(firstSeenAt)}`,
    postedFilter: "older",
  }
}

export function matchesPostedFilter(filter: string | undefined, posted: PostedFilter): boolean {
  if (!filter || filter === "any") return true
  if (filter === "unknown") return posted === "unknown"
  if (filter === "older") return posted === "older"
  if (filter === "today") return posted === "today"
  if (filter === "yesterday") return posted === "yesterday"
  if (filter === "3d") return posted === "today" || posted === "yesterday" || posted === "3d"
  if (filter === "7d") return posted === "today" || posted === "yesterday" || posted === "3d" || posted === "7d"
  return true
}
