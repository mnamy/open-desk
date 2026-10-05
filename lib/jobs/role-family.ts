import { plainText } from "@/lib/jobs/text"

const TITLE_RULES: { family: string; re: RegExp }[] = [
  {
    family: "Design engineering",
    re: /\b(design engineers?|design engineering|ux engineers?|creative technologists?|creative developers?|design technologists?)\b/i,
  },
  {
    family: "Sales",
    re: /\b(account executives?|sales engineers?|enterprise sales|sales representatives?|sales associates?|sales development(?:\s+representatives?)?|business development representatives?|\bsdr\b|\bbdr\b|sales operations|revenue operations|account managers?)\b/i,
  },
  {
    family: "Data science",
    re: /\b(data scientists?|data science|applied scientists?|research scientists?)\b/i,
  },
  {
    family: "Engineering",
    re: /\b(software engineers?|software developers?|backend engineers?|back-end engineers?|frontend engineers?|front-end engineers?|full[\s-]?stack(?:\s+engineers?)?|mobile engineers?|\bios engineers?|android engineers?|machine learning engineers?|ml engineers?|ai engineers?|ai\/ml(?:\s+engineers?)?|data engineers?|infrastructure engineers?|platform engineers?|devops|dev ops|site reliability|\bsre\b|security engineers?|engineering managers?|engineering directors?|\bengineering\b|tech leads?|technical leads?|\bswe\b|engineers?|developers?)\b/i,
  },
  {
    family: "Product design",
    re: /\b(product designers?|ux designers?|ui designers?|ui\/ux|ux\/ui|experience designers?|interaction designers?|design systems)\b/i,
  },
  {
    family: "User research",
    re: /\b(user researchers?|ux researchers?|design researchers?|user research|ux research|product researchers?|product research|research associates?|researchers?)\b/i,
  },
  {
    family: "Insights",
    re: /\b(consumer insights|user insights|customer insights|voice of customer)\b/i,
  },
  {
    family: "Product",
    re: /\b(product managers?|product management|associate product|product associates?|product operations|product ops|product strateg(?:y|ist)|product generalists?|product analysts?|product development|\bapm\b)\b/i,
  },
  {
    family: "Founder's office",
    re: /founder'?s(?:\s+office|\s+associate)?|chief of staff|founding associates?|startup generalists?/i,
  },
  {
    family: "Strategy & operations",
    re: /\b(strategy\s*(?:&|and)\s*operations|business operations|biz\s?ops|strategy associates?|strategists?|technology strategy|business analysts?)\b/i,
  },
  {
    family: "Innovation",
    re: /\b(innovation|new ventures|venture builders?|venture building|venture associates?)\b/i,
  },
  { family: "Growth", re: /\bgrowth\b/i },
  {
    family: "Customer experience",
    re: /\b(customer experience|customer success|customer operations)\b/i,
  },
  {
    family: "Program",
    re: /\b(program managers?|programme managers?|project managers?|project coordinators?|program management|project management|localization program)\b/i,
  },
  { family: "Consulting", re: /\b(consultants?|consulting)\b/i },
  { family: "Community", re: /\bcommunity\b/i },
  { family: "Implementation", re: /\bimplementations?\b/i },
  { family: "Special projects", re: /\b(special projects|strategic initiatives)\b/i },
]

const DESCRIPTION_RULES: { family: string; re: RegExp }[] = [
  { family: "Design engineering", re: /\b(design engineer|creative technologist|ux engineer)\b/i },
  {
    family: "Sales",
    re: /\b(account executive|sales development representative|business development representative)\b/i,
  },
  { family: "Data science", re: /\bdata scientist\b/i },
  {
    family: "Engineering",
    re: /\b(software engineer|backend engineer|frontend engineer|full stack engineer|machine learning engineer|data engineer|site reliability)\b/i,
  },
  { family: "Product design", re: /\b(product designer|ux designer|ui designer)\b/i },
  { family: "User research", re: /\b(user research|ux research)\b/i },
  { family: "Insights", re: /\b(consumer insights|user insights|customer insights)\b/i },
  {
    family: "Product",
    re: /\b(product manager|product operations|product strategy|associate product manager|product associate)\b/i,
  },
  { family: "Founder's office", re: /\bfounder'?s (?:associate|office)\b/i },
  {
    family: "Strategy & operations",
    re: /\b(business operations|strategy and operations|strategy & operations)\b/i,
  },
]

function matchFamily(text: string, rules: { family: string; re: RegExp }[]): string | null {
  for (const rule of rules) {
    if (rule.re.test(text)) return rule.family
  }
  return null
}

function genericTitle(title: string): boolean {
  const leftover = title
    .toLowerCase()
    .replace(
      /\b(associates?|junior|jr\.?|senior|sr\.?|lead|staff|principal|interns?|internships?|early career|new grads?|new graduates?|recent graduates?|university grads?|entry[- ]level|rotational|coordinators?|analysts?|specialists?|generalists?|managers?|full[- ]time|part[- ]time|nyc|new york|remote|hybrid|usa|us|ii|iii|iv)\b/g,
      " ",
    )
    .replace(/[^a-z]+/g, " ")
    .trim()
  return leftover.length === 0
}

export function inferRoleFamily(title: string, description = ""): string {
  return matchFamily(title, TITLE_RULES) ?? (genericTitle(title) ? matchFamily(plainText(description), DESCRIPTION_RULES) : null) ?? "Other"
}

export function sourceLabel(source: string): string {
  switch (source) {
    case "linkedin":
      return "LinkedIn"
    case "greenhouse":
      return "Greenhouse"
    case "ashby":
      return "Ashby"
    case "lever":
      return "Lever"
    case "yc":
      return "YC"
    case "career_page":
      return "Career page"
    case "wellfound":
      return "Wellfound"
    case "welcome_to_the_jungle":
      return "Welcome to the Jungle"
    default:
      return source
  }
}
