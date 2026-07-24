import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const readText = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const checks = [];
function check(condition, message) {
  checks.push({ ok: Boolean(condition), message });
  if (!condition) console.error(`FAIL ${message}`);
}

const analysis = readJson('data/sox-analysis.json');
const history = readJson('data/sox-history.json');
const summary = readJson('data/summary.json');
const html = readText('index.html');
const app = readText('assets/app.js');
const css = readText('assets/styles.css');
const workflow = readText('.github/workflows/deploy-pages.yml');
const freshnessScript = readText('scripts/check_sox_freshness.py');

check(analysis.schemaVersion === 1, 'analysis schemaVersion is 1');
check(analysis.projectId === 'sox', 'analysis projectId is sox');
check(Array.isArray(analysis.constituents), 'analysis constituents is array');
check(analysis.constituents.length >= 25, 'analysis has at least 25 SOX constituents');
check(analysis.index?.weightMethodLabel?.toLowerCase().includes('proxy') || analysis.index?.weightMethod === 'official', 'weight method/proxy label is present');
check(analysis.methodology?.weightCaveat?.toLowerCase().includes('not official') || analysis.index?.weightMethod === 'official', 'proxy weight caveat says not official');
check(analysis.sources?.nasdaq?.url?.includes('nasdaqomx.com'), 'Nasdaq source URL recorded');
check(analysis.sources?.yahooFinance?.usage?.includes('Daily chart'), 'Yahoo usage recorded');
check(analysis.coverage?.price?.count >= 20, 'price coverage has at least 20 tickers');
check(analysis.coverage?.marketCap?.count >= 20, 'market-cap coverage has at least 20 tickers');
check(analysis.coverage?.fundamentals?.count >= 15, 'fundamental coverage has at least 15 tickers');
check(analysis.history?.url === 'data/sox-history.json', 'analysis points to history JSON');

const proxySum = analysis.constituents.reduce((sum, row) => sum + (Number.isFinite(row.proxyWeight) ? row.proxyWeight : 0), 0);
check(proxySum > 0.98 && proxySum < 1.02, `proxy weights sum near 1 (${proxySum})`);
for (const ticker of ['NVDA', 'AMD', 'AVGO', 'TSM']) {
  check(analysis.constituents.some((row) => row.ticker === ticker), `contains expected SOX ticker ${ticker}`);
}
for (const row of analysis.constituents) {
  check(row.scores && typeof row.scores.label === 'string', `${row.ticker} has score label`);
  check(row.dataQuality && typeof row.dataQuality.pricePoints === 'number', `${row.ticker} has data quality`);
}

check(history.schemaVersion === 1, 'history schemaVersion is 1');
check(history.projectId === 'sox', 'history projectId is sox');
check(Array.isArray(history.snapshots), 'history snapshots is array');
check(history.snapshotCount === history.snapshots.length, 'history snapshotCount matches snapshots length');
check(history.snapshots.some((snapshot) => snapshot.dataAsOf === analysis.dataAsOf), 'history contains latest analysis dataAsOf');
check(history.snapshots.every((snapshot) => Array.isArray(snapshot.constituents) && snapshot.constituents.length >= 25), 'history snapshots keep date-selectable constituents');

check(summary.schemaVersion === 1, 'summary schemaVersion is 1');
check(summary.contract === 'quant-research-summary', 'summary contract is quant-research-summary');
check(summary.projectId === 'sox', 'summary projectId is sox');
check(summary.status?.cadence?.includes('07:30/09:30/11:30/13:30 KST'), 'summary records staggered automation cadence');
check(summary.coverage?.snapshotCount === history.snapshotCount, 'summary exposes history snapshot count');
check(summary.automation?.workflowUrl?.includes('/actions/workflows/deploy-pages.yml'), 'summary records automation workflow URL');
check(summary.historyUrl === 'https://sonchanggi.github.io/sox/data/sox-history.json', 'summary exposes public history URL');
check(Array.isArray(summary.primaryEntities) && summary.primaryEntities.length > 0, 'summary has primary entities');
check(summary.pageUrl === 'https://sonchanggi.github.io/sox/', 'summary pageUrl points to SOX Pages path');

