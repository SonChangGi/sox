import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
]);

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.normalize(path.join(root, pathname));
  if (!file.startsWith(root)) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': contentTypes.get(path.extname(file)) || 'application/octet-stream' });
    res.end(data);
  });
});

function listen() {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}
function close() {
  return new Promise((resolve) => server.close(resolve));
}
async function fetchText(base, pathname) {
  const response = await fetch(`${base}${pathname}`);
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}`);
  return response.text();
}

const port = await listen();
const base = `http://127.0.0.1:${port}`;
try {
  const [html, app, css, analysis, summary] = await Promise.all([
    fetchText(base, '/'),
    fetchText(base, '/assets/app.js'),
    fetchText(base, '/assets/styles.css'),
    fetchText(base, '/data/sox-analysis.json'),
    fetchText(base, '/data/summary.json'),
  ]);
  const assertions = [
    ['html shell marker', html.includes('SOX Semiconductor Index')],
    ['quant-dashboard link', html.includes('https://sonchanggi.github.io/quant-dashboard/')],
    ['app generated-json marker', app.includes('data/sox-analysis.json')],
    ['css dashboard marker', css.includes('--cyan')],
    ['analysis JSON marker', JSON.parse(analysis).projectId === 'sox'],
    ['summary JSON marker', JSON.parse(summary).contract === 'quant-research-summary'],
  ];
  const failed = assertions.filter(([, ok]) => !ok);
  if (failed.length) throw new Error(`static smoke failed: ${failed.map(([name]) => name).join(', ')}`);
  console.log(`static smoke passed at ${base}`);
} finally {
  await close();
}
