import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  adaptSoxStaticResultV1,
  assertDisplayStatePatch,
  canonicalProjectRegistry,
  getCanonicalNavigation,
  soxControlManifest,
  soxOwnerOperations,
  SOX_STATIC_RESULT_CONTRACT,
  type ControlManifest
} from "@/shared-platform";

function repositoryJson(filename: string): unknown {
  return JSON.parse(readFileSync(resolve(process.cwd(), "../data", filename), "utf8"));
}

describe("shared platform SOX seam", () => {
  it("registers every public result-affecting control without analysis or operation controls", () => {
    expect(
      new Set(
        soxControlManifest.controls.map((control) => control.controlKind)
      )
    ).toEqual(new Set(["display", "result_selector"]));
    const compatibilityManifest: ControlManifest = soxControlManifest;
    expect(
      compatibilityManifest.controls.filter(
        (control) =>
          control.controlKind === "analysis" ||
          control.controlKind === "operation"
      )
    ).toEqual([]);
    expect(soxOwnerOperations).toHaveLength(2);
    expect(
      soxOwnerOperations.every(
        (operation) =>
          operation.controlKind === "operation" &&
          operation.requiresAuthentication
      )
    ).toBe(true);
  });

  it("keeps all six display/result-selector state keys outside run creation", () => {
    expect(() =>
      assertDisplayStatePatch({
        snapshotDate: "2026-07-22",
        selectedTicker: "NVDA",
        searchQuery: "semi",
        sortKey: "priceMomentum",
        sortDirection: "desc",
        theme: "dark"
      })
    ).not.toThrow();
    expect(soxControlManifest.configHashAlgorithm).toBe(
      "not-applicable-static-snapshot"
    );
    expect(
      soxControlManifest.controls.some(
        (control) => "transportKey" in control
      )
    ).toBe(false);
  });

  it("keeps the canonical 11-project order and SOX public identity", () => {
    expect(canonicalProjectRegistry).toHaveLength(11);
    expect(canonicalProjectRegistry.map((project) => project.id)).toEqual([
      "hub",
      "fear-greed",
      "momentum",
      "dram",
      "best-factor",
      "etf",
      "sox",
      "risk-score",
      "port",
      "valuation",
      "kelly"
    ]);
    expect(
      getCanonicalNavigation("sox").filter((project) => project.current)
    ).toEqual([
      expect.objectContaining({
        id: "sox",
        url: "https://sonchanggi.github.io/sox/"
      })
    ]);
  });

  it("adapts repository result rows without cloning, sorting, or replacing them", () => {
    const analysis = repositoryJson("sox-analysis.json");
    const history = repositoryJson("sox-history.json");
    const historyDatesBefore = (
      history as { snapshots: Array<{ dataAsOf: string }> }
    ).snapshots.map((snapshot) => snapshot.dataAsOf);
    const adapted = adaptSoxStaticResultV1({ analysis, history });

    expect(adapted.analysis).toBe(analysis);
    expect(adapted.history).toBe(history);
    expect(adapted.analysis.constituents).toBe(
      (analysis as { constituents: unknown[] }).constituents
    );
    expect(adapted.history.snapshots).toBe(
      (history as { snapshots: unknown[] }).snapshots
    );
    expect(
      adapted.history.snapshots.map((snapshot) => snapshot.dataAsOf)
    ).toEqual(historyDatesBefore);
    expect(adapted.identity).toMatchObject({
      projectId: "sox",
      publicSummaryProjectId: "sox",
      contractVersion: SOX_STATIC_RESULT_CONTRACT,
      dataAsOf: "2026-07-23",
      snapshotCount: historyDatesBefore.length
    });
  });

  it("fails closed when analysis and history do not share the latest identity", () => {
    const analysis = repositoryJson("sox-analysis.json");
    const history = repositoryJson("sox-history.json") as {
      generatedAt: string;
      latestDataAsOf: string;
    };
    const mismatched = {
      ...history,
      latestDataAsOf: "2026-07-22"
    };
    expect(() =>
      adaptSoxStaticResultV1({ analysis, history: mismatched })
    ).toThrow("identity가 다릅니다");
  });
});
