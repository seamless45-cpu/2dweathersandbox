import { launchBrowser } from './tests/harness/browser.mjs';

// Instruments cloud growth in the DEFAULT preset (no tools, default terrain).
// Reports vapor/cloud/soil totals and relative humidity at the surface and at
// a few altitudes every N iterations. Tunable via env:
//   LAND_EVAP WATER_EVAP COND ITERS RES_X RES_Y
const URL = process.env.URL || 'http://127.0.0.1:8123/index.html';
const NX = parseInt(process.env.RES_X || '240');
const NY = parseInt(process.env.RES_Y || '160');
const LAND_EVAP = process.env.LAND_EVAP;    // if set, override slider
const WATER_EVAP = process.env.WATER_EVAP;  // if set, override slider
const COND = process.env.COND;              // if set, override slider
const ITERS = parseInt(process.env.ITERS || '500');

const b = await launchBrowser([], { viewport : { width : 1000, height : 600 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)));
await p.goto(URL, { waitUntil : 'networkidle2', timeout : 120000 });
await p.waitForFunction(() => !!document.querySelector('input[type="button"][onclick*="loadData"], button[onclick*="loadData"]'), { timeout : 120000 });
await p.evaluate(([ nx, ny ]) => {
  document.getElementById('simResSelX').value = String(nx);
  document.getElementById('simResSelY').value = String(ny);
  document.querySelector('input[type="button"][onclick*="loadData"], button[onclick*="loadData"]').click();
}, [ NX, NY ]);
await p.waitForFunction(() => window.__sim && window.__sim.SETUP_MODE === true, { timeout : 300000 });
await p.evaluate((le, we, cd) => {
  const s = window.__sim;
  s.guiControls.sound = false; s.guiControls.cameraShake = false; s.guiControls.dayNightCycle = false;
  s.guiControls.auto_IterPerFrame = false; s.guiControls.IterPerFrame = 4;
  if (le !== undefined) s.guiControls.landEvaporation = le;
  if (we !== undefined) s.guiControls.waterEvaporation = we;
  if (cd !== undefined) s.guiControls.condensationRate = cd;
}, LAND_EVAP !== undefined ? +LAND_EVAP : undefined,
   WATER_EVAP !== undefined ? +WATER_EVAP : undefined,
   COND !== undefined ? +COND : undefined);
await p.evaluate(() => window.__sim.startSimulation());

const stats = () => p.evaluate(() => {
  const s = window.__sim, nx = s.sim_res_x, ny = s.sim_res_y;
  const w = s.readTexture(1, 'float'), wall = s.readTexture(2, 'int'), bt = s.readTexture(0, 'float');
  let vapor = 0, cloud = 0, soil = 0, nan = 0;
  // RH at a few altitudes (fraction of height)
  const rhAt = frac => {
    const y = Math.max(1, Math.min(ny - 2, Math.round(frac * ny)));
    let sum = 0, cnt = 0;
    for (let x = 0; x < nx; x++) {
      const i = (x + y * nx) * 4;
      if (wall[i + 1] == 0) continue; // wall
      const W = w[i]; const T = bt[i + 3]; // T in K (potential ~ real near surface)
      const maxW = Math.pow(T / 250, 17);
      if (maxW > 0.0001) { sum += W / maxW; cnt++; }
    }
    return cnt ? 100 * sum / cnt : 0;
  };
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = (x + y * nx) * 4;
    if (wall[i + 1] == 0) continue;
    if (!isFinite(w[i]) || !isFinite(w[i + 1])) { nan++; continue; }
    vapor += w[i]; cloud += w[i + 1];
  }
  return { iter : s.iterNum, vapor : +vapor.toFixed(1), cloud : +cloud.toFixed(3),
           rhSurf : +rhAt(0.05).toFixed(1), rhMid : +rhAt(0.5).toFixed(1), rhTop : +rhAt(0.95).toFixed(1), nan };
});

const s0 = await stats();
console.log('start ' + JSON.stringify(s0));
for (let done = 50; done <= ITERS; done += 50) {
  await p.waitForFunction(t => window.__sim.iterNum >= t, { timeout : 1800000, polling : 500 }, done);
  console.log('i' + String((await stats()).iter).padStart(5) + ' ' + JSON.stringify(await stats()));
}
await b.close();
