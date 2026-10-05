import { describe, expect, it } from "vitest"
import { parseExperience } from "@/lib/jobs/experience"

function parsed(description: string, title = "Product Manager") {
  return parseExperience({ title, description })
}

describe("experience required vs preferred", () => {
  it.each([
    ["0 years of experience.", "main", "0 years"],
    ["0-1 years of experience.", "main", "0–1 years"],
    ["0–1 years of experience.", "main", "0–1 years"],
    ["1 year of experience.", "main", "1 year"],
    ["1+ year of experience.", "main", "1+ year"],
    ["Up to 1 year of experience.", "main", "Up to 1 year"],
    ["Less than 2 years of experience.", "main", "Less than 2 years"],
    ["New grad.", "main", "New graduate"],
    ["New graduate role.", "main", "New graduate"],
    ["Recent graduate.", "main", "New graduate"],
    ["Recent college graduate.", "main", "New graduate"],
    ["Entry level role.", "main", "Entry level"],
    ["Early career.", "main", "Early career"],
    ["This is a junior role.", "main", "Junior"],
    ["No experience required.", "main", "No experience required"],
    ["Internships accepted as experience.", "main", "Internship experience accepted"],
    ["Internship experience is welcome.", "main", "Internship experience accepted"],
    ["Professional experience preferred but not required.", "main", "Experience preferred, not required"],
    ["Some experience preferred.", "main", "Some experience preferred"],
    ["", "unknown", "No stated experience requirement"],
  ])("main feed: %s", (description, bucket, label) => {
    const result = parsed(description)
    expect(result.bucket).toBe(bucket)
    expect(result.label).toBe(label)
  })

  it("still reads an explicit entry bar when the title is senior", () => {
    const result = parsed("New graduate role. 0–1 years of experience.", "Senior Product Manager")
    expect(result.bucket).toBe("main")
    expect(result.label).toBe("0–1 years")
  })

  it("reads a year requirement that appears only in the title", () => {
    const result = parsed("Build the roadmap with the team.", "Product Manager, 5+ years required")
    expect(result.bucket).toBe("reject")
    expect(result.label).toBe("5+ years required")
  })

  it("keeps an explicit 0–1 requirement in the main feed when more years are only preferred", () => {
    const result = parsed("0-1 years required. 2 years preferred.")
    expect(result.bucket).toBe("main")
    expect(result.requiredOrPreferred).toBe("mixed")
  })

  it("treats a new-grad bar as main even if 2 years are preferred", () => {
    const result = parsed("New graduates welcome. 2 years preferred.")
    expect(result.bucket).toBe("main")
  })

  it.each([
    ["1-2 years preferred.", "stretch", "1–2 years preferred"],
    ["1–2 years preferred.", "stretch", "1–2 years preferred"],
    ["2 years preferred.", "stretch", "2 years preferred"],
    ["Approximately 2 years of experience.", "stretch", "Approximately 2 years"],
    ["About 2 years of experience.", "stretch", "Approximately 2 years"],
    ["1-2 years of experience.", "stretch", "1–2 years of experience"],
    ["1–2 years of experience.", "stretch", "1–2 years of experience"],
    ["2+ years preferred.", "stretch", "2+ years preferred"],
    ["3+ years preferred.", "stretch", "3+ years preferred"],
    ["Senior experience preferred.", "stretch", "Senior experience preferred"],
  ])("stretch: %s", (description, bucket, label) => {
    const result = parsed(description)
    expect(result.bucket).toBe(bucket)
    expect(result.label).toBe(label)
  })

  it("does not let a soft entry-level label override 1–2 years of experience", () => {
    const result = parsed("Entry level. 1–2 years of experience.")
    expect(result.bucket).toBe("stretch")
  })

  it.each([
    ["2+ years of experience.", "reject", "2+ years required"],
    ["Minimum 2 years of experience.", "reject", "Minimum 2 years required"],
    ["At least 2 years of experience.", "reject", "Minimum 2 years required"],
    ["2-3 years of experience.", "reject", "2–3 years required"],
    ["2–3 years of experience.", "reject", "2–3 years required"],
    ["3+ years of experience.", "reject", "3+ years required"],
    ["3+ years of experience required.", "reject", "3+ years required"],
    ["4+ years.", "reject", "4+ years required"],
    ["5+ years of experience required.", "reject", "5+ years required"],
    ["Senior experience required.", "reject", "Senior experience required"],
    ["Lead-level experience.", "reject", "Lead-level experience required"],
    ["Staff-level experience.", "reject", "Staff-level experience required"],
    ["Principal-level experience.", "reject", "Principal-level experience required"],
  ])("reject: %s", (description, bucket, label) => {
    const result = parsed(description)
    expect(result.bucket).toBe(bucket)
    expect(result.label).toBe(label)
  })

  it("rejects a junior title when the body requires 5+ years", () => {
    const result = parsed("5+ years of experience required.", "Junior Coordinator")
    expect(result.bucket).toBe("reject")
  })

  it("marks preferred and required differently", () => {
    expect(parsed("2 years preferred.").requiredOrPreferred).toBe("preferred")
    expect(parsed("3+ years of experience required.").requiredOrPreferred).toBe("required")
    expect(parsed("2+ years preferred.").bucket).toBe("stretch")
    expect(parsed("2+ years of experience.").bucket).toBe("reject")
  })
})
