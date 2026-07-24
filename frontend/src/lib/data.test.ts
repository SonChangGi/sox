import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadSoxStaticResult } from "@/lib/data";

const analysis = JSON.parse(
  readFileSync(resolve(process.cwd(), "../data/sox-analysis.json"), "utf8")
);
const history = JSON.parse(
  readFileSync(resolve(process.cwd(), "../data/sox-history.json"), "utf8")
);

afterEach(() => vi.unstubAllGlobals());

function payloadFor(url: string) {
  return url.endsWith("sox-analysis.json") ? analysis : history;
}

describe("SOX static data loader", () => {
  it("uses same-origin no-store GETs and has no run submission path", async () => {
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => ({
        ok: true,
        status: 200,
        json: async () => payloadFor(String(input)),
        requestInit: init
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await loadSoxStaticResult();
    expect(result.analysis.constituents).toHaveLength(30);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      fetchMock.mock.calls.every((call) => call[1]?.method === "GET")
    ).toBe(true);
    expect(
      fetchMock.mock.calls.every((call) => call[1]?.cache === "no-store")
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes("/runs")
      )
    ).toBe(false);
    expect(
      fetchMock.mock.calls.every(
        ([input]) => new URL(String(input)).origin === window.location.origin
      )
    ).toBe(true);
  });

  it("never mixes required files from different candidate roots", async () => {
    const base = document.createElement("base");
    base.href = "/sox/";
    document.head.append(base);
    let firstRoot = "";
    const fetchMock = vi.fn(
      async (input: string | URL | Request) => {
        const url = new URL(String(input));
        const root = url.toString().replace(/[^/]+$/, "");
        if (!firstRoot) firstRoot = root;
        if (
          root === firstRoot &&
          url.pathname.endsWith("sox-history.json")
        ) {
          return {
            ok: false,
            status: 503,
            json: async () => ({})
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => payloadFor(url.toString())
        };
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const result = await loadSoxStaticResult();
      expect(result.identity.projectId).toBe("sox");
      const calls = fetchMock.mock.calls.map(([input]) => String(input));
      const successfulAnalysis = calls
        .filter((url) => url.endsWith("sox-analysis.json"))
        .at(-1)!;
      const successfulRoot = successfulAnalysis.replace(
        /sox-analysis\.json$/,
        ""
      );
      expect(calls).toContain(`${successfulRoot}sox-history.json`);
      expect(successfulRoot).not.toBe(firstRoot);
    } finally {
      base.remove();
    }
  });

  it("rejects a mixed-generation snapshot instead of showing it as new", async () => {
    const mismatch = {
      ...history,
      generatedAt: "2026-07-24T00:00:00Z"
    };
    const fetchMock = vi.fn(
      async (input: string | URL | Request) => ({
        ok: true,
        status: 200,
        json: async () =>
          String(input).endsWith("sox-analysis.json")
            ? analysis
            : mismatch
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadSoxStaticResult()).rejects.toThrow(
      "identity가 다릅니다"
    );
  });
});
