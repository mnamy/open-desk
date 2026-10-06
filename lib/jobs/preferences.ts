import { titleIsSenior } from "@/lib/jobs/eligibility"
import { inferRoleFamily } from "@/lib/jobs/role-family"
import { LEGACY_REASON } from "@/lib/jobs/reasons"
import { normalizeCompanyName, plainText } from "@/lib/jobs/text"

/** One feature can move a role by at most this many fit points. */
export const FEATURE_CAP = 4
/** A single role family cannot crowd out the other explicit target families. */
export const ROLE_FAMILY_CAP = 1.5
/** The whole learned adjustment stays inside this band. */
export const TOTAL_CAP = 10
/** Card copy appears once the learned shift is large enough to matter. */
export const NOTE_THRESHOLD = 1.5
/** Labels in the preference section appear once a feature has moved this far. */
export const DISPLAY_THRESHOLD = 0.5

const APPLIED_EVENT_CAP = 3
const SAVED_EVENT_CAP = 1.4
const REJECT_EVENT_CAP = 2.2
const SAVED_SCALE = 0.45

const APPLIED_STEPS = {
  role: 0.8,
  title: 0.3,
  industry: 0.55,
  company: 0.2,
  stage: 0.55,
  exposure: 0.45,
} as const

const REJECT_STEPS = {
  dimension: 1.15,
  company: 1.25,
  responsibilities: 1.15,
  seniority: 0.7,
  arrangement: 0.8,
  city: 0.5,
  compensation: 0.6,
  other: 0.35,
  title: 0.35,
} as const

const STARTUP = /early-stage|early stage|\bseed\b|series a|founding|startup|small team/i
const ESTABLISHED = /enterprise|series [c-e]\b|public company|\bfortune\b|large company|larger company/i
const COMPENSATION = /salary|compensation|\bote\b|\$\s?\d|pay range|base pay/i

const INDUSTRIES: { slug: string; label: string; up: string; down: string; re: RegExp }[] = [
  { slug: "music", label: "Music", up: "music roles", down: "music industry roles", re: /\bmusic\b/i },
  { slug: "mental-health", label: "Mental health", up: "mental health roles", down: "mental health roles", re: /mental health|therapy|behavioral health/i },
  { slug: "education", label: "Education", up: "education roles", down: "education industry roles", re: /\bedtech\b|education technology|\blearning\b/i },
  { slug: "fashion", label: "Fashion", up: "fashion roles", down: "fashion industry roles", re: /\bfashion\b|\bbeauty\b|\bapparel\b/i },
  { slug: "fitness", label: "Fitness", up: "fitness roles", down: "fitness industry roles", re: /\bfitness\b|\bwellness\b/i },
  { slug: "fintech", label: "Fintech", up: "fintech roles", down: "fintech roles", re: /\bfintech\b|\bpayments\b|\bbanking\b/i },
  { slug: "entertainment", label: "Entertainment", up: "entertainment roles", down: "entertainment industry roles", re: /\bentertainment\b|\bfilm\b|\bstreaming\b/i },
  { slug: "social", label: "Social products", up: "social product roles", down: "social product roles", re: /social product|consumer social/i },
  { slug: "consumer", label: "Consumer products", up: "consumer product roles", down: "consumer product roles", re: /\bconsumer\b/i },
  { slug: "health", label: "Health technology", up: "health technology roles", down: "health technology roles", re: /health tech|healthtech|digital health/i },
]

