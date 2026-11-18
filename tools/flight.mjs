// The scripted 60 s flight in a separate headless Chrome: frame and GPU times (avg, p99, max), and stills.
//   node tools/flight.mjs [--w 2560] [--h 1440] [--q 0] [--km 30] [--hour 16.5] [--stills 6] [--clear]
import puppeteer from '../source/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const W = +arg('w', 2560), H = +arg('h', 1440), q = arg('q', '0'), km = arg('km', '30'), hour = +arg('hour', 16.5), stills = +arg('stills', 0);
const out = path.join(root, 'out', 'flight'); mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-sandbox', '--no-first-run', `--window-size=${W},${H}`, '--disable-frame-rate-limit', '--disable-gpu-vsync'],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 } });
const page = await browser.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(pathToFileURL(path.join(root, 'dev.html')).href + `?shot&q=${q}&km=${km}&pose=1${process.argv.includes('--clear') ? '&clear' : ''}`);
await page.waitForFunction(() => window.PP && PP.frames() > 30, { timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));
await page.evaluate((h) => PP.flight(h), hour);
const t0 = Date.now(); let n = 0;
while (!(await page.evaluate(() => PP.flightLog().done))) {
  await new Promise((r) => setTimeout(r, 250));
  if (stills && Date.now() - t0 > (n + 0.5) * 60000 / stills && n < stills) { await page.screenshot({ path: path.join(out, `f${String(n).padStart(2, '0')}.png`) }); n++; }
  if (Date.now() - t0 > 180000) break;
}
const log = await page.evaluate(() => PP.flightLog());
const st = (a) => { const s = [...a].sort((x, y) => x - y); return { avg: a.reduce((x, y) => x + y, 0) / a.length, p99: s[Math.floor(s.length * 0.99)], max: s[s.length - 1], n: a.length }; };
const f = st(log.frames.slice(5)), g = st(log.gpu.slice(5));
const rep = `Flight ${W}x${H}, level ${['High', 'Medium', 'Low'][q]}, ${km} km\nframe: avg ${f.avg.toFixed(2)} ms, p99 ${f.p99.toFixed(2)} ms, max ${f.max.toFixed(2)} ms (${f.n} frames)\nGPU:   avg ${g.avg.toFixed(2)} ms, p99 ${g.p99.toFixed(2)} ms, max ${g.max.toFixed(2)} ms (${g.n} samples)\n`;
console.log(rep); writeFileSync(path.join(out, `report_${W}x${H}_q${q}.txt`), rep + JSON.stringify({ frames: log.frames, gpu: log.gpu }));
if (errs.length) console.log(errs.slice(0, 5).join('\n'));
await browser.close();
