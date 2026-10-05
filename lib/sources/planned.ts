import type { SourceAdapter } from "@/lib/sources/types"

/** LinkedIn stays planned. Milestone 2 fetches the other sources on Run search. */
export const PLANNED_SOURCES: SourceAdapter[] = [
  { id: "sample-import", phase: 1, label: "Local sample import" },
  { id: "greenhouse", phase: 2, label: "Greenhouse" },
  { id: "ashby", phase: 2, label: "Ashby" },
  { id: "lever", phase: 2, label: "Lever" },
  { id: "yc", phase: 2, label: "YC Work at a Startup" },
  { id: "wellfound", phase: 2, label: "Wellfound" },
  { id: "welcome_to_the_jungle", phase: 2, label: "Welcome to the Jungle" },
  { id: "generic-career-page", phase: 3, label: "Generic career page" },
  { id: "linkedin", phase: 4, label: "LinkedIn" },
]

export const PLANNED_ATS = [
  "greenhouse",
  "ashby",
  "lever",
  "smartrecruiters",
  "workable",
  "workday",
  "bamboohr",
  "jobvite",
  "breezy",
  "pinpoint",
  "teamtailor",
  "recruitee",
  "comeet",
  "rippling",
  "genericCareerPage",
] as const
