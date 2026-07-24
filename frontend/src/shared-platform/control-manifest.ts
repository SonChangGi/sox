import type { SoxViewState } from "@/types";
import {
  assertStaticDisplayOnlyManifest,
  type ControlManifest,
  type OperationControlDefinition
} from "./contracts";

export const soxControlManifest = {
  schemaVersion: 1,
  projectId: "sox",
  inputSchemaVersion: "sox-display/v1",
  configHashAlgorithm: "not-applicable-static-snapshot",
  controls: [
    {
      id: "snapshot_date",
      label: "저장 기준일",
      controlKind: "result_selector",
      valueType: "string",
      defaultValue: "",
      defaultSource: "current-result",
      resultIdentityKey: "analysis.dataAsOf"
    },
    {
      id: "selected_ticker",
      label: "차트 강조 종목",
      controlKind: "display",
      valueType: "string",
      defaultValue: "",
      defaultSource: "current-result"
    },
    {
      id: "search_query",
      label: "구성종목 검색",
      controlKind: "display",
      valueType: "string",
      defaultValue: "",
      defaultSource: "html-constant"
    },
    {
      id: "sort_key",
      label: "표 정렬 기준",
      controlKind: "display",
      valueType: "string",
      defaultValue: "rank",
      defaultSource: "html-constant"
    },
    {
      id: "sort_direction",
      label: "표 정렬 방향",
      controlKind: "display",
      valueType: "string",
      defaultValue: "asc",
      defaultSource: "html-constant",
      options: [
        { value: "asc", label: "오름차순" },
        { value: "desc", label: "내림차순" }
      ]
    },
    {
      id: "theme",
      label: "화면 테마",
      controlKind: "display",
      valueType: "string",
      defaultValue: "light",
      defaultSource: "saved-setting",
      options: [
        { value: "light", label: "라이트" },
        { value: "dark", label: "다크" }
      ]
    }
  ]
} as const satisfies ControlManifest;

export const soxOwnerOperations = [
  {
    id: "refresh_snapshot",
    label: "SOX 데이터 수집·분석",
    controlKind: "operation",
    valueType: "boolean",
    defaultValue: false,
    defaultSource: "html-constant",
    operationKey: "github-actions/deploy-pages:refresh",
    requiresAuthentication: true
  },
  {
    id: "publish_pages",
    label: "검증 결과 Pages 공개",
    controlKind: "operation",
    valueType: "boolean",
    defaultValue: false,
    defaultSource: "html-constant",
    operationKey: "github-actions/deploy-pages:publish",
    requiresAuthentication: true
  }
] as const satisfies readonly OperationControlDefinition[];

const controlIds = new Set<string>(
  soxControlManifest.controls.map((control) => control.id)
);

export function assertDisplayStatePatch(
  patch: Partial<SoxViewState>
): void {
  const keys: Record<keyof SoxViewState, string> = {
    snapshotDate: "snapshot_date",
    selectedTicker: "selected_ticker",
    searchQuery: "search_query",
    sortKey: "sort_key",
    sortDirection: "sort_direction",
    theme: "theme"
  };
  for (const key of Object.keys(patch) as Array<keyof SoxViewState>) {
    if (!controlIds.has(keys[key])) {
      throw new Error(`SOX view state is not registered: ${String(key)}`);
    }
  }
}

assertStaticDisplayOnlyManifest(soxControlManifest);
