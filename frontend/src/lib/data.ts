import {
  adaptSoxStaticResultV1,
  type AdaptedSoxStaticResult
} from "@/shared-platform";

type DataFile = "sox-analysis.json" | "sox-history.json";

const requiredFiles = [
  "sox-analysis.json",
  "sox-history.json"
] as const satisfies readonly DataFile[];

function candidateBaseUrls(): string[] {
  const viteBase = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  const candidates = [
    new URL(`${viteBase.replace(/^\//, "")}data/`, window.location.origin + "/"),
    new URL("data/", document.baseURI),
    new URL("../data/", document.baseURI)
  ];
  return [
    ...new Set(
      candidates
        .filter((url) => url.origin === window.location.origin)
        .map((url) => url.toString())
    )
  ];
}

async function fetchJson(
  baseUrl: string,
  filename: DataFile
): Promise<unknown> {
  const url = new URL(filename, baseUrl);
  if (url.origin !== window.location.origin) {
    throw new Error(`${filename} 경로가 same-origin이 아닙니다.`);
  }
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    method: "GET"
  });
  if (!response.ok) throw new Error(`${filename} HTTP ${response.status}`);
  return response.json();
}

async function loadAtBase(baseUrl: string): Promise<AdaptedSoxStaticResult> {
  const [analysis, history] = await Promise.all([
    fetchJson(baseUrl, requiredFiles[0]),
    fetchJson(baseUrl, requiredFiles[1])
  ]);
  return adaptSoxStaticResultV1({ analysis, history });
}

/**
 * Loads both required files from one same-origin root. It never mixes a
 * successful analysis file from one candidate with history from another.
 */
export async function loadSoxStaticResult(): Promise<AdaptedSoxStaticResult> {
  const failures: string[] = [];
  for (const baseUrl of candidateBaseUrls()) {
    try {
      return await loadAtBase(baseUrl);
    } catch (error) {
      failures.push(
        `${baseUrl}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  throw new Error(
    `SOX 정적 snapshot을 불러오지 못했습니다. ${failures.join(" | ")}`
  );
}

export function dataPathCandidates(filename: DataFile): string[] {
  return candidateBaseUrls().map((baseUrl) =>
    new URL(filename, baseUrl).toString()
  );
}
