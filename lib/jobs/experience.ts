export type ExperienceBucket = "main" | "stretch" | "reject"
export type ExperienceMode = "required" | "preferred" | "none" | "mixed"

export interface ExperienceParse {
  bucket: ExperienceBucket
  experienceMin: number | null
  experienceMax: number | null
  requiredOrPreferred: ExperienceMode
  label: string
  reason: string
}

type YearKind = "range" | "plus" | "exact" | "less_than" | "up_to" | "approx"
type Phrase =
  | "prof_preferred"
  | "some_preferred"
  | "no_experience"
  | "internship"
  | "new_grad"
  | "entry_level"
  | "early_career"
  | "junior"
  | "senior_exp"
  | "lead_exp"
  | "staff_exp"
  | "principal_exp"
type Qualifier = "required" | "preferred" | "unspecified"

interface Hit {
  kind: "years" | "phrase"
  yearKind?: YearKind
  phrase?: Phrase
  min: number | null
  max: number | null
  qualifier: Qualifier
  raw: string
  index: number
}

const PHRASES: { phrase: Phrase; re: RegExp }[] = [
  { phrase: "prof_preferred", re: /professional experience preferred but not required/i },
  { phrase: "some_preferred", re: /some experience preferred/i },
  {
    phrase: "no_experience",
    re: /no (?:prior |previous )?(?:professional )?experience (?:required|necessary|needed)|experience is not required|no experience required/i,
  },
  {
    phrase: "internship",
    re: /internships? (?:are )?accepted as experience|internship experience/i,
  },
  {
    phrase: "new_grad",
    re: /new grads?\b|new graduates?\b|recent graduates?\b|recent college graduates?\b/i,
  },
  { phrase: "entry_level", re: /entry[- ]level/i },
  { phrase: "early_career", re: /early career/i },
  { phrase: "junior", re: /\bjunior\b/i },
  { phrase: "senior_exp", re: /senior experience/i },
  { phrase: "lead_exp", re: /lead[- ]level experience/i },
  { phrase: "staff_exp", re: /staff[- ]level experience/i },
  { phrase: "principal_exp", re: /principal[- ]level experience/i },
]

const LEVEL_PHRASES = new Set<Phrase>([
  "senior_exp",
  "lead_exp",
  "staff_exp",
  "principal_exp",
])

function sentenceAt(text: string, index: number): string {
  let start = 0
  for (let i = index; i >= 0; i -= 1) {
    if (".!?\n".includes(text[i] ?? "")) {
      start = i + 1
      break
    }
  }
  let end = text.length
  for (let i = index; i < text.length; i += 1) {
    if (".!?\n".includes(text[i] ?? "")) {
      end = i
      break
    }
  }
  return text.slice(start, end)
}

function qualifierOf(sentence: string): Qualifier {
  const preferred =
    /\bprefer|\bideally\b|\bnice to have\b|\bnice-to-have\b|\ba plus\b|\bbonus\b|\boptional\b|\bnot required\b/.test(
      sentence.toLowerCase(),
    )
  const required = /\brequire|\bmust have\b|\bmust-have\b|\bminimum\b|\bat least\b/.test(
    sentence.toLowerCase(),
  )
  if (preferred && required) {
    if (/prefer/.test(sentence.toLowerCase()) && /not required/.test(sentence.toLowerCase())) {
      return "preferred"
    }
    return "required"
  }
  if (preferred) return "preferred"
  if (required) return "required"
  return "unspecified"
}

function collectYearHits(description: string): Hit[] {
  const patterns: {
    yearKind: YearKind
    re: RegExp
    build: (match: RegExpMatchArray) => { min: number | null; max: number | null }
    forceRequired?: boolean
  }[] = [
    {
      yearKind: "less_than",
      re: /less than\s+(\d+)\s*\+?\s*years?/i,
      build: (match) => ({ min: 0, max: Number(match[1]) }),
    },
    {
      yearKind: "up_to",
      re: /up to\s+(\d+)\s*\+?\s*years?/i,
      build: (match) => ({ min: 0, max: Number(match[1]) }),
    },
    {
      yearKind: "approx",
      re: /(?:approximately|approx\.?|about|around|roughly)\s+(\d+)\s*\+?\s*years?/i,
      build: (match) => ({ min: Number(match[1]), max: Number(match[1]) }),
    },
    {
      yearKind: "range",
      re: /(\d+)\s*(?:-|–|—|to)\s*(\d+)\s*\+?\s*years?/i,
      build: (match) => ({ min: Number(match[1]), max: Number(match[2]) }),
    },
    {
      yearKind: "plus",
      re: /(\d+)\s*\+\s*years?/i,
      build: (match) => ({ min: Number(match[1]), max: null }),
    },
    {
      yearKind: "exact",
      re: /(?:minimum|at least)\s+(\d+)\s*\+?\s*years?/i,
      build: (match) => ({ min: Number(match[1]), max: null }),
      forceRequired: true,
    },
    {
      yearKind: "exact",
      re: /(\d+)\s*years?/i,
      build: (match) => ({ min: Number(match[1]), max: Number(match[1]) }),
    },
  ]

  const hits: Hit[] = []
  let working = description

  while (working.trim().length > 0) {
    let best: {
      index: number
      match: RegExpMatchArray
      yearKind: YearKind
      build: (match: RegExpMatchArray) => { min: number | null; max: number | null }
      forceRequired?: boolean
    } | null = null

    for (const pattern of patterns) {
      const match = pattern.re.exec(working)
      if (!match || match.index === undefined) continue
      if (!best || match.index < best.index) {
        best = { index: match.index, match, yearKind: pattern.yearKind, build: pattern.build, forceRequired: pattern.forceRequired }
      }
    }

    if (!best) break

    const bounds = best.build(best.match)
    let qualifier = qualifierOf(sentenceAt(description, best.index))
    if (best.forceRequired && qualifier !== "preferred") qualifier = "required"

    hits.push({
      kind: "years",
      yearKind: best.yearKind,
      min: bounds.min,
      max: bounds.max,
      qualifier,
      raw: best.match[0],
      index: best.index,
    })

    working =
      working.slice(0, best.index) +
      " ".repeat(best.match[0].length) +
      working.slice(best.index + best.match[0].length)
  }

  return hits
}

