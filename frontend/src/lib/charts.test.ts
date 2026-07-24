import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { barWidthPercent, layoutQuadrantRows } from "@/lib/charts";
import type { SoxAnalysis } from "@/types";

const analysis = JSON.parse(
  readFileSync(resolve(process.cwd(), "../data/sox-analysis.json"), "utf8")
) as SoxAnalysis;

describe("SOX chart geometry", () => {
  it("renders a true zero bar while the row button remains the hit target", () => {
    expect(barWidthPercent(0, 1)).toBe(0);
    expect(barWidthPercent(0.5, 1)).toBe(50);
  });

  it("keeps extreme and colliding quadrant points inside padded plot bounds", () => {
    const colliding = analysis.constituents.slice(0, 18).map((row) => ({
      ...row,
      scores: {
        ...row.scores,
        priceMomentum: 0,
        earningsMomentum: 1
      }
    }));
    const positioned = layoutQuadrantRows(colliding);
    expect(positioned).toHaveLength(18);
    positioned.forEach(({ left, top }) => {
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left).toBeLessThanOrEqual(100);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(top).toBeLessThanOrEqual(100);
    });
    expect(
      new Set(
        positioned.map(
          ({ left, top }) => `${left.toFixed(4)}:${top.toFixed(4)}`
        )
      ).size
    ).toBe(positioned.length);
    for (const plot of [
      { width: 212, height: 192, viewport: 320 },
      { width: 282, height: 192, viewport: 390 }
    ]) {
      const boxes = positioned.map(({ left, top }) => {
        const centerX = (left / 100) * plot.width;
        const centerY = (top / 100) * plot.height;
        return {
          left: centerX - 16,
          right: centerX + 16,
          top: centerY - 16,
          bottom: centerY + 16
        };
      });
      boxes.forEach((box, index) => {
        boxes.slice(index + 1).forEach((other) => {
          const overlaps =
            box.left < other.right &&
            box.right > other.left &&
            box.top < other.bottom &&
            box.bottom > other.top;
          expect(
            overlaps,
            `${plot.viewport}px viewport should not overlap points`
          ).toBe(false);
        });
      });
    }
  });
});
