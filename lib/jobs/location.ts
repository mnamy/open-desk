export const ALLOWED_CITIES = [
  "New York City",
  "Chicago",
  "Boston",
  "Miami",
  "Austin",
] as const

export type AllowedCity = (typeof ALLOWED_CITIES)[number]

const CITY_RULES: { city: AllowedCity; re: RegExp }[] = [
  {
    city: "New York City",
    re: /(?<!west\s)\b(?:new york city|nyc|manhattan|brooklyn|queens|staten island|the bronx|bronx|new york(?:\s*,\s*|\s+)?(?:ny|new york)?)\b/gi,
  },
  {
    city: "Chicago",
    re: /\bchicago(?:\s*,\s*|\s+)?(?:il|illinois)?\b/gi,
  },
  {
    city: "Boston",
    re: /\bboston(?:\s*,\s*|\s+)?(?:ma|massachusetts)?\b/gi,
  },
  {
    city: "Miami",
    re: /\bmiami(?:\s+beach)?(?:\s*,\s*|\s+)?(?:fl|florida)?\b/gi,
  },
  {
    city: "Austin",
    re: /\baustin(?:\s*,\s*|\s+)?(?:tx|texas)?\b/gi,
  },
]

export function normalizeCity(locationRaw: string | null | undefined): AllowedCity | null {
  if (!locationRaw?.trim()) return null

  const hits: { city: AllowedCity; index: number; length: number }[] = []
  for (const rule of CITY_RULES) {
    for (const match of locationRaw.matchAll(rule.re)) {
      if (match.index === undefined) continue
      hits.push({ city: rule.city, index: match.index, length: match[0].length })
    }
  }

  if (hits.length === 0) return null
  hits.sort((a, b) => a.index - b.index || b.length - a.length)
  return hits[0].city
}
