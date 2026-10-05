import { launchBrowser } from './browser.mjs';
import fs from 'node:fs';

// Droplet overlay test.
//
// Injects a known grid of droplets into the precipitation buffers, then renders the
// canvas with "Show Droplets" off and on and compares the two images pixel by pixel
// in-page. The dat.GUI panel is hidden for the measurement (it covers the middle of
// the canvas, exactly where the droplets are drawn) and shown again for the
// screenshots that go into the report.
//
//   URL=http://127.0.0.1:8123/index.html node test_display.mjs --out dir
const URL = process.env.URL || 'http://127.0.0.1:8123/index.html';
const COLS = parseInt(process.env.COLS || '30');
const ROWS = parseInt(process.env.ROWS || '8');
const MASS = parseFloat(process.env.MASS || '2'); // rain drops grow well past this
const argOut = process.argv.indexOf('--out');
const outDir = argOut >= 0 ? process.argv[argOut + 1] : '/tmp/2dws_out_display';
fs.mkdirSync(outDir, { recursive : true });

const browser = await launchBrowser([], { viewport : { width : 480, height : 300 } });
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)));

await page.goto(URL, { waitUntil : 'networkidle2', timeout : 120000 });
await page.evaluate(res => {
  document.getElementById('simResSelX').value = String(res[0]);
  document.getElementById('simResSelY').value = String(res[1]);
  document.querySelector('input[value="▶ CREATE NEW SIMULATION"]').click();
}, [ parseInt(process.env.RES_X || '240'), parseInt(process.env.RES_Y || '240') ]);
await page.waitForFunction(() => window.__sim && window.__sim.SETUP_MODE === true, { timeout : 300000 });
await page.evaluate(() => { window.__sim.startSimulation(); });
await page.waitForFunction(() => window.__sim.SETUP_MODE === false, { timeout : 120000 });
await page.evaluate(() => {
  const s = window.__sim;
  s.guiControls.sound = false; s.guiControls.cameraShake = false;
  s.guiControls.auto_IterPerFrame = false; s.guiControls.IterPerFrame = 1;
  s.guiControls.dayNightCycle = false;
});
await page.waitForFunction(t => window.__sim.iterNum >= t, { timeout : 300000, polling : 300 }, 8);

// a grid of rain drops spread over the whole canvas, in the shader's [-1, 1] space
const injected = await page.evaluate(({ cols, rows, mass }) => {
  const s = window.__sim;
  const list = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++)
    list.push([ -0.95 + 1.9 * (c + 0.5) / cols, -0.95 + 1.9 * (r + 0.5) / rows, mass, 0, 0 ]);
  while (list.length < s.NUM_DROPLETS) list.push([ -2, -2, -1, 0, 0 ]); // inactive: negative mass
  s.setDroplets((x, y, i) => list[i]);
  return { drops : cols * rows, buffers : s.NUM_DROPLETS };
}, { cols : COLS, rows : ROWS, mass : MASS });
console.log(`injected ${injected.drops} rain drops (mass ${MASS}) of ${injected.buffers} droplet slots`);

const hideGui = hide => page.evaluate(hide => {
  const canvas = document.getElementById('mainCanvas');
  if (!window.__guiHidden) window.__guiState = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.tagName == 'SCRIPT' || el == canvas || el.contains(canvas) || canvas.contains(el)) continue;
    if (hide) {
      if (!el.__origDisplay) { el.__origDisplay = el.style.display; window.__guiState.push([ el, el.__origDisplay ]); }
      el.style.display = 'none';
    } else {
      el.style.display = el.__origDisplay || '';
    }
  }
  window.__guiHidden = hide;
  return document.querySelectorAll('body *').length;
}, hide);

// ---------- measurement pass: GUI hidden, simulation frozen ----------
await page.evaluate(() => { window.__sim.guiControls.paused = true; });
await hideGui(true);
await new Promise(r => setTimeout(r, 1000));

async function shoot(name, showDrops) {
  await page.evaluate(on => { window.__sim.guiControls.showDrops = on; }, showDrops);
  await new Promise(r => setTimeout(r, 1200));
  const buf = await page.screenshot({ encoding : 'binary' });
  fs.writeFileSync(outDir + '/' + name + '.png', buf);
  return buf.toString('base64');
}
const offB64 = await shoot('measure_off', false);
const onB64 = await shoot('measure_on', true);

const cmp = await page.evaluate(async ({ a, b }) => {
  const load = async d => { const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + d)).blob()); const c = new OffscreenCanvas(bmp.width, bmp.height); const x = c.getContext('2d'); x.drawImage(bmp, 0, 0); return { w : bmp.width, h : bmp.height, d : x.getImageData(0, 0, bmp.width, bmp.height).data }; };
  const A = await load(a), B = await load(b);
  const n = A.w * A.h;
  let changed = 0, r = 0, g = 0, bl = 0, lumaOff = 0, lumaOn = 0, blueish = 0;
  let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    lumaOff += 0.2126 * A.d[o] + 0.7152 * A.d[o + 1] + 0.0722 * A.d[o + 2];
    lumaOn += 0.2126 * B.d[o] + 0.7152 * B.d[o + 1] + 0.0722 * B.d[o + 2];
    if (Math.abs(A.d[o] - B.d[o]) + Math.abs(A.d[o + 1] - B.d[o + 1]) + Math.abs(A.d[o + 2] - B.d[o + 2]) > 48) {
      changed++; r += B.d[o]; g += B.d[o + 1]; bl += B.d[o + 2];
      if (B.d[o + 2] > B.d[o] + 8) blueish++;
      const x = i % A.w, y = Math.floor(i / A.w);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  return { size : [ A.w, A.h ],
           coveragePct : +(100 * changed / n).toFixed(2),
           blueishSharePct : +(100 * blueish / Math.max(changed, 1)).toFixed(1),
           meanColorOfOverlay : [ Math.round(r / Math.max(changed, 1)), Math.round(g / Math.max(changed, 1)), Math.round(bl / Math.max(changed, 1)) ],
           meanLumaOff : +(lumaOff / n).toFixed(1), meanLumaOn : +(lumaOn / n).toFixed(1),
           bbox : changed ? [ minX, minY, maxX, maxY ] : null };
}, { a : offB64, b : onB64 });
console.log('overlay coverage: ' + JSON.stringify(cmp));

// ---------- frame cost of the overlay ----------
const fps = await page.evaluate(async () => {
  const s = window.__sim;
  s.guiControls.paused = true;
  await new Promise(r => setTimeout(r, 600));
  s.guiControls.showDrops = true; const withDrops = await s.renderFpsProbe(50);
  s.guiControls.showDrops = false; const noDrops = await s.renderFpsProbe(50);
  const with2 = await s.renderFpsProbe(50);
  s.guiControls.showDrops = true;
  return { withDrops : +withDrops.toFixed(2), noDrops : +noDrops.toFixed(2), withDrops2 : +with2.toFixed(2), ratio : +(withDrops / noDrops).toFixed(2) };
});
console.log('paused render FPS: ' + JSON.stringify(fps));

// ---------- report screenshots: GUI visible ----------
await hideGui(false);
await shoot('drops_on', true);
await shoot('drops_off', false);

fs.writeFileSync(outDir + '/result.json', JSON.stringify({ URL, injected, cmp, fps }, null, 1));
await browser.close();
console.log(cmp.coveragePct < 3 ? 'SUCCESS: droplets stay small and local' : 'FAIL: the overlay blankets the screen');