function collectPhraseHits(description: string): Hit[] {
  const hits: Hit[] = []
  for (const phrase of PHRASES) {
    const match = phrase.re.exec(description)
    if (!match || match.index === undefined) continue
    const qualifier =
      phrase.phrase === "prof_preferred" || phrase.phrase === "some_preferred"
        ? "preferred"
        : qualifierOf(sentenceAt(description, match.index))
    hits.push({
      kind: "phrase",
      phrase: phrase.phrase,
      min: null,
      max: null,
      qualifier,
      raw: match[0],
      index: match.index,
    })
  }
  return hits
}

function isHardReject(hit: Hit): boolean {
  if (hit.kind === "phrase") {
    return LEVEL_PHRASES.has(hit.phrase!) && hit.qualifier !== "preferred"
  }
  if (hit.qualifier === "preferred") return false
  if (hit.yearKind === "approx" || hit.yearKind === "less_than" || hit.yearKind === "up_to") return false
  if (hit.yearKind === "range") {
    if (hit.min === 1 && hit.max === 2) return false
    if ((hit.min ?? 0) === 0) return false
    if ((hit.min ?? 0) <= 1 && (hit.max ?? 0) <= 1) return false
    return (hit.min ?? 0) >= 2
  }
  if (hit.yearKind === "plus") return (hit.min ?? 0) >= 2
  if (hit.yearKind === "exact") return (hit.min ?? 0) >= 2
  return false
}

function isStretch(hit: Hit): boolean {
  if (hit.kind === "phrase" && LEVEL_PHRASES.has(hit.phrase!) && hit.qualifier === "preferred") {
    return true
  }
  if (hit.yearKind === "range" && hit.min === 1 && hit.max === 2) return true
  if (hit.yearKind === "approx" && (hit.min ?? 0) >= 2) return true
  if (hit.qualifier === "preferred" && (hit.min ?? 0) >= 2) return true
  return false
}

function isExplicitEntry(hit: Hit): boolean {
  if (hit.kind === "phrase") {
    return ["no_experience", "new_grad", "internship", "prof_preferred", "some_preferred"].includes(
      hit.phrase ?? "",
    )
  }
  if (hit.yearKind === "range" && (hit.min ?? 0) === 0 && (hit.max ?? 99) <= 2 && !(hit.min === 1 && hit.max === 2)) {
    return true
  }
  if (hit.yearKind === "exact" && (hit.min ?? 99) <= 1) return true
  if (hit.yearKind === "plus" && (hit.min ?? 99) <= 1) return true
  if (hit.yearKind === "less_than" && (hit.max ?? 99) <= 2) return true
  if (hit.yearKind === "up_to" && (hit.max ?? 99) <= 2) return true
  if (hit.yearKind === "approx" && (hit.min ?? 99) <= 1) return true
  return false
}

function isSoftEntry(hit: Hit): boolean {
  return hit.kind === "phrase" && ["entry_level", "early_career", "junior"].includes(hit.phrase ?? "")
}

