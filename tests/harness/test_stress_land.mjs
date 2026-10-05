import { launchBrowser } from './browser.mjs';
import fs from 'node:fs';

// Long-run land / vegetation stress test.
//
// Paints a vegetated land domain, puts land evaporation at the slider maximum and
// runs until the water budget diverges or the simulation produces a NaN. Every 100
// iterations it reports the extremes: the hottest and coldest air, the total water,
// the soil moisture and the vapour, plus which cell went non-finite first.
const URL = process.env.URL || 'http://127.0.0.1:8123/index.html';
const MAXIT = parseInt(process.env.MAXIT || '2500');
const STEP = parseInt(process.env.STEP || '100');
const NX = parseInt(process.env.RES_X || '200');
const NY = parseInt(process.env.RES_Y || '100');
const argOut = process.argv.indexOf('--out');
const outDir = argOut >= 0 ? process.argv[argOut + 1] : '/tmp/2dws_out_stress';
fs.mkdirSync(outDir, { recursive : true });

const browser = await launchBrowser([], { viewport : { width : 480, height : 300 } });
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)));

await page.goto(URL, { waitUntil : 'networkidle2', timeout : 120000 });
await page.evaluate(([ nx, ny ]) => {
  document.getElementById('simResSelX').value = String(nx);
  document.getElementById('simResSelY').value = String(ny);
  document.querySelector('input[value="▶ CREATE NEW SIMULATION"]').click();
}, [ NX, NY ]);
await page.waitForFunction(() => window.__sim && window.__sim.SETUP_MODE === true, { timeout : 300000 });
await page.evaluate(() => { window.__sim.startSimulation(); });
await page.waitForFunction(() => window.__sim.SETUP_MODE === false, { timeout : 120000 });
await page.evaluate(() => {
  const s = window.__sim;
  s.guiControls.sound = false; s.guiControls.cameraShake = false;
  s.guiControls.auto_IterPerFrame = false; s.guiControls.IterPerFrame = 1;
  s.guiControls.showDrops = false;
  s.guiControls.brushIntensity = 0.05; s.guiControls.brushSize = 90;
  s.guiControls.landEvaporation = 0.01; // slider maximum (was 0.0002 before PR #17 recalibrated it)
});
const box = await page.evaluate(() => { const r = document.getElementById('mainCanvas').getBoundingClientRect(); return { w : r.width, h : r.height }; });

async function drag(tool, yFrac, seconds) {
  await page.evaluate(t => { window.__sim.guiControls.tool = t; }, tool);
  await page.evaluate(async ({ yFrac, seconds, w, h }) => {
    const canvas = document.getElementById('mainCanvas');
    const send = (t, x, y) => (t == 'mousedown' ? canvas : window).dispatchEvent(new MouseEvent(t, { button : 0, clientX : x, clientY : y, bubbles : true }));
    const py = h * yFrac, px = w * 0.5;
    send('mousemove', px, py); send('mousedown', px, py);
    const t0 = Date.now();
    while (Date.now() - t0 < seconds * 1000) {
      send('mousemove', w * (0.08 + 0.84 * ((Date.now() - t0) / seconds % 1.0)), py);
      await new Promise(r => setTimeout(r, 80));
    }
    send('mouseup', px, py);
  }, { yFrac, seconds, w : box.w, h : box.h });
  await new Promise(r => setTimeout(r, 150));
}
await drag('TOOL_WALL_LAND', 0.90, 8);
await drag('TOOL_VEGETATION', 0.90, 12);
await page.evaluate(() => { window.__sim.guiControls.tool = 'TOOL_NONE'; });
console.log('terrain ready, running up to ' + MAXIT + ' iterations');

const probe = () => page.evaluate(() => {
  const s = window.__sim, nx = s.sim_res_x, ny = s.sim_res_y;
  const w = s.readTexture(1, 'float'), b = s.readTexture(0, 'float'), wall = s.readTexture(2, 'int');
  let vapor = 0, cloud = 0, soil = 0, tMin = 1e30, tMax = -1e30, nan = 0, nanCell = null, huge = 0, land = 0, water = 0;
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = (x + y * nx) * 4;
    if (wall[i + 1] == 0) { if (wall[i] == 2) water++; else land++; continue; }
    const T = b[i + 3], V = w[i], C = w[i + 1];
    if (!isFinite(T) || !isFinite(V) || !isFinite(C) || !isFinite(w[i + 2])) {
      if (!nanCell) nanCell = { x, y, T, V, C, soil : w[i + 2] };
      nan++; continue;
    }
    if (T < tMin) tMin = T; if (T > tMax) tMax = T;
    if (Math.abs(T) > 1e4) huge++;
    vapor += V; cloud += C;
  }
  // soil moisture of the surface cells
  for (let x = 0; x < nx; x++) for (let y = ny - 1; y >= 0; y--) {
    const i = (x + y * nx) * 4;
    if (wall[i + 1] == 0) { if (wall[i] != 2) soil += w[i + 2]; break; }
  }
  return { iter : s.iterNum, vapor : +vapor.toFixed(1), cloud : +cloud.toFixed(2), soil : +soil.toFixed(1),
           total : +(vapor + cloud + soil).toFixed(1), tMin : +tMin.toFixed(1), tMax : +tMax.toFixed(1),
           nan, huge, land, water, nanCell };
});

const t0 = Date.now();
let last = null, verdict = 'ran out of iterations without a NaN';
for (let done = STEP; done <= MAXIT; done += STEP) {
  await page.waitForFunction(t => window.__sim.iterNum >= t, { timeout : 1800000, polling : 400 }, done);
  const p = await probe();
  console.log(`i${String(p.iter).padStart(5)} water=${p.total} vapor=${p.vapor} cloud=${p.cloud} soil=${p.soil} | Tmin=${p.tMin} Tmax=${p.tMax} huge=${p.huge} nan=${p.nan}`);
  if (p.nan) {
    verdict = `NaN after ${p.iter} iterations`;
    console.log('first non-finite cell: ' + JSON.stringify(p.nanCell));
    break;
  }
  if (p.huge) { verdict = `temperature exceeded 1e4 K after ${p.iter} iterations (diverging)`; break; }
  last = p;
}
console.log('elapsed ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
console.log('VERDICT: ' + verdict);
fs.writeFileSync(outDir + '/stress.json', JSON.stringify({ last, verdict }, null, 1));
fs.writeFileSync(outDir + '/end.png', await page.screenshot({ encoding : 'binary' }));
await browser.close();
console.log('SUCCESS');
