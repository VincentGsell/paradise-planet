// The arrival filmed frame by frame (from orbit down to the beach), in a separate headless Chrome on the real GPU,
// then played forward and backward into a seamless animated WebP for the README.
// Time is virtual: requestAnimationFrame is replaced by a clock the harness advances, so every frame is evenly
// spaced whatever the GPU load. Each video frame gets a few extra steps at the same time (dt = 0) so the terrain and
// the clouds catch up.
//   node tools/film.mjs [--w 1920] [--h 1080] [--km 10] [--q 0] [--fps 20] [--speed 2.8] [--settle 3]
//                       [--ow 800] [--quality 60] [--out out/film]
// Needs ffmpeg in the PATH. Writes out/film/frames/*.png and out/film/arrival.webp.
import puppeteer from '../source/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const W = +arg('w', 1920), H = +arg('h', 1080), km = arg('km', '10'), q = arg('q', '0');
const FPS = +arg('fps', 20), SPEED = +arg('speed', 2.8), SETTLE = +arg('settle', 3), OW = +arg('ow', 800), QUAL = +arg('quality', 60);
const out = path.join(root, arg('out', 'out/film')), dir = path.join(out, 'frames');
rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-sandbox', '--no-first-run', `--window-size=${W},${H}`],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('[error] ' + m.text()); });
page.on('pageerror', (e) => console.log('[pageerror] ' + e.message));
// the virtual clock
await page.evaluateOnNewDocument(() => {
  let queue = [], vt = 0;
  window.requestAnimationFrame = (cb) => { queue.push(cb); return queue.length; };
  window.__step = (ms) => { vt += ms; const q = queue; queue = []; for (const cb of q) cb(vt); };
});
const step = (ms) => page.evaluate((m) => new Promise((r) => { __step(m); setTimeout(r, 0); }), ms);
await page.goto(pathToFileURL(path.join(root, 'dev.html')).href + `?shot&km=${km}&q=${q}`);
// let the world build at 60 virtual fps
await page.waitForFunction(() => typeof __step === 'function' && window.PP, { timeout: 90000, polling: 200 });
for (let i = 0; i < 120; i++) await step(1000 / 60);
await page.evaluate(() => { PP.pace(3); PP.intro(); });
// warm-up at the start pose: terrain and clouds settled before the first frame
for (let i = 0; i < 90; i++) await step(0);

const dtFrame = 1000 * SPEED / FPS, sub = Math.ceil(dtFrame / (1000 / 30));
let n = 0;
for (;;) {
  for (let s = 0; s < sub; s++) await step(dtFrame / sub);
  for (let s = 0; s < SETTLE; s++) await step(0);
  await page.screenshot({ path: path.join(dir, `f${String(n).padStart(4, '0')}.png`) });
  n++;
  const t = await page.evaluate(() => PP.introT());
  if (t < 0 || t >= 1 || n > 2000) break;
}
// a short hold on the beach
const hold = Math.round(FPS * 0.8);
for (let i = 0; i < hold; i++) {
  await step(1000 / FPS); for (let s = 0; s < SETTLE; s++) await step(0);
  await page.screenshot({ path: path.join(dir, `f${String(n++).padStart(4, '0')}.png`) });
}
await browser.close();
console.log(`${n} frames`);

// forward, then backward without repeating the two ends: a seamless loop
const webp = path.join(out, 'arrival.webp');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, 'f%04d.png'),
  '-filter_complex', `[0]scale=${OW}:-2:flags=lanczos,split[a][b];[b]reverse,trim=start_frame=1,setpts=PTS-STARTPTS[r];[a][r]concat=n=2:v=1,trim=end_frame=${2 * n - 2}`,
  '-c:v', 'libwebp', '-lossless', '0', '-q:v', String(QUAL), '-compression_level', '6', '-loop', '0', webp], { stdio: 'inherit' });
console.log(`${webp}: ${(statSync(webp).size / 1048576).toFixed(2)} MB, ${2 * n - 2} frames, ${((2 * n - 2) / FPS).toFixed(1)} s`);
