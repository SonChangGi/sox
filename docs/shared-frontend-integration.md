# SOX shared frontend integration

## Decision

SOX remains a static GitHub Pages application. It has no public analysis
inputs. The existing Python collector/analyzer remains the only calculation
engine and continues to publish the existing `data/sox-analysis.json`,
`data/sox-history.json`, and `data/summary.json` contracts.

The TypeScript frontend does not add FastAPI, a run endpoint, or a browser-side
calculation. It presents or selects already published results:

| Control | Kind | Effect |
| --- | --- | --- |
| 저장 기준일 | `result_selector` | Selects an existing `dataAsOf` snapshot |
| 차트 강조 종목 | `display` | Coordinates the existing bar/quadrant marks, readout, and table row |
| 검색 | `display` | Filters saved constituent rows |
| 정렬 기준·방향 | `display` | Reorders saved constituent rows |
| 테마 | `display` | Changes presentation only |

Authenticated data refresh and Pages publication are separate owner
`operation` definitions. They are not exposed as public result controls.

## Independently buildable compatibility seam

The Hub packages are not published yet. `frontend/src/shared-platform/` is a
small pinned compatibility snapshot rather than a `file:` dependency or a
cross-origin runtime import:

- `contracts.ts` mirrors the shared control-kind and manifest surface.
- `control-manifest.ts` rejects public `analysis` and `operation` controls.
- `project-registry.ts` pins the canonical 9-project order (Hub, Fear & Greed,
  Momentum, DRAM, Best Factor, ETF, SOX, Regime, News), labels, URLs, and
  protected public summary identity mapping.
- `token-aliases.css` exposes the shared `--qr-*` semantic token names while
  retaining the approved SOX palette and component CSS.
- `static-result-adapter.ts` defines `sox-static-result/v1`.
- `platform-snapshot.json` records the shared version, upstream source hashes,
  per-file hashes, and aggregate fingerprint.

The frontend remains reproducible with only this repository and its lockfile.
It imports no JavaScript or CSS from another Pages origin.

## Static result and failure boundary

The loader tries complete same-origin data roots in order. A root is accepted
only after both required files load and the adapter verifies:

1. schema and SOX project identity;
2. valid generated time and `dataAsOf` values;
3. non-empty constituent rows and existing score labels;
4. exact `snapshotCount` agreement;
5. matching latest date and generated time across analysis and history;
6. a unique saved snapshot for every date.

Required files from different roots are never mixed. A malformed or
mixed-generation result is rejected and is never relabelled as the selected
date.

The adapter passes `analysis`, `history`, constituent arrays, and saved snapshot
objects through without recalculation, normalization, row cloning, or value
replacement. It creates only a separate sorted snapshot index for the date
selector.

New snapshots may include `metrics.quarterlyEpsGrowth` and
`metrics.quarterlyNetIncomeGrowth` with the collector's comparison state and
`absolute_prior_base_change_v1` signal. The EPS column displays the conventional
`quarterlyEpsYoY` percentage when available; otherwise it displays the saved
state, such as 흑자전환 or 적자축소. It never presents `changeSignal` as EPS YoY.
Numeric EPS sorting continues to place unavailable percentages last in either
direction, and state labels are searchable. Older snapshots without the new
fields retain their existing percentage or missing-value presentation. The
collapsed detail uses the selected snapshot's own earnings methodology text.

## Protected delivery boundary

This worktree keeps the current root static page and Pages workflow as the
rollback path. The independently built preview is produced under
`frontend/dist` with the same `/sox/` base URL and byte-identical copies of all
three public JSON files.

`.github/workflows/verify-frontend.yml` runs the full frontend verifier for
relevant pull requests, main-branch changes, and manual runs. This separate CI
job checks the additional frontend without changing the Pages artifact path or
the collector schedule.

Before changing the Pages artifact path in a release change:

1. run the existing root `npm test`;
2. run `npm ci --prefix frontend` and `npm run verify --prefix frontend`;
3. preview `frontend/dist` at desktop and 390 px in light and dark themes;
4. verify snapshot selection, coordinated ticker selection, search, every sort
   column, and the internally scrolling table;
5. confirm the Python, data JSON, schedule, refresh/commit behavior, and public
   `/sox/` and `/data/*.json` URLs remain unchanged.

## Snapshot sync procedure

For every intentional change to a pinned shared file, including navigation:

1. review the shared-file diff and update the navigation contract test when
   destinations, order, labels, or URLs change;
2. run `npm run sync:platform --prefix frontend` to update the local snapshot
   date, per-file hashes, and aggregate fingerprint;
3. review the resulting manifest diff and run
   `npm run verify --prefix frontend`;
4. commit the shared-file changes, tests, and manifest together.

`sync:platform` does not change the shared version or upstream source hashes.
Those fields describe the imported foundation, not the local file contents.
`snapshotDate` records the latest local hash sync date.
The ordinary verifier never updates the manifest and still fails on drift.

When the shared frontend packages publish a new version:

1. compare contracts, registry, and design tokens with the source hashes in
   `frontend/platform-snapshot.json`;
2. update only the compatible files under `frontend/src/shared-platform/`;
3. update the shared version and source hashes from the reviewed upstream
   version, then run `npm run sync:platform --prefix frontend`;
4. review the manifest diff and run `npm run verify --prefix frontend`;
5. repeat browser QA before release.
