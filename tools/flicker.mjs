// Temporal stability of a still view while time runs: mean |difference| between successive captures in a region
// (the land only: the sea moves on its own). Saves the crops; tools/flicker.py measures them.  node tools/flicker.mjs [--pose 4] [--pace 3] [--n 24] [--roi x0,y0,x1,y1]
import puppeteer from '../source/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const pose = arg('pose', '4'), paceI = +arg('pace', 3), n = +arg('n', 24), km = arg('km', '10');
const [x0, y0, x1, y1] = arg('roi', '1100,650,1900,1060').split(',').map(Number);
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-sandbox', '--no-first-run', '--window-size=1920,1080'], defaultViewport: { width: 1920, height: 1080 } });
const page = await browser.newPage();
await page.goto(pathToFileURL(path.join(root, 'dev.html')).href + `?shot&q=0&km=${km}&pose=${pose}`);
await page.waitForFunction(() => window.PP && PP.frames() > 200, { timeout: 90000 });
await page.evaluate((i) => PP.pace(i), paceI);
import { mkdirSync } from 'node:fs';
const out = path.join(root, 'out/flk', arg('tag', 'x')); mkdirSync(out, { recursive: true });
for (let k = 0; k <= n; k++) await page.screenshot({ path: path.join(out, `f${String(k).padStart(3, '0')}.png`), clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } });
console.log(out);
await browser.close();
