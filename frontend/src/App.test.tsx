import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "@/App";

const analysis = JSON.parse(
  readFileSync(resolve(process.cwd(), "../data/sox-analysis.json"), "utf8")
);
const history = JSON.parse(
  readFileSync(resolve(process.cwd(), "../data/sox-history.json"), "utf8")
);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

function installFetch(analysisPayload = analysis, historyPayload = history) {
  const fetchMock = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () =>
        String(input).endsWith("sox-analysis.json")
          ? analysisPayload
          : historyPayload,
      init
    })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("SOX dashboard", () => {
  it("previews a ticker, restores the pin, and pins only on activation", async () => {
    const fetchMock = installFetch();
    render(<App />);
    expect(
      await screen.findByRole("heading", {
        name: "SOX 반도체 리서치"
      })
    ).toBeInTheDocument();
    const hero = screen
      .getByRole("heading", { name: "SOX 반도체 리서치" })
      .closest(".hero")!;
    expect(hero.querySelector(".hero-copy")).toBeNull();
    expect(
      document.querySelectorAll(".section-heading > p:not(.eyebrow)")
    ).toHaveLength(0);
    expect(document.querySelector(".ops-details summary small")).toBeNull();

    const nvdaChartButton = screen
      .getAllByRole("button")
      .find((button) => /^NVDA /.test(button.getAttribute("aria-label") || ""));
    expect(nvdaChartButton).toBeDefined();
    fireEvent.pointerEnter(nvdaChartButton!);

    await waitFor(() =>
      expect(
        screen.getByText("NVIDIA", {
          selector: ".chart-readout strong span"
        })
      ).toBeInTheDocument()
    );
    const nvdaTableButton = screen.getByRole("button", { name: "NVDA" });
    expect(nvdaTableButton).toHaveAttribute("aria-pressed", "false");
    expect(nvdaTableButton.closest("tr")).toHaveClass("is-selected");

    fireEvent.pointerLeave(nvdaChartButton!);
    await waitFor(() =>
      expect(
        screen.getByText("Micron Technology", {
          selector: ".chart-readout strong span"
        })
      ).toBeInTheDocument()
    );
    expect(nvdaTableButton.closest("tr")).not.toHaveClass("is-selected");

    fireEvent.click(nvdaChartButton!);
    expect(nvdaTableButton).toHaveAttribute("aria-pressed", "true");
    expect(nvdaTableButton.closest("tr")).toHaveClass("is-selected");
    expect(fetchMock.mock.calls.every((call) => call[1]?.method === "GET")).toBe(
      true
    );
  });

  it("pins a focused chart point with Enter and restores it after preview leaves", async () => {
    installFetch();
    render(<App />);
    await screen.findByRole("heading", { name: "SOX 반도체 리서치" });
    const buttons = screen.getAllByRole("button");
    const nvda = buttons.find((button) =>
      /^NVDA /.test(button.getAttribute("aria-label") || "")
    )!;
    fireEvent.focus(nvda);
    fireEvent.keyDown(nvda, { key: "Enter" });
    fireEvent.blur(nvda);
    expect(screen.getByRole("button", { name: "NVDA" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("searches and sorts existing rows without submitting an analysis", async () => {
    const fetchMock = installFetch();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "SOX 반도체 리서치" });

    const search = screen.getByRole("searchbox", { name: "검색" });
    await user.type(search, "Micron");
    const body = screen
      .getByRole("table", { name: /SOX 구성종목/ })
      .querySelector("tbody");
    expect(body?.querySelectorAll("tr")).toHaveLength(1);
    expect(body).toHaveTextContent("MU");

    await user.selectOptions(
      screen.getByLabelText("정렬"),
      "priceMomentum"
    );
    await user.selectOptions(
      screen.getByLabelText("정렬 방향"),
      "desc"
    );
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes("/runs")
      )
    ).toBe(false);
  });

  it("selects a published snapshot without creating a run", async () => {
    const fetchMock = installFetch();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "SOX 반도체 리서치" });
    const selector = screen.getByLabelText("저장 기준일 선택");
    await user.selectOptions(selector, "2026-07-22");
    expect(selector).toHaveValue("2026-07-22");
    expect(window.location.search).toBe("?date=2026-07-22");
    expect(
      fetchMock.mock.calls.every((call) => call[1]?.method === "GET")
    ).toBe(true);
    const selectedSnapshot = history.snapshots.find(
      (snapshot: typeof analysis) => snapshot.dataAsOf === "2026-07-22"
    )!;
    const metricCards = Array.from(document.querySelectorAll(".metric-card"));
    expect(metricCards[0]).toHaveTextContent(
      String(selectedSnapshot.index.constituentCount)
    );
    expect(
      document.querySelector("#constituent-table tbody")
    ).toHaveTextContent(selectedSnapshot.constituents[0].ticker);
    expect(document.querySelector(".ops-details")).toHaveTextContent(
      "2026-07-22"
    );
  });

  it("shows searchable earnings states and the selected snapshot methodology", async () => {
    const revised = structuredClone(analysis);
    // Keep this search fixture independent of newly collected turnaround rows.
    for (const row of revised.constituents) {
      delete row.metrics.quarterlyEpsGrowth;
    }
    const nvda = revised.constituents.find(
      (row: { ticker: string }) => row.ticker === "NVDA"
    );
    nvda.metrics.quarterlyEpsYoY = null;
    nvda.metrics.quarterlyEpsGrowth = {
      yoy: null,
      state: "turnaround",
      changeSignal: 3,
      current: 2,
      previous: -1,
      currentDate: "2026-06-30",
      previousDate: "2025-06-30",
      methodology: "absolute_prior_base_change_v1",
      reason: null
    };
    revised.methodology.earningsMomentum = "선택된 새 실적 모멘텀 정의";
    revised.methodology.earningsGrowth = "비양수 기저 EPS는 상태로 표시합니다.";
    installFetch(revised);
    render(<App />);
    await screen.findByRole("heading", { name: "SOX 반도체 리서치" });

    const nvdaRow = screen.getByRole("button", { name: "NVDA" }).closest("tr")!;
    expect(nvdaRow.cells[9]).toHaveTextContent(/^흑자전환$/);
    expect(nvdaRow.cells[9]).toHaveClass("positive");
    const details = document.querySelector(".ops-details")!;
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent(revised.methodology.earningsMomentum);
    expect(details).toHaveTextContent(revised.methodology.earningsGrowth);

    const user = userEvent.setup();
    await user.type(screen.getByRole("searchbox", { name: "검색" }), "흑자전환");
    expect(document.querySelectorAll("#constituent-table tbody tr")).toHaveLength(1);
    expect(document.querySelector("#constituent-table tbody")).toHaveTextContent("NVDA");

    await user.selectOptions(screen.getByLabelText("저장 기준일 선택"), "2026-07-22");
    const historical = history.snapshots.find(
      (snapshot: { dataAsOf: string }) => snapshot.dataAsOf === "2026-07-22"
    );
    expect(details).toHaveTextContent(historical.methodology.earningsMomentum);
    expect(details).not.toHaveTextContent(revised.methodology.earningsGrowth);
  });
});
