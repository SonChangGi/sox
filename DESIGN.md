# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-06-29
- Primary product surfaces:
  - SOX dashboard shell: `index.html`
  - Styling contract: `assets/styles.css`
  - Client rendering: `assets/app.js`
  - Independently buildable shared frontend: `frontend/`
  - Shared compatibility seam: `frontend/src/shared-platform/`
  - Generated data: `data/sox-analysis.json`, `data/summary.json`
  - Refresh script: `scripts/fetch_sox_data.py`
- Evidence reviewed:
  - Current repo was a fresh shell with `README.md` only.
  - Quant-dashboard family design source: `/Users/changgison/projects/quant-dashboard.omx-worktrees/launch-feat-quant-dashboard/DESIGN.md`.
  - Quant-dashboard UI patterns: hero/research cockpit/project cards/status chips in `index.html`, `assets/app.js`, `assets/styles.css`.
  - External source shape: Nasdaq Global Index Watch SOX overview/weighting pages, Yahoo Finance public chart and fundamentals-timeseries endpoints.

## Brand
- Personality:
  - Institutional semiconductor research cockpit: dark, calm, precise, audit-friendly.
  - Korean-first copy with finance terms kept concise and technical where useful.
- Trust signals:
  - Source provenance, generated timestamp, constituent date, freshness status, and data-quality caveats are visible in the page chrome.
  - Official constituent source is separated from computed/proxy metrics.
  - Momentum labels explain that scores are research signals, not recommendations.
- Avoid:
  - Pretending proxy market-cap weights are official SOX index weights.
  - Browser-side live finance scraping, hidden API keys, decorative chart noise, saturated SaaS gradients, or low-contrast dense tables.

## Product goals
- Goals:
  - Let the user scan all SOX constituents, proxy weights, price momentum, financial statement momentum, valuation/fundamental metrics, and source freshness in one page.
  - Provide multiple momentum lenses: 1M/3M/6M/12M returns, moving-average gaps, RSI, drawdown, revenue/EPS/net-income momentum, and composite ranks.
  - Fit the existing quant-dashboard family so the SOX page can be linked from the hub and can return to the hub.
  - Keep the deployment model static and reproducible: generated JSON committed under `data/`, no live client-side data dependency.
- Non-goals:
  - No trading strategy, backtest, portfolio optimizer, or investment advice.
  - No paid/login-only data dependency.
  - No browser-side analysis engine or public run-submission API.
- Success signals:
  - Local static page renders without console-breaking JS syntax.
  - Data generation succeeds using free public sources or records partial failures explicitly.
  - Verification catches missing source caveats, invalid JSON contracts, and broken navigation links.

## Personas and jobs
- Primary personas:
  - Individual quant/research operator comparing semiconductor breadth and leadership.
  - Portfolio reader checking which SOX names have price strength vs earnings support.
  - Future maintainer refreshing the generated data and adding the page to the hub.
- User jobs:
  - Identify top proxy-weight names and concentration.
  - Compare price momentum against earnings/fundamental momentum.
  - Find outliers: high price momentum with weak earnings, low drawdown resilience, or cheap/expensive PE context.
  - Move between the quant-dashboard hub and SOX page.
- Key contexts of use:
  - Desktop research first, but mobile/tablet must be readable with horizontally scrollable dense tables.
  - GitHub Pages static hosting with possible stale generated data.

## Information architecture
- Primary navigation:
  - Top navigation links back to `https://sonchanggi.github.io/quant-dashboard/` and source pages.
  - Hero actions jump to momentum, holdings table, and methodology sections.
- Core routes/screens:
  - Single static route: `index.html`.
  - Core sections: Hero/status, market pulse KPI cards, charts, momentum/fundamental quadrants, constituent table, methodology/caveats.
- Content hierarchy:
  - 1. SOX identity, source status, freshness, and caveats.
  - 2. Concentration and leadership summary.
  - 3. Momentum comparisons and visual ranking.
  - 4. Full sortable/filterable table.
  - 5. Methodology and source details.

## Design principles
- Principle 1: Research integrity before polish.
  - Every computed number should have visible source/proxy context.
- Principle 2: Compare first, inspect second.
  - Charts and ranking cards reveal leaders/laggards; table supports audit.
- Principle 3: Static Pages reliability.
  - All data is generated ahead of time and read as JSON in the browser.
- Principle 4: Quant-dashboard family coherence.
  - Use the shared dark neutral cockpit language, status chips, panels, dense tables, restrained semantic colors, and explicit freshness/degraded states.
