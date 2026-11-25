// The menu and the keys, driven like a player would (headless Chrome, its own temporary profile):
// rebind a key, fly during the arrival, the note of the pace of time, back to the menu.
//   node tools/ui-test.mjs
import puppeteer from '../source/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-sandbox', '--no-first-run', '--window-size=1600,900'],
  defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
let fails = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ' — got ' + JSON.stringify(got)}`); if (!ok) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await page.goto(pathToFileURL(path.join(root, 'dev.html')).href + '?km=10&q=1');
await page.waitForFunction(() => document.body.className === 'm', { timeout: 90000 });
await sleep(1000); // the loading panel and the menu cross-fade (.8 s)
const cap = (a) => page.$eval(`#k b[data-a=${a}]`, (e) => e.textContent);
const fwd0 = await cap('f');
check('a key cap shows a printed letter', /^[A-Z]$/.test(fwd0), fwd0);
// rebind "forward" to the X key, then see it in the list and in storage
await page.click('#k b[data-a=f]');
check('the cap waits for a key', (await cap('f')) === '…', await cap('f'));
await page.keyboard.press('KeyX');
check('forward is now X', (await cap('f')) === 'X', await cap('f'));
check('saved', await page.evaluate(() => JSON.parse(localStorage.paradiseKeys).f === 'KeyX'), await page.evaluate(() => localStorage.paradiseKeys));
// X was free; now bind "back" to X too: they swap
await page.click('#k b[data-a=b]'); await page.keyboard.press('KeyX');
check('back takes X, forward gets back\'s key', (await cap('b')) === 'X' && (await cap('f')) !== 'X', [await cap('f'), await cap('b')]);
await page.click('#kr');
check('default keys', (await cap('f')) === fwd0, await cap('f'));
// the time buttons in the menu
const t0 = await page.$eval('#tc', (e) => e.textContent);
await page.click('#tt');
const t1 = await page.$eval('#tc', (e) => e.textContent);
check('faster time in the menu', /×240/.test(t1), [t0, t1]);
await page.click('#tg');
// the camera moves during the arrival
const p0 = await page.evaluate(() => [...PP.CP]); await sleep(1500); const p1 = await page.evaluate(() => [...PP.CP]);
check('the arrival moves the camera', Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]) > 1, [p0, p1]);
// fly during the arrival: the camera stops where it is, the medallion goes
await page.click('#d'); await sleep(300);
check('flying', (await page.evaluate(() => document.body.className)).startsWith('g'), await page.evaluate(() => document.body.className));
const q0 = await page.evaluate(() => [...PP.CP]); await sleep(800); const q1 = await page.evaluate(() => [...PP.CP]);
check('the arrival stops when flying', Math.hypot(q1[0] - q0[0], q1[1] - q0[1], q1[2] - q0[2]) < 5, [q0, q1]);
// the pace of time while flying: a note
await page.keyboard.press('KeyT'); await sleep(100);
check('a note shows the pace', await page.$eval('#t', (e) => e.className === 'on' && /×240/.test(e.textContent)), await page.$eval('#t', (e) => [e.className, e.textContent]));
await page.keyboard.press('KeyG');
// back to the menu
await page.keyboard.press('Escape'); await sleep(300);
check('Esc opens the menu', (await page.evaluate(() => document.body.className)) === 'm', await page.evaluate(() => document.body.className));
check('the button says Resume', (await page.$eval('#d', (e) => e.textContent)) === 'Resume', await page.$eval('#d', (e) => e.textContent));
await page.screenshot({ path: path.join(root, 'out/intro/menu.png') });
check('no page errors', errs.length === 0, errs);
await browser.close();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
