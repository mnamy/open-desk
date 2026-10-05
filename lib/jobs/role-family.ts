const TITLE_RULES: { family: string; re: RegExp }[] = [
  { family: "Design engineering", re: /design engineer|creative technologist|ux engineer|creative developer|design technologist/i },
  { family: "Product design", re: /product designer|ux designer|ui\/ux|experience designer|interaction designer/i },
  { family: "User research", re: /user research|ux research|user researcher|research associate|research analyst|insights/i },
  { family: "Analytics", re: /product analyst|analytics|business analyst|data analyst/i },
  { family: "Founder's office", re: /founder'?s|founder associate|chief of staff|generalist/i },
  { family: "Innovation", re: /innovation|new ventures|venture associate|venture builder/i },
  { family: "Growth", re: /\bgrowth\b|lifecycle|community associate|retention/i },
  { family: "Customer experience", re: /customer experience|customer success|\bcx\b|voice of customer/i },
  {
    family: "Product",
    re: /product strategy|product operations|product ops|product manager|\bapm\b|associate product|product associate|product management/i,
  },
  { family: "Strategy & operations", re: /strategy|operations|bizops|business operations/i },
  { family: "Program", re: /\bprogram\b|project coordinator|project manager/i },
  { family: "Consulting", re: /consultant|strategist/i },
]

export function inferRoleFamily(title: string, description = ""): string {
  for (const rule of TITLE_RULES) {
    if (rule.re.test(title)) return rule.family
  }
  for (const rule of TITLE_RULES) {
    if (rule.re.test(description)) return rule.family
  }
  return "Other"
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
    default:
      return source
  }
}
