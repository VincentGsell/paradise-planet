// Still shots of dev.html in a separate headless Chrome (its own temporary profile), on the real GPU.
//   node tools/shoot.mjs [--poses 1,2,3] [--q 0] [--km 30] [--w 2560] [--h 1440] [--hour 18.5] [--out out/shots] [--tag x]
import puppeteer from '../source/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const poses = arg('poses', '1,2,3,4,5,6,7,8').split(',').map(Number);
const q = arg('q', '0'), km = arg('km', '30'), W = +arg('w', 2560), H = +arg('h', 1440), out = path.join(root, arg('out', 'out/shots')), tag = arg('tag', '');
const hour = arg('hour', ''), prof = process.argv.includes('--prof');
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-sandbox', '--no-first-run', `--window-size=${W},${H}`],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || m.type() === 'warning' || /GPU|error/i.test(t)) logs.push(`[${m.type()}] ${t}`); });
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
for (const p of poses) {
  const url = pathToFileURL(path.join(root, 'dev.html')).href + `?shot&q=${q}&km=${km}&pose=${p}${hour ? '&hour=' + hour : ''}${prof ? '&prof' : ''}${process.argv.includes('--clear') ? '&clear' : ''}${arg('extra', '')}`;
  await page.goto(url);
  const t0 = Date.now();
  // wait for the page to be up, then for the terrain to settle (no build request for 30 frames)
  await page.waitForFunction(() => window.PP && PP.frames() > 5, { timeout: 60000 }).catch(() => logs.push('no frames'));
  let calm = 0, last = -1;
  while (Date.now() - t0 < 40000) {
    const st = await page.evaluate(() => [PP.pending(), PP.frames()]).catch(() => [1, 0]);
    if (st[1] !== last) { calm = st[0] === 0 ? calm + (st[1] - Math.max(last, 0)) : 0; last = st[1]; }
    if (calm > 40) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise((r) => setTimeout(r, 600)); // eye adaptation
  const info = await page.evaluate(() => ({ gpu: PP.gpu(), draws: PP.draws(), free: PP.slotsFree(), frames: PP.frames() })).catch(() => ({}));
  const file = path.join(out, `pose${p}${tag ? '_' + tag : ''}.png`);
  await page.screenshot({ path: file });
  if (prof) {
    const pr = await page.evaluate(() => window.PROF);
    console.log(Object.entries(pr || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${k.padEnd(18)} ${v.toFixed(2)} ms`).join('\n'));
  }
  console.log(`pose ${p}: ${((Date.now() - t0) / 1000).toFixed(1)} s, gpu ${info.gpu?.toFixed?.(2)} ms, ${info.draws} patches, ${info.free} free slots -> ${path.relative(root, file)}`);
}
// the first distinct errors only (one GPU error cascades into many)
const seen = new Set();
for (const l of logs) {
  if (!l.startsWith('[error]') && !l.startsWith('[pageerror]')) continue;
  const k = l.split('\n')[0];
  if (seen.has(k) || seen.size > 8) continue;
  seen.add(k); console.log(l.slice(0, 700));
}
await browser.close();
