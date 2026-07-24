import { clamp } from "@/lib/format";
import type { SoxConstituent } from "@/types";

export function barWidthPercent(value: number, maximum: number): number {
  if (value === 0) return 0;
  return (Math.abs(value) / Math.max(maximum, 0.00001)) * 100;
}

export function layoutQuadrantRows(rows: SoxConstituent[]) {
  const model = { width: 240, height: 190 };
  const minimumDistance = 38;
  const offsets = Array.from({ length: 11 }, (_, yIndex) =>
    Array.from({ length: 11 }, (_, xIndex) => ({
      x: (xIndex - 5) * minimumDistance,
      y: (yIndex - 5) * minimumDistance
    }))
  )
    .flat()
    .sort(
      (left, right) =>
        Math.hypot(left.x, left.y) - Math.hypot(right.x, right.y) ||
        left.y - right.y ||
        left.x - right.x
    );
  const occupied: Array<{ x: number; y: number }> = [];
  return rows.map((row) => {
    const baseX =
      clamp(row.scores!.priceMomentum as number, 0, 1) * model.width;
    const baseY =
      (1 - clamp(row.scores!.earningsMomentum as number, 0, 1)) *
      model.height;
    const position =
      offsets
        .map((offset) => ({
          x: clamp(baseX + offset.x, 0, model.width),
          y: clamp(baseY + offset.y, 0, model.height)
        }))
        .find((candidate) =>
          occupied.every(
            (point) =>
              Math.abs(candidate.x - point.x) >= minimumDistance ||
              Math.abs(candidate.y - point.y) >= minimumDistance
          )
        ) || { x: baseX, y: baseY };
    occupied.push(position);
    return {
      row,
      left: (position.x / model.width) * 100,
      top: (position.y / model.height) * 100
    };
  });
}