- Tradeoffs:
  - A proxy-weight model is acceptable if official free weights are unavailable, but the UI must label it prominently.
  - Slightly larger table spacing is preferred over cramming every metric above the fold.

## Visual language
- Color:
  - Base graphite/ink gradient around `#080a0f`, `#0c111b`, `#131a26`.
  - Panels: `rgba(17,24,39,.86)` with muted borders.
  - Text: warm white primary, slate secondary, muted gray tertiary.
  - Semantic accents: cyan for price momentum, green for earnings momentum, amber for caution/stale, rose/red for weakness/errors, violet for concentration/valuation.
- Typography:
  - System sans stack with Korean-safe fallbacks; tabular numerals for financial tables.
- Spacing/layout rhythm:
  - 8px rhythm; large panels 20-28px padding; compact table cells with clear row separation.
- Shape/radius/elevation:
  - 18-28px major panels, pill chips, subtle shadows and inset borders.
- Motion:
  - Minimal hover/focus transitions; respect reduced motion.
- Imagery/iconography:
  - Text and chart-first. No image dependency.

## Components
- Existing components to reuse:
  - Quant-dashboard family hero, research cockpit panels, metric cards, status chips, project/hub links, dense comparison tables.
- New/changed components:
  - SOX-specific KPI strip: constituent count, top proxy weight, top momentum, data freshness.
  - SVG/CSS bar charts for proxy weights, price momentum, earnings momentum, and scatter/quadrant comparison.
  - Sort/filter constituent table with composite score pills.
- Variants and states:
  - Loading: dark skeleton panels with explicit “generated JSON loading” text.
  - Empty: neutral panel explaining missing generated data.
  - Error/degraded: amber/red chip plus source failure list.
  - Success: green/cyan status with timestamp.
  - Disabled: unavailable actions remain visible but muted.
- Token/component ownership:
  - This repo owns duplicated CSS tokens; no shared package dependency.

## Accessibility
- Target standard:
  - WCAG 2.1 AA-oriented contrast for text, controls, and chart labels.
- Keyboard/focus behavior:
  - Links/buttons/select/search input have visible focus rings.
- Contrast/readability:
  - Dense tables use sticky header, zebra/hover separation, tabular numerals, and high-contrast badges.
- Screen-reader semantics:
  - Use headings, `aria-live` for generated status, table captions, and labelled nav/controls.
- Reduced motion and sensory considerations:
  - Disable nonessential transitions under `prefers-reduced-motion`.

## Responsive behavior
- Supported breakpoints/devices:
  - Mobile, tablet, desktop research monitor.
- Layout adaptations:
  - Cards stack on mobile; chart grids collapse; tables scroll horizontally within a labelled container.
- Touch/hover differences:
  - Hover styles are additive; controls remain obvious on touch.

## Interaction states
- Loading:
  - Skeleton cards and table placeholders while `data/sox-analysis.json` loads.
- Empty:
  - Clear message with `python3 scripts/fetch_sox_data.py` refresh instruction.
- Error:
  - Show failed source list and retain methodology/caveats.
- Success:
  - Show generated timestamp, constituent date, and coverage counts.
- Disabled:
  - Sort/filter controls disabled only if data missing.
- Offline/slow network, if applicable:
  - Browser depends only on local JSON; stale generated data is labelled instead of live-refreshed.

## Content voice
- Tone:
  - Precise, restrained Korean research notes; no recommendation language.
- Terminology:
  - “proxy weight”, “price momentum”, “earnings momentum”, “coverage”, “degraded”, “freshness”, “research only”.
- Microcopy rules:
  - Use “관찰”, “비교”, “추정”, “프록시” for computed/proxy metrics.
  - Keep research-only disclaimer visible in hero/footer/methodology.

## Implementation constraints
- Framework/styling system:
  - Current Pages rollback: vanilla HTML/CSS/JS.
  - Independently buildable migration surface: strict TypeScript, React, Vite.
- Design-token constraints:
  - CSS variables in `assets/styles.css`; shared `--qr-*` names are aliases
    only and do not replace the approved SOX palette.
- Performance constraints:
  - Keep generated JSON and JS lightweight enough for GitHub Pages.
- Compatibility constraints:
  - Static file paths must work under both local server and GitHub Pages project path.
  - No browser-side secrets or live external calls.
  - No cross-repository `file:` dependency or cross-origin runtime CSS/JS import.
- Test/screenshot expectations:
  - Verify generated JSON schema, syntax, static smoke, and key UI copy/caveats.

## Open questions
- [ ] Public deployment target/remote for `sox` is not configured in this worktree; owner: maintainer; impact: live Pages readback cannot be completed until remote/pages target exists.