const TITLE_CONCEPTS: { id: string; label: string; up: string; down: string; re: RegExp }[] = [
  { id: "product-strategy", label: "Product strategy", up: "product strategy roles", down: "product strategy roles", re: /product strateg/i },
  { id: "product-management", label: "Product management", up: "product management roles", down: "product management roles", re: /product manag|associate product|\bapm\b/i },
  { id: "founders-office", label: "Founder's office", up: "founder's office roles", down: "founder's office roles", re: /founder'?s(?:\s+office)?|chief of staff|founding associate/i },
  { id: "user-research", label: "User research", up: "user research roles", down: "user research roles", re: /user research|ux research|design research|product research/i },
  { id: "product-design", label: "Product design", up: "product design roles", down: "product design roles", re: /product design|ux design|ui design|interaction design/i },
  { id: "implementation", label: "Enterprise implementation", up: "implementation roles", down: "enterprise implementation", re: /implement/i },
  { id: "operations", label: "Operations", up: "operations roles", down: "operations roles", re: /operations|\bbiz\s?ops\b/i },
  { id: "growth", label: "Growth", up: "growth roles", down: "growth roles", re: /\bgrowth\b/i },
  { id: "marketing", label: "Marketing", up: "marketing roles", down: "marketing roles", re: /\bmarketing\b/i },
  { id: "customer", label: "Customer-facing work", up: "customer-facing roles", down: "customer-facing roles", re: /customer experience|customer success/i },
  { id: "strategy", label: "Strategy", up: "strategy roles", down: "strategy roles", re: /\bstrateg/i },
]

interface ExposureDef {
  id: string
  label: string
  up: string
  down: string
  strong: RegExp
  mild: RegExp
}

const EXPOSURES: ExposureDef[] = [
  {
    id: "product",
    label: "Product work",
    up: "product roles",
    down: "product responsibilities",
    strong: /product strategy|roadmap|what to build|product requirement|product decision/i,
    mild: /\bproduct\b/i,
  },
  {
    id: "research",
    label: "User research",
    up: "user research roles",
    down: "user research responsibilities",
    strong: /user research|ux research|usability|interview users|interview customers/i,
    mild: /\bresearch\b|\binsights\b/i,
  },
  {
    id: "design",
    label: "Design work",
    up: "design roles",
    down: "design-heavy responsibilities",
    strong: /product design|interaction design|prototype|figma/i,
    mild: /\bdesign\b/i,
  },
  {
    id: "strategy",
    label: "Product strategy",
    up: "product strategy roles",
    down: "strategy responsibilities",
    strong: /product strategy|corporate strategy/i,
    mild: /\bstrategy\b/i,
  },
  {
    id: "operations",
    label: "Operations work",
    up: "operations roles",
    down: "operations-heavy responsibilities",
    strong: /business operations|bizops|process improvement|calendar management|\badmin\b/i,
    mild: /\boperations\b/i,
  },
  {
    id: "technical",
    label: "Highly technical roles",
    up: "technical roles",
    down: "highly technical responsibilities",
    strong: /software engineer|machine learning|distributed systems|write code|programming|algorithms/i,
    mild: /\bapis?\b|\bsql\b|technical specification|\bdebug\b|data pipeline/i,
  },
  {
    id: "sales",
    label: "Sales-heavy work",
    up: "sales roles",
    down: "sales-heavy responsibilities",
    strong: /quota|cold call|outbound|sales development|\bsdr\b/i,
    mild: /\bsales\b|\bpipeline\b/i,
  },
  {
    id: "marketing",
    label: "Marketing-heavy work",
    up: "marketing roles",
    down: "marketing-heavy responsibilities",
    strong: /demand generation|brand campaign|performance marketing|product marketing/i,
    mild: /\bmarketing\b|social media|content calendar/i,
  },
  {
    id: "ownership",
    label: "0→1 ownership",
    up: "0→1 roles",
    down: "ownership-heavy responsibilities",
    strong: /0\s*(?:→|to)\s*1|zero to one|end to end|own the/i,
    mild: /\bownership\b|\bfounding\b/i,
  },
  {
    id: "customer",
    label: "Customer-facing work",
    up: "customer-facing roles",
    down: "customer-facing responsibilities",
    strong: /talk to (?:customers|users)|customer-facing|user-facing|customer interviews/i,
    mild: /voice of (?:the )?customer|customer success/i,
  },
]

const FIXED: Record<string, { label: string; up: string; down: string }> = {
  "exposure:technical": { label: "Highly technical roles", up: "technical roles", down: "highly technical responsibilities" },
  "exposure:sales": { label: "Sales-heavy work", up: "sales roles", down: "sales-heavy responsibilities" },
  "exposure:marketing": { label: "Marketing-heavy work", up: "marketing roles", down: "marketing-heavy responsibilities" },
  "exposure:operations": { label: "Operations work", up: "operations roles", down: "operations-heavy responsibilities" },
  "seniority:senior": { label: "Senior titles", up: "senior roles", down: "senior titles" },
  "topic:compensation": { label: "Compensation-focused roles", up: "compensation-focused roles", down: "compensation" },
}

export interface FeatureInput {
  id: string
  title: string
  companyName: string
  industry: string | null
  description: string
  roleFamily: string | null
  workArrangement: string
  city: string | null
}

export interface LearningEvent {
  jobId: string
  action: string
  createdAt: Date
  reasons: string[]
}

export interface SignalFeature {
  key: string
  intensity: number
  group: "role" | "title" | "industry" | "company" | "stage" | "exposure" | "seniority" | "arrangement" | "city" | "topic"
  label: string
  upPhrase: string
  downPhrase: string
}

interface Addition {
  key: string
  amount: number
  label: string
  upPhrase: string
  downPhrase: string
  source: "applied" | "saved" | "rejected"
}

interface Bucket {
  key: string
  weight: number
  label: string
  upPhrase: string
  downPhrase: string
  applied: number
  saved: number
  rejected: number
}

export interface PreferenceProfile {
  features: Bucket[]
}

export interface PreferenceSummary {
  boosting: string[]
  rankingDown: string[]
}

export interface RankAdjustment {
  delta: number
  note: string | null
  rankScore: number
}

function clamp(value: number, cap: number): number {
  return Math.max(-cap, Math.min(cap, value))
}

function intensity(text: string, strong: RegExp, mild: RegExp): number {
  if (strong.test(text)) return 1
  if (mild.test(text)) return 0.6
  return 0
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}

export function extractFeatures(job: FeatureInput): SignalFeature[] {
  const text = plainText(`${job.title}\n${job.industry ?? ""}\n${job.description}`)
  const features: SignalFeature[] = []
  const family = job.roleFamily || inferRoleFamily(job.title, job.description)
  if (family && family !== "Other") {
    const phrase = `${family.toLowerCase()} roles`
    features.push({
      key: `role:${family}`,
      intensity: 1,
      group: "role",
      label: family,
      upPhrase: phrase,
      downPhrase: phrase,
    })
  }

  const concepts: SignalFeature[] = []
  for (const concept of TITLE_CONCEPTS) {
    if (!concept.re.test(job.title)) continue
    if (concept.id === "strategy" && concepts.some((item) => item.key === "title:product-strategy")) continue
    concepts.push({
      key: `title:${concept.id}`,
      intensity: 1,
      group: "title",
      label: concept.label,
      upPhrase: concept.up,
      downPhrase: concept.down,
    })
    if (concepts.length >= 2) break
  }
  features.push(...concepts)

  const industryText = `${job.industry ?? ""} ${job.description}`
  const seenIndustry = new Set<string>()
  for (const industry of INDUSTRIES) {
    if (!industry.re.test(industryText)) continue
    const key = `industry:${industry.slug}`
    if (seenIndustry.has(key)) continue
    seenIndustry.add(key)
    features.push({
      key,
      intensity: 1,
      group: "industry",
      label: industry.label,
      upPhrase: industry.up,
      downPhrase: industry.down,
    })
    if (seenIndustry.size >= 2) break
  }
  if (seenIndustry.size === 0 && job.industry?.trim()) {
    const label = job.industry.trim()
    features.push({
      key: `industry:${slug(label)}`,
      intensity: 1,
      group: "industry",
      label,
      upPhrase: `${label.toLowerCase()} roles`,
      downPhrase: `${label.toLowerCase()} roles`,
    })
  }

  if (job.companyName.trim()) {
    features.push({
      key: `company:${normalizeCompanyName(job.companyName)}`,
      intensity: 1,
      group: "company",
      label: job.companyName.trim(),
      upPhrase: `${job.companyName.trim()} roles`,
      downPhrase: job.companyName.trim(),
    })
  }

  if (STARTUP.test(text)) {
    features.push({
      key: "stage:early",
      intensity: 1,
      group: "stage",
      label: "Early-stage teams",
      upPhrase: "early-stage roles",
      downPhrase: "early-stage teams",
    })
  } else if (ESTABLISHED.test(text)) {
    features.push({
      key: "stage:established",
      intensity: 1,
      group: "stage",
      label: "Larger companies",
      upPhrase: "larger-company roles",
      downPhrase: "larger companies",
    })
  }

  for (const exposure of EXPOSURES) {
    const level = intensity(text, exposure.strong, exposure.mild)
    if (level <= 0) continue
    features.push({
      key: `exposure:${exposure.id}`,
      intensity: level,
      group: "exposure",
      label: exposure.label,
      upPhrase: exposure.up,
      downPhrase: exposure.down,
    })
  }

  if (titleIsSenior(job.title)) {
    features.push({
      key: "seniority:senior",
      intensity: 1,
      group: "seniority",
      label: "Senior titles",
      upPhrase: "senior roles",
      downPhrase: "senior titles",
    })
  }

  if (job.workArrangement && job.workArrangement !== "unclear") {
    const label = job.workArrangement === "onsite" ? "on-site" : job.workArrangement
    features.push({
      key: `arrangement:${job.workArrangement}`,
      intensity: 1,
      group: "arrangement",
      label: `${label} work`,
      upPhrase: `${label} roles`,
      downPhrase: `${label} work`,
    })
  }

  if (job.city) {
    features.push({
      key: `city:${job.city.toLowerCase()}`,
      intensity: 1,
      group: "city",
      label: job.city,
      upPhrase: `${job.city} roles`,
      downPhrase: job.city,
    })
  }

  if (COMPENSATION.test(text)) {
    features.push({
      key: "topic:compensation",
      intensity: 1,
      group: "topic",
      label: "Compensation-focused roles",
      upPhrase: "compensation-focused roles",
      downPhrase: "compensation",
    })
  }

  return features
}

function fromFeature(feature: SignalFeature, amount: number, source: Addition["source"]): Addition {
  return {
    key: feature.key,
    amount,
    label: feature.label,
    upPhrase: feature.upPhrase,
    downPhrase: feature.downPhrase,
    source,
  }
}

function fixedAddition(key: string, amount: number): Addition {
  const meta = FIXED[key]
  return {
    key,
    amount,
    label: meta.label,
    upPhrase: meta.up,
    downPhrase: meta.down,
    source: "rejected",
  }
}

function scale(additions: Addition[], cap: number): Addition[] {
  const total = additions.reduce((sum, item) => sum + Math.abs(item.amount), 0)
  if (total <= cap || total === 0) return additions
  const factor = cap / total
  return additions.map((item) => ({ ...item, amount: item.amount * factor }))
}

function positiveAdditions(features: SignalFeature[], source: "applied" | "saved"): Addition[] {
  const scaleBy = source === "saved" ? SAVED_SCALE : 1
  const additions: Addition[] = []
  const role = features.find((feature) => feature.group === "role")
  if (role) additions.push(fromFeature(role, APPLIED_STEPS.role * scaleBy, source))
  for (const feature of features.filter((item) => item.group === "title")) {
    additions.push(fromFeature(feature, APPLIED_STEPS.title * scaleBy, source))
  }
  for (const feature of features.filter((item) => item.group === "industry")) {
    additions.push(fromFeature(feature, APPLIED_STEPS.industry * scaleBy, source))
  }
  const company = features.find((feature) => feature.group === "company")
  if (company) additions.push(fromFeature(company, APPLIED_STEPS.company * scaleBy, source))
  const stage = features.find((feature) => feature.group === "stage")
  if (stage) additions.push(fromFeature(stage, APPLIED_STEPS.stage * scaleBy, source))
  const exposures = features
    .filter((feature) => feature.group === "exposure" && feature.intensity >= 0.55)
    .sort((a, b) => b.intensity - a.intensity)
    .slice(0, 3)
  for (const feature of exposures) {
    additions.push(fromFeature(feature, APPLIED_STEPS.exposure * scaleBy, source))
  }
  return scale(additions, source === "saved" ? SAVED_EVENT_CAP : APPLIED_EVENT_CAP)
}

function rejectionAdditions(features: SignalFeature[], reasons: string[]): Addition[] {
  const learnable = reasons.filter((reason) => reason !== LEGACY_REASON)
  if (learnable.length === 0) return []
  const additions: Addition[] = []
  const role = features.find((feature) => feature.group === "role")
  const titles = features.filter((feature) => feature.group === "title")
  const industry = features.find((feature) => feature.group === "industry")
  const company = features.find((feature) => feature.group === "company")
  const arrangement = features.find((feature) => feature.group === "arrangement")
  const city = features.find((feature) => feature.group === "city")

  for (const reason of learnable) {
    if (reason === "too_technical") additions.push(fixedAddition("exposure:technical", -REJECT_STEPS.dimension))
    else if (reason === "too_sales") additions.push(fixedAddition("exposure:sales", -REJECT_STEPS.dimension))
    else if (reason === "too_marketing") additions.push(fixedAddition("exposure:marketing", -REJECT_STEPS.dimension))
    else if (reason === "too_operations") additions.push(fixedAddition("exposure:operations", -REJECT_STEPS.dimension))
    else if (reason === "wrong_function") {
      if (role) additions.push(fromFeature(role, -REJECT_STEPS.dimension, "rejected"))
      for (const feature of titles) additions.push(fromFeature(feature, -REJECT_STEPS.title, "rejected"))
    } else if (reason === "industry") {
      if (industry) additions.push(fromFeature(industry, -REJECT_STEPS.dimension, "rejected"))
    } else if (reason === "company") {
      if (company) additions.push(fromFeature(company, -REJECT_STEPS.company, "rejected"))
    } else if (reason === "responsibilities") {
      const hits = features.filter((feature) => feature.group === "exposure" && feature.intensity >= 0.45)
      if (hits.length > 0) {
        const each = REJECT_STEPS.responsibilities / hits.length
        for (const feature of hits) additions.push(fromFeature(feature, -each, "rejected"))
      }
    } else if (reason === "too_senior") {
      additions.push(fixedAddition("seniority:senior", -REJECT_STEPS.seniority))
    } else if (reason === "location") {
      if (arrangement) additions.push(fromFeature(arrangement, -REJECT_STEPS.arrangement, "rejected"))
      if (city) additions.push(fromFeature(city, -REJECT_STEPS.city, "rejected"))
    } else if (reason === "compensation") {
      additions.push(fixedAddition("topic:compensation", -REJECT_STEPS.compensation))
    } else if (reason === "other") {
      if (role) additions.push(fromFeature(role, -REJECT_STEPS.other, "rejected"))
      else if (titles[0]) additions.push(fromFeature(titles[0], -REJECT_STEPS.other, "rejected"))
    }
  }
  return scale(additions, REJECT_EVENT_CAP)
}

function additionsFor(job: FeatureInput, event: LearningEvent): Addition[] {
  const features = extractFeatures(job)
  if (event.action === "applied") return positiveAdditions(features, "applied")
  if (event.action === "save") return positiveAdditions(features, "saved")
  if (event.action === "not_interested") return rejectionAdditions(features, event.reasons)
  return []
}

export function buildProfile(jobs: FeatureInput[], events: LearningEvent[], resetAt: Date | null = null): PreferenceProfile {
  const byId = new Map(jobs.map((job) => [job.id, job]))
  const buckets = new Map<string, Bucket>()
  const ordered = [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  for (const event of ordered) {
    if (resetAt && event.createdAt.getTime() <= resetAt.getTime()) continue
    const job = byId.get(event.jobId)
    if (!job) continue
    for (const addition of additionsFor(job, event)) {
      const current = buckets.get(addition.key) ?? {
        key: addition.key,
        weight: 0,
        label: addition.label,
        upPhrase: addition.upPhrase,
        downPhrase: addition.downPhrase,
        applied: 0,
        saved: 0,
        rejected: 0,
      }
      current.weight += addition.amount
      current[addition.source] += Math.abs(addition.amount)
      buckets.set(addition.key, current)
    }
  }
  for (const bucket of buckets.values()) {
    if (bucket.key.startsWith("role:") && bucket.weight > ROLE_FAMILY_CAP) bucket.weight = ROLE_FAMILY_CAP
    else bucket.weight = clamp(bucket.weight, FEATURE_CAP)
  }
  return { features: [...buckets.values()] }
}

export function featureWeight(profile: PreferenceProfile, key: string): number {
  return profile.features.find((feature) => feature.key === key)?.weight ?? 0
}

export function summarizeProfile(profile: PreferenceProfile): PreferenceSummary {
  const ranked = [...profile.features].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight) || a.label.localeCompare(b.label))
  const boosting: string[] = []
  const rankingDown: string[] = []
  for (const feature of ranked) {
    if (feature.weight >= DISPLAY_THRESHOLD && boosting.length < 8 && !boosting.includes(feature.label)) {
      boosting.push(feature.label)
    }
    if (feature.weight <= -DISPLAY_THRESHOLD && rankingDown.length < 8 && !rankingDown.includes(feature.label)) {
      rankingDown.push(feature.label)
    }
  }
  return { boosting, rankingDown }
}

export function adjustRanking(job: FeatureInput, profile: PreferenceProfile, baseFit: number): RankAdjustment {
  const weights = new Map(profile.features.map((feature) => [feature.key, feature]))
  const parts: { contribution: number; bucket: Bucket }[] = []
  for (const feature of extractFeatures(job)) {
    const bucket = weights.get(feature.key)
    if (!bucket) continue
    const contribution = bucket.weight * feature.intensity
    if (contribution === 0) continue
    parts.push({ contribution, bucket })
  }
  const raw = parts.reduce((sum, part) => sum + part.contribution, 0)
  const delta = clamp(raw, TOTAL_CAP)
  const strongest = [...parts].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))[0]
  let note: string | null = null
  if (strongest && Math.abs(delta) >= NOTE_THRESHOLD) {
    if (strongest.contribution > 0) {
      const verb = strongest.bucket.applied >= strongest.bucket.saved ? "applied to" : "saved"
      note = `Ranked higher because you've ${verb} similar ${strongest.bucket.upPhrase}.`
    } else {
      note = `Ranked lower because you often reject ${strongest.bucket.downPhrase}.`
    }
  }
  return {
    delta,
    note,
    rankScore: baseFit + delta,
  }
}
