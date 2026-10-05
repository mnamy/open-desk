import type { ExperienceParse } from "@/lib/jobs/experience"
import { isWrongProfession } from "@/lib/jobs/relevance"
import { inferRoleFamily } from "@/lib/jobs/role-family"
import { plainText } from "@/lib/jobs/text"

export type ExclusionReason =
  | "location"
  | "remote"
  | "experience"
  | "seniority"
  | "internship"
  | "engineering"
  | "sales"
  | "relevance"

export type LevelSignal = "entry" | "modest" | "high"
export type RoleTier = 0 | 1 | 2 | 3

export interface EligibilityTags {
  seniority: boolean
  engineering: boolean
  sales: boolean
  internship: boolean
}

export interface EligibilityDecision {
  feedBucket: "main" | "stretch" | "excluded"
  exclusionReason: ExclusionReason | null
  roleFamily: string
  tier: RoleTier
  levelSignal: LevelSignal
  tags: EligibilityTags
}

const ENTRY_TITLE =
  /\b(associates?|junior|jr\.?|early[- ]career|new grads?|new graduates?|recent grads?|entry[- ]level|\bapm\b|rotational|coordinator|analysts?|generalists?)\b/i

const EXPLICIT_ENTRY =
  /\b(new grads?|new graduates?|recent graduates?|recent college graduates?|entry[- ]level|early career|this is a junior|junior role|no experience required)\b/i

const EARLY_IC_TITLE =
  /\b((?:ux|user|design|product)\s+researchers?|(?:product|ux|ui)\s+designers?)\b/i

const SENIOR_SCOPE =
  /\b(people manager|direct reports|(?<!\b(?:not|no|without|never) )manage (?:a |the )?(?:team of|team\b|people|engineers|designers|researchers|managers)|(?<!\b(?:not|no|without|never) )managing (?:a |the )?team\b|lead (?:a |the |our )(?:team|organization|department|function)|build and lead|hire and (?:manage|develop)|manager of managers|\bp&l\b|budget ownership|revenue ownership|extensive experience|proven track record|seasoned|tenured)\b/i

const ABOVE_ENTRY =
  /\b(own the vision|set the vision|define the vision|company-wide|executive team|report to the (?:ceo|founder|executive)|lead the (?:product|function|organization)|extensive expertise|deep expertise)\b/i

const JUNIOR_IC =
  /\b(individual contributor|no direct reports|talk to users|talking to users|interview users|interview customers|write (?:the )?(?:feature|product) requirements|this is a junior role)\b/i

const ADJACENT_SIGNALS: RegExp[] = [
  /\btalk(?:ing)? to (?:users|customers|shoppers)\b/i,
  /\b(?:user|ux) research\b/i,
  /\bproduct development\b/i,
  /\bexperiment(?:s|ation)?\b/i,
  /\bprototyp/i,
  /\blaunch(?:ing)? (?:a |the )?(?:features|products|product)\b/i,
  /\banalytics\b/i,
  /\bcustomer experience\b/i,
  /\bcross-functional\b/i,
  /\b(?:product|design|engineering) team\b/i,
  /\b0\s*(?:→|to)\s*1\b/i,
]

const PEOPLE_LEADERSHIP =
  /\b(people manager|direct reports|(?<!\b(?:not|no|without|never) )manage (?:a |the )?(?:team of|team\b|people|engineers|designers|researchers|managers)|(?<!\b(?:not|no|without|never) )managing (?:a |the )?team\b|build and lead (?:a |the )?team|hire and (?:manage|develop)|manager of managers)\b/i

const DESIGN_CENTERED =
  /\b(user experience|\bux\b|user interface|interaction design|figma|creative technology|in the browser|front-end|frontend)\b/i
const PHYSICAL_ENGINEERING = /\b(mechanical|solidworks|autocad|\bcad\b|\bcnc\b|machining)\b/i

const TIER3_SIGNALS =
  /\b(user research|ux research|product strategy|product requirement|experiment|prototype|roadmap|cross-functional|product team|product decision|what to build|what the product)\b/i

