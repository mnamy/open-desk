import { FEEDBACK_DIMENSIONS, JOB_FEATURES } from "@/lib/llm/schema"

const FEEDBACK_SYSTEM = [
  "Convert a job-search note into JSON.",
  "The note was typed by the person using this browser. Respond with JSON only.",
  "Use exactly two objects: positive_preferences and negative_preferences.",
  `Allowed keys: ${FEEDBACK_DIMENSIONS.join(", ")}.`,
  "Values are numbers from 0 to 1. Omit zeros and unused keys.",
  "positive_preferences are what they want more of. negative_preferences are what they want less of.",
].join(" ")

const JOB_SYSTEM = [
  "Score one job description as JSON.",
  "Return one object with every listed key set to a number from 0 to 1.",
  `Keys: ${JOB_FEATURES.join(", ")}.`,
  "0 means the description does not show that trait. 1 means it is central to the role.",
  "JSON only.",
].join(" ")

export function promptFor(kind: "feedback" | "job", text: string): { system: string; user: string } {
  if (kind === "feedback") return { system: FEEDBACK_SYSTEM, user: text.slice(0, 1000) }
  return { system: JOB_SYSTEM, user: text.slice(0, 3500) }
}
