import { describe, expect, it } from "vitest"
import { classifyWarning, summarizeWarnings } from "@/lib/sources/warnings"

describe("source warning summary", () => {
  it("groups stale, blocked, rate limited, and timeout warnings", () => {
    const warnings = [
      "ashby · Ramp: 404 Not Found",
      "greenhouse · Headspace: 404 Not Found",
      "ashby · Away: 403 Forbidden",
      "greenhouse · Alma: 429 Too Many Requests",
      "lever · Spotify: timed out",
    ]
    expect(classifyWarning(warnings[0])).toBe("stale")
    expect(classifyWarning(warnings[2])).toBe("blocked")
    expect(classifyWarning(warnings[3])).toBe("rate_limited")
    expect(classifyWarning(warnings[4])).toBe("timeout")
    const summary = summarizeWarnings(warnings)
    expect(summary.headline).toBe("5 sources could not be checked")
    expect(summary.groups).toEqual([
      { label: "Stale or removed", count: 2 },
      { label: "Temporarily blocked", count: 1 },
      { label: "Rate limited", count: 1 },
      { label: "Timed out", count: 1 },
    ])
  })
})