function labelFor(hit: Hit | null, bucket: ExperienceBucket): string {
  if (!hit) return "No stated experience requirement"
  if (hit.phrase === "no_experience") return "No experience required"
  if (hit.phrase === "new_grad") return "New graduate"
  if (hit.phrase === "internship") return "Internship experience accepted"
  if (hit.phrase === "prof_preferred") return "Experience preferred, not required"
  if (hit.phrase === "some_preferred") return "Some experience preferred"
  if (hit.phrase === "entry_level") return "Entry level"
  if (hit.phrase === "early_career") return "Early career"
  if (hit.phrase === "junior") return "Junior"
  if (hit.phrase === "senior_exp") {
    return hit.qualifier === "preferred" ? "Senior experience preferred" : "Senior experience required"
  }
  if (hit.phrase === "lead_exp") {
    return hit.qualifier === "preferred" ? "Lead-level experience preferred" : "Lead-level experience required"
  }
  if (hit.phrase === "staff_exp") {
    return hit.qualifier === "preferred" ? "Staff-level experience preferred" : "Staff-level experience required"
  }
  if (hit.phrase === "principal_exp") {
    return hit.qualifier === "preferred"
      ? "Principal-level experience preferred"
      : "Principal-level experience required"
  }

  if (bucket === "main") {
    if (hit.yearKind === "range" && hit.min === 0 && hit.max === 1) return "0–1 years"
    if (hit.yearKind === "range" && hit.min === 0 && hit.max === 2) return "0–2 years"
    if (hit.yearKind === "exact" && hit.min === 0) return "0 years"
    if (hit.yearKind === "exact" && hit.min === 1) return "1 year"
    if (hit.yearKind === "plus" && (hit.min ?? 0) <= 1) return `${hit.min}+ year`
    if (hit.yearKind === "less_than") return `Less than ${hit.max} years`
    if (hit.yearKind === "up_to") return `Up to ${hit.max} ${hit.max === 1 ? "year" : "years"}`
    if (hit.yearKind === "approx") return `Approximately ${hit.min} ${hit.min === 1 ? "year" : "years"}`
  }

  if (bucket === "stretch") {
    if (hit.yearKind === "range" && hit.min === 1 && hit.max === 2) {
      return hit.qualifier === "preferred" ? "1–2 years preferred" : "1–2 years of experience"
    }
    if (hit.yearKind === "approx") return `Approximately ${hit.min} years`
    if (hit.yearKind === "exact" && hit.qualifier === "preferred") return `${hit.min} years preferred`
    if (hit.yearKind === "plus" && hit.qualifier === "preferred") return `${hit.min}+ years preferred`
    if (hit.yearKind === "range" && hit.qualifier === "preferred" && hit.max != null) {
      return `${hit.min}–${hit.max} years preferred`
    }
  }

  if (hit.yearKind === "plus") return `${hit.min}+ years required`
  if (hit.yearKind === "range") return `${hit.min}–${hit.max} years required`
  if (/minimum|at least/i.test(hit.raw)) return `Minimum ${hit.min} years required`
  return `${hit.min} years required`
}

function modeOf(hits: Hit[]): ExperienceMode {
  const requiredLike = hits.some(
    (hit) => hit.qualifier === "required" || (hit.qualifier !== "preferred" && isHardReject(hit)),
  )
  const preferredLike = hits.some(
    (hit) =>
      hit.qualifier === "preferred" ||
      hit.phrase === "some_preferred" ||
      hit.phrase === "prof_preferred",
  )
  const statedBar = hits.some(
    (hit) =>
      hit.kind === "years" &&
      hit.qualifier !== "preferred" &&
      (isExplicitEntry(hit) || isStretch(hit) || isHardReject(hit)),
  )
  const req = requiredLike || (statedBar && !preferredLike)
  if (req && preferredLike) return "mixed"
  if (req) return "required"
  if (preferredLike) return "preferred"
  return "none"
}

function boundsFor(hit: Hit | null): { min: number | null; max: number | null } {
  if (!hit) return { min: null, max: null }
  if (hit.kind === "phrase") {
    if (
      hit.phrase &&
      ["no_experience", "new_grad", "internship", "entry_level", "early_career", "junior", "prof_preferred", "some_preferred"].includes(
        hit.phrase,
      )
    ) {
      return { min: 0, max: 1 }
    }
    return { min: null, max: null }
  }
  return { min: hit.min, max: hit.max }
}

export function parseExperience(input: {
  title?: string | null
  description?: string | null
}): ExperienceParse {
  // Title seniority is never a requirement. Only the posting body is read.
  void input.title
  const description = input.description ?? ""
  const hits = [...collectYearHits(description), ...collectPhraseHits(description)]

  let bucket: ExperienceBucket = "main"
  if (hits.some(isHardReject)) bucket = "reject"
  else if (hits.some(isStretch) && !hits.some(isExplicitEntry)) bucket = "stretch"

  const deciding =
    bucket === "reject"
      ? hits.filter(isHardReject).sort((a, b) => (b.min ?? 0) - (a.min ?? 0))[0] ?? null
      : bucket === "stretch"
        ? hits.find(isStretch) ?? null
        : hits.find((hit) => hit.kind === "years" && isExplicitEntry(hit)) ??
          hits.find(isExplicitEntry) ??
          hits.find(isSoftEntry) ??
          null

  const bounds = boundsFor(deciding)
  const label = labelFor(deciding, bucket)

  return {
    bucket,
    experienceMin: bounds.min,
    experienceMax: bounds.max,
    requiredOrPreferred: hits.length === 0 ? "none" : modeOf(hits),
    label,
    reason: deciding ? `${bucket}: ${deciding.raw}` : "no experience language in the posting",
  }
}
