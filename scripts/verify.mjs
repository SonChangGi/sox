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
const summary = readJson('data/summary.json');
const html = readText('index.html');
const app = readText('assets/app.js');
const css = readText('assets/styles.css');

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

const proxySum = analysis.constituents.reduce((sum, row) => sum + (Number.isFinite(row.proxyWeight) ? row.proxyWeight : 0), 0);
check(proxySum > 0.98 && proxySum < 1.02, `proxy weights sum near 1 (${proxySum})`);
for (const ticker of ['NVDA', 'AMD', 'AVGO', 'TSM']) {
  check(analysis.constituents.some((row) => row.ticker === ticker), `contains expected SOX ticker ${ticker}`);
}
for (const row of analysis.constituents) {
  check(row.scores && typeof row.scores.label === 'string', `${row.ticker} has score label`);
  check(row.dataQuality && typeof row.dataQuality.pricePoints === 'number', `${row.ticker} has data quality`);
}

check(summary.schemaVersion === 1, 'summary schemaVersion is 1');
check(summary.contract === 'quant-research-summary', 'summary contract is quant-research-summary');
check(summary.projectId === 'sox', 'summary projectId is sox');
check(Array.isArray(summary.primaryEntities) && summary.primaryEntities.length > 0, 'summary has primary entities');
check(summary.pageUrl === 'https://sonchanggi.github.io/sox/', 'summary pageUrl points to SOX Pages path');

check(html.includes('Quant Research Hub'), 'index links/copy includes Quant Research Hub');
check(html.includes('https://sonchanggi.github.io/quant-dashboard/'), 'index has quant-dashboard return link');
check(html.includes('투자 조언이 아닙니다'), 'research-only disclaimer is visible');
check(html.includes('프록시 비중'), 'proxy-weight Korean copy is visible');
check(html.includes('data/sox-analysis.json'), 'index documents generated JSON path');
check(html.includes('id="sort-direction"'), 'table exposes ascending/descending direction control');
check(html.includes('data-sort-key="proxyWeight"') && html.includes('data-sort-key="earningsMomentum"'), 'table headers expose per-column sort buttons');
check(html.includes('aria-sort="ascending"'), 'initial table sort state is accessible');
check(!app.includes('query1.finance.yahoo.com') && !app.includes('nasdaqomx.com/Index/WeightingData'), 'browser app has no live finance endpoint');
check(app.includes("const DATA_URL = 'data/sox-analysis.json'"), 'browser app reads generated JSON');
check(app.includes('sortDirection') && app.includes('updateSortIndicators'), 'browser app manages two-way sort direction state');
check(app.includes('rowSearchText'), 'browser app searches across table columns');
check(css.includes('color-scheme: dark'), 'CSS declares dark color scheme');
check(/\.bar-fill\s*\{[^}]*display:\s*block/s.test(css), 'bar fill spans render with block width so charts are visible');
check(css.includes('.sort-indicator'), 'table sort indicator CSS exists');

const failed = checks.filter((item) => !item.ok);
if (failed.length) {
  console.error(`${failed.length} verification checks failed out of ${checks.length}`);
  process.exit(1);
}
console.log(`${checks.length} verification checks passed`);
