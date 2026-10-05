import { describe, expect, it } from "vitest"
import { parseWorkArrangement } from "@/lib/jobs/work-arrangement"

describe("parseWorkArrangement", () => {
  it("keeps hybrid and on-site", () => {
    expect(parseWorkArrangement({ arrangementRaw: "Hybrid", locationRaw: "New York, NY" })).toBe("hybrid")
    expect(parseWorkArrangement({ arrangementRaw: "Hybrid in NYC" })).toBe("hybrid")
    expect(parseWorkArrangement({ arrangementRaw: "On-site" })).toBe("onsite")
    expect(parseWorkArrangement({ arrangementRaw: "In person" })).toBe("onsite")
  })

  it("rejects remote-only phrasing", () => {
    expect(parseWorkArrangement({ arrangementRaw: "Work from anywhere", locationRaw: "New York, NY" })).toBe("remote")
    expect(parseWorkArrangement({ arrangementRaw: "Fully remote" })).toBe("remote")
    expect(parseWorkArrangement({ arrangementRaw: "Fully distributed" })).toBe("remote")
    expect(parseWorkArrangement({ arrangementRaw: "Remote-only" })).toBe("remote")
  })

  it("keeps an unclear arrangement when the posting never says", () => {
    expect(
      parseWorkArrangement({
        locationRaw: "Chicago, IL",
        description: "Review the work with the product team each week at the Chicago office.",
      }),
    ).toBe("unclear")
  })
})
