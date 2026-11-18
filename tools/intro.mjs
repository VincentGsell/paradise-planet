// The arrival as the player sees it (menu, medallion, descent from orbit): stills at a few times, in a separate
// headless Chrome on the real GPU.
//   node tools/intro.mjs [--w 1920] [--h 1080] [--km 10] [--q 0] [--at 1,6,11,15,19] [--out out/intro]
import puppeteer from '../source/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const W = +arg('w', 1920), H = +arg('h', 1080), km = arg('km', '10'), q = arg('q', '0'), out = path.join(root, arg('out', 'out/intro'));
const at = arg('at', '1,6,11,15,19').split(',').map(Number);
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-sandbox', '--no-first-run', `--window-size=${W},${H}`],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => console.log('[pageerror] ' + e.message));
await page.goto(pathToFileURL(path.join(root, 'dev.html')).href + `?km=${km}&q=${q}`);
await page.waitForFunction(() => document.body.className === 'm', { timeout: 90000 });
const t0 = Date.now();
for (const s of at) {
  const wait = s * 1000 - (Date.now() - t0); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const f = path.join(out, `intro_${String(s).padStart(2, '0')}s.png`);
  await page.screenshot({ path: f }); console.log(f);
}
await browser.close();