check(html.includes('Quant Research Hub'), 'index links/copy includes Quant Research Hub');
check(html.includes('https://sonchanggi.github.io/quant-dashboard/'), 'index has quant-dashboard return link');
check(html.includes('https://sonchanggi.github.io/kelly/'), 'shared project navigation includes Kelly');
check(html.includes('class="skip-link"'), 'index includes a keyboard skip link');
check(html.includes('<details class="ops-details">'), 'source and operations copy is consolidated in one closed details section');
check(html.includes('투자 조언이 아닙니다'), 'research-only disclaimer is visible');
check(html.includes('프록시 비중'), 'proxy-weight Korean copy is visible');
check(html.includes('id="snapshot-date-select"'), 'index exposes date snapshot selector');
check(html.includes('id="sort-direction"'), 'table exposes ascending/descending direction control');
check(html.includes('data-sort-key="proxyWeight"') && html.includes('data-sort-key="earningsMomentum"'), 'table headers expose per-column sort buttons');
check(html.includes('aria-sort="ascending"'), 'initial table sort state is accessible');
check(!app.includes('query1.finance.yahoo.com') && !app.includes('nasdaqomx.com/Index/WeightingData'), 'browser app has no live finance endpoint');
check(app.includes("const DATA_URL = 'data/sox-analysis.json'"), 'browser app reads generated JSON');
check(app.includes("const HISTORY_URL = 'data/sox-history.json'"), 'browser app reads generated history JSON');
check(app.includes('applySnapshot') && app.includes('snapshot-date-select'), 'browser app supports date-selectable snapshots');
check(app.includes('sortDirection') && app.includes('updateSortIndicators'), 'browser app manages two-way sort direction state');
check(app.includes('rowSearchText'), 'browser app searches across table columns');
check(app.includes("const THEME_STORAGE_KEY = 'quant-research-theme'"), 'browser app uses the shared theme storage key');
check(app.includes('data-chart-ticker') && app.includes('aria-pressed'), 'chart marks expose selectable keyboard state');
check(app.includes('syncChartSelection'), 'chart selection is synchronized across views');
check(app.includes("pinnedTicker: ''") && app.includes("previewTicker: ''"), 'chart preview and pinned selection use separate state');
check(app.includes('handleChartPreviewEnd') && app.includes('handleChartKeyDown'), 'chart hover/focus restores the pin and keyboard activation pins');
check(app.includes('layoutQuadrantRows') && app.includes('quadrant-plot'), 'quadrant points reserve edge padding and deterministic collision positions');
check(app.includes("row[key] === 0 ? 0"), 'zero-value bars render at zero magnitude');
check(app.includes('data-table-ticker'), 'static fallback coordinates chart selection with the table');
check(!app.includes("metricCard('Stored dates'") && !app.includes("metricCard('Weight method'") && !app.includes("metricCard('Status'"), 'operational metrics are removed from the primary result grid');
check(workflow.includes('30 22 * * 1-5'), 'workflow schedules SOX primary 07:30 KST slot');
check(workflow.includes('jobs:\n  freshness:'), 'workflow runs a lightweight freshness preflight job');
check(workflow.includes('scripts/check_sox_freshness.py'), 'workflow uses freshness gate before retries');
check(workflow.includes("if: needs.freshness.outputs.should_deploy == 'true'"), 'workflow skips build/deploy for fresh scheduled retries');
check(workflow.includes("if: needs.freshness.outputs.should_collect == 'true'"), 'workflow refreshes generated data only when freshness gate allows it');
check(workflow.includes('--allow-degraded'), 'workflow explicitly records partial provider failures as degraded JSON instead of failing the run');
check(workflow.includes('git rebase "origin/$branch"'), 'workflow rebases generated data commits before push');
check(freshnessScript.includes('push_uses_committed_generated_json'), 'push events deploy committed generated JSON without regenerating uncommitted data');
check(freshnessScript.includes('us_equity_holidays'), 'freshness gate understands U.S. equity market holidays');
check(freshnessScript.includes('should_deploy'), 'freshness gate emits a deploy decision separate from collection');
check(css.includes('color-scheme: dark'), 'CSS declares dark color scheme');
check(/\.bar-fill\s*\{[^}]*display:\s*block/s.test(css), 'bar fill spans render with block width so charts are visible');
check(/\.bar-fill\s*\{[^}]*min-width:\s*0/s.test(css), 'zero-value bars are not inflated by a minimum fill width');
check(/\.quadrant-plot\s*\{[^}]*inset:\s*24px/s.test(css), 'quadrant reserves point and focus-ring edge padding');
check(css.includes('.sort-indicator'), 'table sort indicator CSS exists');
check(css.includes('.snapshot-control'), 'snapshot selector CSS exists');
check(css.includes('.chart-readout'), 'chart values have an external readout surface');
check(css.includes('.ops-details'), 'collapsed operations detail CSS exists');

const failed = checks.filter((item) => !item.ok);
if (failed.length) {
  console.error(`${failed.length} verification checks failed out of ${checks.length}`);
  process.exit(1);
}
console.log(`${checks.length} verification checks passed`);
