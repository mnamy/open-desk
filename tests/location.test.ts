import { describe, expect, it } from "vitest"
import { normalizeCity } from "@/lib/jobs/location"

describe("normalizeCity", () => {
  it.each([
    ["New York", "New York City"],
    ["new york city", "New York City"],
    ["NYC", "New York City"],
    ["New York, NY", "New York City"],
    ["New York NY", "New York City"],
    ["Manhattan", "New York City"],
    ["Brooklyn, NY", "New York City"],
    ["Queens", "New York City"],
    ["Hybrid — Brooklyn", "New York City"],
    ["Chicago", "Chicago"],
    ["Chicago, IL", "Chicago"],
    ["Boston, MA", "Boston"],
    ["Boston, Massachusetts", "Boston"],
    ["Miami, FL", "Miami"],
    ["Miami Beach", "Miami"],
    ["Austin, TX", "Austin"],
    ["austin, texas", "Austin"],
  ])("keeps %s as %s", (raw, city) => {
    expect(normalizeCity(raw)).toBe(city)
  })

  it.each([
    "San Francisco, CA",
    "Seattle, WA",
    "Remote",
    "Remote — United States",
    "United States",
    "Cambridge, MA",
    "London, UK",
    "Denver, CO",
    "West New York, NJ",
    "",
  ])("rejects %s", (raw) => {
    expect(normalizeCity(raw)).toBeNull()
  })

  it("uses the first allowed city when a posting lists two", () => {
    expect(normalizeCity("Austin, TX or New York, NY")).toBe("Austin")
  })
})