const SALES_FUNNEL =
  /\b(quota-carrying|carry a quota|against a quota|sales quota|outbound prospecting|cold calls?|cold emails?|book \d+ outbound)\b/i

export function titleIsSenior(title: string): boolean {
  const text = title.toLowerCase()
  if (/\b(senior|sr\.?|staff|principal|director|vice president|vp|chief|leader)\b/.test(text)) return true
  if (/\bhead of\b/.test(text)) return true
  if (/\b(tech lead|team lead|design lead|engineering lead|engineering manager|general manager|senior manager|sr\.? manager|tech lead manager)\b/.test(text)) {
    return true
  }
  if (/\b(tech|team|design|engineering|technical|product) lead\b/.test(text)) return true
  if (/(^|[\s,/(])lead\b/.test(text)) return true
  if (/\blead$/.test(text.trim())) return true
  return false
}

export function isInternshipRole(title: string, description: string, employmentType?: string | null): boolean {
  if (employmentType && /\bintern/i.test(employmentType)) return true
  if (/\b(interns?|internships?|co-?ops?)\b/i.test(title)) return true
  if (/\bsummer (intern|internship|analyst|associate)\b/i.test(title)) return true
  const text = `${title}\n${description}`
  if (/\b(students? only|current students?|must be (?:currently )?enrolled|for enrolled students|returning to (?:school|campus|university)|university internship)\b/i.test(text)) {
    return true
  }
  const program = /\b(this (?:is|will be) an internship|internship program|summer internship)\b/i.test(description)
  const countsAsExperience = /\binternships? (?:are )?accepted as experience|internship experience/i.test(description)
  return program && !countsAsExperience
}

function peopleManager(title: string, description: string): boolean {
  const text = title.toLowerCase()
  if (/\b(engineering manager|general manager|senior manager|sr\.? manager|tech lead manager)\b/.test(text)) return true
  if (!/\bmanager\b/.test(text)) return false
  const individualContributor = /\b(product|program|programme|project)\b/.test(text)
  if (individualContributor && !PEOPLE_LEADERSHIP.test(description)) return false
  if (PEOPLE_LEADERSHIP.test(description)) return true
  const departmentManager = /^manager\b/.test(text.trim()) || /\bmanager,/.test(text)
  if (departmentManager && !/\b(individual contributor|no direct reports)\b/i.test(description)) return true
  return false
}

function designCentered(description: string): boolean {
  if (PHYSICAL_ENGINEERING.test(description) && !DESIGN_CENTERED.test(description)) return false
  if (DESIGN_CENTERED.test(description)) return true
  return /\b(prototype|prototyping)\b/i.test(description) && /\b(interface|browser|figma|design team|product experience)\b/i.test(description)
}

export function isEngineeringRole(title: string, description: string, family: string): boolean {
  const designTitle = family === "Design engineering" || /\b(design engineer|ux engineer|creative technologist|design technologist)\b/i.test(title)
  if (designTitle) return !designCentered(description)
  if (family === "Data science" || family === "Engineering") return true
  if (/\bengineering\b/i.test(title)) return true
  return /\b(software engineer|backend engineer|frontend engineer|full[\s-]?stack|ios engineer|android engineer|machine learning engineer|data engineer|devops|site reliability|\bsre\b|security engineer)\b/i.test(title)
}

export function isSalesRole(title: string, description: string, family: string): boolean {
  if (family === "Sales") return true
  if (/\b(account executive|sales development|business development representative|\bsdr\b|\bbdr\b|enterprise sales|sales representative)\b/i.test(title)) {
    return true
  }
  const text = `${title}\n${description}`
  if (SALES_FUNNEL.test(text)) return true
  if (/\bbusiness development\b/i.test(title)) {
    const strategy = /\b(partnership|product|strategy)\b/i.test(description)
    return !strategy
  }
  if (/^\s*sales\b/i.test(title)) return true
  return false
}

function hardNegative(title: string, description: string): boolean {
  if (/\b(physician|surgeon|registered nurse|\bnurse\b|therapist|clinician|pharmacist|dentist|medical assistant|clinical research|laboratory|wet lab)\b/i.test(title)) {
    return true
  }
  if (/\b(recruiter|recruiting|talent acquisition|\bsourcer\b)\b/i.test(title)) return true
  if (/\b(accountant|accounting|fp&a|financial analyst|controller|bookkeeper)\b/i.test(title)) return true
  if (/\b(counsel|attorney|lawyer|paralegal|\blegal\b)\b/i.test(title)) return true
  if (/\b(human resources|\bhr\b|people partner|people operations)\b/i.test(title)) return true
  if (/\b(supply chain|warehouse|merchant|merchandis)/i.test(title)) {
    return !/\b(product strategy|product management|user research)\b/i.test(description)
  }
  return false
}

function isSupportQueue(title: string, description: string): boolean {
  const supportTitle = /\b(customer (?:experience|support|service) (?:representative|agent|advisor|associate|specialist)|customer support|customer service)\b/i.test(title)
  if (!supportTitle) return false
  if (/\brepresentative\b/i.test(title)) return true
  const research = /\b(user research|ux research|research study|interview (?:users|customers|shoppers)|voice of (?:the )?customer)\b/i.test(description)
  const queue = /\b(live calls|support tickets?|\btickets?\b|customer support|call center|chat support|help desk|via email and chat)\b/i.test(description)
  return queue && !research
}

function notFullTime(title: string, description: string, employmentType?: string | null): boolean {
  if (employmentType && /\b(part[- ]time|contractor|contract|temporary|intern)\b/i.test(employmentType)) return true
  return /\b(part[- ]time (?:role|position)|contract (?:role|position)|temporary (?:role|position))\b/i.test(`${title}\n${description}`)
}

function pureAdmin(description: string): boolean {
  const admin = /\b(calendar management|scheduling meetings|status reports?)\b/i.test(description)
  const product = /\b(product|strategy|roadmap|user research|what to build)\b/i.test(description)
  return admin && !product
}

function partnershipDevelopment(title: string, description: string): boolean {
  return (
    /\bbusiness development\b/i.test(title) &&
    /\b(partnership|product|strategy)\b/i.test(description) &&
    !SALES_FUNNEL.test(`${title}\n${description}`)
  )
}

export function roleTier(family: string, title: string, description: string): RoleTier {
  const text = `${title}\n${description}`
  if (partnershipDevelopment(title, description) && family === "Other") return 2
  if (family === "Product") {
    if (/\bproduct analyst\b/i.test(title) && !/\b(product|experiment|roadmap|feature|user|shopper|customer)\b/i.test(description)) {
      return 0
    }
    return 1
  }
  if (family === "User research" || family === "Insights" || family === "Product design") return 1
  if (family === "Founder's office") {
    if (pureAdmin(description)) return 0
    if (/\b(product|strategy|roadmap|user|research|launch|what to build)\b/i.test(description)) return 1
    return 2
  }
  if (family === "Strategy & operations") {
    if (/\b(product|cross-functional|strategy|experiment|user|research)\b/i.test(text)) return 1
    return 3
  }
  if (family === "Innovation" || family === "Design engineering" || family === "Special projects") return 2
  if (family === "Growth") {
    return /\b(experiment|user research|activation|retention|product team|product strategy)\b/i.test(description) ? 2 : 3
  }
  if (family === "Customer experience") {
    return /\b(user research|experiment|voice of customer|product team|product issue|product feedback)\b/i.test(description) ? 2 : 3
  }
  if (family === "Consulting") {
    const digital = /\b(digital|product|\bux\b|user experience|technology|innovation)\b/i.test(text)
    return digital ? 2 : 0
  }
  if (family === "Program" || family === "Community" || family === "Implementation") return 3
  return 0
}

function stretchSignal(experience: ExperienceParse, ambiguous: boolean): LevelSignal {
  if (ambiguous) return "high"
  const high =
    (experience.experienceMin ?? 0) >= 3 ||
    /\b(senior experience|lead-level|staff-level|principal-level)\b/i.test(experience.label)
  return high ? "high" : "modest"
}

function entryLooking(title: string, description: string, experience: ExperienceParse): boolean {
  return experience.bucket === "main" || earlyIcTitle(title) || EXPLICIT_ENTRY.test(description)
}

function earlyIcTitle(title: string): boolean {
  return ENTRY_TITLE.test(title) || EARLY_IC_TITLE.test(title)
}

function adjacentCount(description: string): number {
  return ADJACENT_SIGNALS.reduce((count, pattern) => count + (pattern.test(description) ? 1 : 0), 0)
}

function earlyPreferred(experience: ExperienceParse): boolean {
  if (experience.bucket !== "stretch") return false
  if (experience.requiredOrPreferred !== "preferred" && experience.requiredOrPreferred !== "mixed") return false
  const min = experience.experienceMin
  const max = experience.experienceMax
  return (min === 1 && max === 2) || (min === 2 && max === 2)
}

export function assessEligibility(input: {
  title: string
  description: string
  employmentType?: string | null
  experience: ExperienceParse
}): EligibilityDecision {
  input = { ...input, description: plainText(input.description) }
  const originalFamily = inferRoleFamily(input.title, input.description)
  let family = originalFamily
  let tier = roleTier(family, input.title, input.description)
  const tags: EligibilityTags = {
    seniority: titleIsSenior(input.title) || peopleManager(input.title, input.description),
    engineering: isEngineeringRole(input.title, input.description, family),
    sales: isSalesRole(input.title, input.description, family),
    internship: isInternshipRole(input.title, input.description, input.employmentType),
  }

  const reject = (reason: ExclusionReason, levelSignal: LevelSignal = "high"): EligibilityDecision => ({
    feedBucket: "excluded",
    exclusionReason: reason,
    roleFamily: family,
    tier,
    levelSignal,
    tags,
  })

  if (tags.internship) return reject("internship")
  if (isSupportQueue(input.title, input.description)) return reject("relevance")
  if (tags.seniority) return reject("seniority")
  if (isWrongProfession(input.title, input.description)) return reject("relevance")
  if (tags.engineering) return reject("engineering")
  if (tags.sales) return reject("sales")
  if (hardNegative(input.title, input.description) || notFullTime(input.title, input.description, input.employmentType)) {
    return reject("relevance")
  }
  if (input.experience.bucket === "reject") return reject("experience")
  if (input.experience.bucket === "unknown" && SENIOR_SCOPE.test(input.description)) {
    tags.seniority = true
    return reject("seniority")
  }

  const signals = TIER3_SIGNALS.test(input.description)
  const adjacent = adjacentCount(input.description)
  if (tier === 0 && adjacent >= 3) {
    family = "Adjacent"
    tier = 2
  }
  if (tier === 0) return reject("relevance")
  if (tier === 3 && !signals) return reject("relevance")

  const base = {
    roleFamily: family,
    tier,
    tags,
    exclusionReason: null,
  }
  const above = ABOVE_ENTRY.test(input.description)
  const knownFamily = originalFamily !== "Other"
  const juniorScope = JUNIOR_IC.test(input.description) || EXPLICIT_ENTRY.test(input.description)

  if (earlyPreferred(input.experience)) {
    if (tier === 3 && !signals) return reject("relevance")
    return { ...base, feedBucket: "main", levelSignal: "modest" }
  }

  if (input.experience.bucket === "stretch") {
    const min = input.experience.experienceMin ?? 0
    const max = input.experience.experienceMax ?? min
    if (min >= 3 || (min >= 2 && max >= 5)) return reject("experience")
    if (tier === 3 && !entryLooking(input.title, input.description, input.experience) && !signals) return reject("relevance")
    return { ...base, feedBucket: "stretch", levelSignal: stretchSignal(input.experience, above) }
  }

  if (input.experience.bucket === "unknown") {
    const believable = !above && (earlyIcTitle(input.title) || (knownFamily && juniorScope))
    if (believable) return { ...base, feedBucket: "main", levelSignal: "entry" }
    return { ...base, feedBucket: "stretch", levelSignal: "high" }
  }

  return { ...base, feedBucket: "main", levelSignal: "entry" }
}
