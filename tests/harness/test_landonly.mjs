import { launchBrowser } from './browser.mjs';
import fs from 'node:fs';

// Isolated land-vapor test: an all-land domain (no lake to leak into the budget),
// vegetated, warm, with the land-evaporation slider at its maximum. Measures how
// much total water the domain creates and how the soil moisture and the vapor
// split it: the air cell above land may only add what the ground gives up.
const URL = process.env.URL || 'http://127.0.0.1:8123/index.html';
const ITERS = parseInt(process.env.PHYS_ITERS || '400');
const VEG = parseInt(process.env.VEG || '40');
const argOut = process.argv.indexOf('--out');
const outDir = argOut >= 0 ? process.argv[argOut + 1] : '/tmp/2dws_out_landonly';
fs.mkdirSync(outDir, { recursive : true });

const browser = await launchBrowser([], { viewport : { width : 480, height : 300 } });
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)));

await page.goto(URL, { waitUntil : 'networkidle2', timeout : 120000 });
await page.evaluate(() => {
  document.getElementById('simResSelX').value = '300';
  document.getElementById('simResSelY').value = '100';
  document.querySelector('input[value="▶ CREATE NEW SIMULATION"]').click();
});
await page.waitForFunction(() => window.__sim && window.__sim.SETUP_MODE === true, { timeout : 300000 });
await page.evaluate(() => { window.__sim.startSimulation(); });
await page.waitForFunction(() => window.__sim.SETUP_MODE === false, { timeout : 120000 });
await page.evaluate(() => {
  const s = window.__sim;
  s.guiControls.sound = false; s.guiControls.cameraShake = false;
  s.guiControls.auto_IterPerFrame = false; s.guiControls.IterPerFrame = 1;
  s.guiControls.showDrops = false;
  s.guiControls.brushIntensity = 0.05; s.guiControls.brushSize = 120;
  s.guiControls.landEvaporation = 0.01; // slider maximum (was 0.0002 before PR #17 recalibrated it)
});

const box = await page.evaluate(() => { const r = document.getElementById('mainCanvas').getBoundingClientRect(); return { w : r.width, h : r.height }; });

async function drag(tool, yFrac, seconds) {
  await page.evaluate(t => { window.__sim.guiControls.tool = t; }, tool);
  await page.evaluate(async ({ yFrac, seconds, w, h }) => {
    const canvas = document.getElementById('mainCanvas');
    const send = (type, x, y) => (type == 'mousedown' ? canvas : window).dispatchEvent(new MouseEvent(type, { button : 0, clientX : x, clientY : y, bubbles : true }));
    const py = h * yFrac, px = w * 0.5;
    send('mousemove', px, py); send('mousedown', px, py);
    const t0 = Date.now();
    while (Date.now() - t0 < seconds * 1000) {
      send('mousemove', w * (0.06 + 0.88 * ((Date.now() - t0) / seconds % 1.0)), py);
      await new Promise(r => setTimeout(r, 90));
    }
    send('mouseup', px, py);
  }, { yFrac, seconds, w : box.w, h : box.h });
  await new Promise(r => setTimeout(r, 200));
}

await drag('TOOL_WALL_LAND', 0.93, 10);
await drag('TOOL_VEGETATION', 0.93, 18);

// make every remaining water surface land, so the domain has no lake at all
const converted = await page.evaluate(veg => {
  const s = window.__sim, nx = s.sim_res_x, ny = s.sim_res_y;
  const wall = s.readTexture(2, 'int');
  let n = 0;
  for (let x = 0; x < nx; x++) {
    for (let y = ny - 1; y >= 0; y--) {
      const i = (x + y * nx) * 4;
      if (wall[i + 1] == 0) {                    // surface wall cell
        if (wall[i] == 2) { wall[i] = 1; n++; }  // water wall -> land
        if (veg > 0) wall[i + 3] = veg;           // vegetation on the surface cell
        break;
      }
    }
  }
  s.uploadWall(wall);
  return n;
}, VEG);
console.log('converted ' + converted + ' water surface cells to land, vegetation=' + VEG);

const budget = () => page.evaluate(() => {
  const s = window.__sim, nx = s.sim_res_x, ny = s.sim_res_y;
  const w = s.readTexture(1, 'float'), wall = s.readTexture(2, 'int'), b = s.readTexture(0, 'float');
  let vapor = 0, cloud = 0, soil = 0, snow = 0, land = 0, water = 0, nan = 0, veg = 0;
  let surfaceVapor = 0, surfaceRH = 0, n = 0;
  for (let x = 0; x < nx; x++) {
    let surfaceY = -1, type = 0;
    for (let y = ny - 1; y >= 0; y--) if (wall[(x + y * nx) * 4 + 1] == 0) { surfaceY = y; type = wall[(x + y * nx) * 4]; break; }
    if (surfaceY < 0) continue;
    const i = (x + surfaceY * nx) * 4;
    if (type == 2) water++;
    else { land++; veg += wall[i + 3]; soil += w[i + 2]; snow += w[i + 3]; }
    const ya = surfaceY + 1;
    if (ya < ny && type != 2) {
      const ia = (x + ya * nx) * 4;
      const T = Math.max(b[ia + 3] - ((ya + 0.5) / ny) * 10.0, 1);
      surfaceVapor += w[ia];
      surfaceRH += w[ia] / Math.pow(T / 250, 17);
      n++;
    }
  }
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = (x + y * nx) * 4;
    if (wall[i + 1] == 0) continue;              // wall
    if (!isFinite(w[i]) || !isFinite(w[i + 1])) { nan++; continue; }
    vapor += w[i]; cloud += w[i + 1];
  }
  return { iter : s.iterNum, vapor : +vapor.toFixed(1), cloud : +cloud.toFixed(2), soil : +soil.toFixed(2), snow : +snow.toFixed(2),
           total : +(vapor + cloud + soil).toFixed(1), land, water, meanVeg : +(veg / Math.max(land, 1)).toFixed(1),
           surfaceVapor : +(surfaceVapor / Math.max(n, 1)).toFixed(3), surfaceRH : +(100 * surfaceRH / Math.max(n, 1)).toFixed(1), nan };
});

await page.evaluate(() => { window.__sim.guiControls.tool = 'TOOL_NONE'; });
const b0 = await budget();
console.log('start ' + JSON.stringify(b0));
const t0 = Date.now();
for (let done = 100; done <= ITERS; done += 100) {
  await page.waitForFunction(t => window.__sim.iterNum >= t, { timeout : 1800000, polling : 500 }, done);
  const b = await budget();
  console.log(`i${done} total=${b.total} vapor=${b.vapor} cloud=${b.cloud} soil=${b.soil} | surfaceVapor=${b.surfaceVapor} RH=${b.surfaceRH}% nan=${b.nan}`);
}
const bF = await budget();
console.log('elapsed ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
console.log(`RESULT iter=${bF.iter} dTotalWater=${(bF.total - b0.total).toFixed(2)} dVapor=${(bF.vapor - b0.vapor).toFixed(2)} dSoil=${(bF.soil - b0.soil).toFixed(2)} nan=${bF.nan}`);
fs.writeFileSync(outDir + '/budget.json', JSON.stringify({ b0, bF }, null, 1));
await browser.close();
console.log('SUCCESS');
