import { describe, expect, it } from "vitest";
import { compareRows, valueForSort } from "@/lib/table";
import { formatEarningsGrowth, earningsGrowthClass } from "@/lib/format";
import type { SoxConstituent, SoxEarningsGrowth } from "@/types";

const narrowing: SoxEarningsGrowth = {
  yoy: null,
  state: "loss_narrowing",
  changeSignal: 0.5,
  current: -1,
  previous: -2,
  currentDate: "2026-06-30",
  previousDate: "2025-06-30",
  methodology: "absolute_prior_base_change_v1",
  reason: null
};

describe("earnings table presentation", () => {
  it("keeps a loss improvement separate from a conventional percentage", () => {
    expect(formatEarningsGrowth(null, narrowing)).toBe("적자축소");
    expect(earningsGrowthClass(null, narrowing)).toBe("positive");
    expect(formatEarningsGrowth(-0.5)).toBe("-50%");
    expect(earningsGrowthClass(-0.5)).toBe("negative");
    expect(formatEarningsGrowth(null)).toBe("-");
    expect(earningsGrowthClass(null)).toBe("");
  });

  it("leaves non-comparable EPS values last in both numeric sort directions", () => {
    const loss: SoxConstituent = {
      ticker: "LOSS",
      metrics: { quarterlyEpsYoY: null, quarterlyEpsGrowth: narrowing }
    };
    const profit: SoxConstituent = {
      ticker: "PROFIT",
      metrics: { quarterlyEpsYoY: 0.1 }
    };
    expect(valueForSort(loss, "quarterlyEpsYoY")).toBeNull();
    for (const direction of ["asc", "desc"] as const) {
      expect(
        [loss, profit].sort((left, right) =>
          compareRows(left, right, "quarterlyEpsYoY", direction)
        ).map((row) => row.ticker)
      ).toEqual(["PROFIT", "LOSS"]);
    }
  });
});
