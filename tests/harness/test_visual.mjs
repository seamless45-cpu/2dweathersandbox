import { launchBrowser } from './browser.mjs';
import fs from 'node:fs';

// Screenshots the current visuals so they can be reviewed: a vegetated coast, a few
// hundred iterations in, in the default "Realistic" display mode.
const URL = process.env.URL || 'http://127.0.0.1:8123/index.html';
const MODE = process.env.MODE || 'DISP_REAL';
const OUT = process.env.OUT || '/tmp/2dws_visual.png';
const ITERS = parseInt(process.env.ITERS || '400');

const browser = await launchBrowser([], { viewport : { width : 960, height : 540 } });
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)));

await page.goto(URL, { waitUntil : 'networkidle2', timeout : 120000 });
await page.evaluate(() => {
  document.getElementById('simResSelX').value = '300';
  document.getElementById('simResSelY').value = '150';
  document.querySelector('input[value="▶ CREATE NEW SIMULATION"]').click();
});
await page.waitForFunction(() => window.__sim && window.__sim.SETUP_MODE === true, { timeout : 300000 });
await page.evaluate(() => { window.__sim.startSimulation(); });
await page.waitForFunction(() => window.__sim.SETUP_MODE === false, { timeout : 120000 });
await page.evaluate(({ mode, showDrops, sunAngle }) => {
  const s = window.__sim;
  s.guiControls.sound = false; s.guiControls.cameraShake = false;
  s.guiControls.auto_IterPerFrame = false; s.guiControls.IterPerFrame = 1;
  s.guiControls.brushIntensity = 0.05; s.guiControls.brushSize = 40;
  s.guiControls.showDrops = showDrops;
  s.guiControls.displayMode = mode;
  if (sunAngle !== null) { s.guiControls.dayNightCycle = false; s.guiControls.sunAngle = sunAngle; }
  for (const el of document.querySelectorAll('body *')) {
    if (el.tagName == 'SCRIPT' || el.id == 'mainCanvas' || el.contains(document.getElementById('mainCanvas'))) continue;
    el.style.display = 'none'; // the GUI covers the middle of the canvas
  }
}, { mode : MODE, showDrops : process.env.SHOWDROPS === '1', sunAngle : process.env.SUNANGLE ? parseFloat(process.env.SUNANGLE) : null });

const box = await page.evaluate(() => { const r = document.getElementById('mainCanvas').getBoundingClientRect(); return { w : r.width, h : r.height }; });
async function drag(tool, yFrac, seconds) {
  await page.evaluate(t => { window.__sim.guiControls.tool = t; }, tool);
  await page.evaluate(async ({ yFrac, seconds, w, h }) => {
    const canvas = document.getElementById('mainCanvas');
    const send = (t, x, y) => (t == 'mousedown' ? canvas : window).dispatchEvent(new MouseEvent(t, { button : 0, clientX : x, clientY : y, bubbles : true }));
    const py = h * yFrac, px = w * 0.5;
    send('mousemove', px, py); send('mousedown', px, py);
    const t0 = Date.now();
    while (Date.now() - t0 < seconds * 1000) { send('mousemove', w * (0.08 + 0.84 * ((Date.now() - t0) / seconds % 1.0)), py); await new Promise(r => setTimeout(r, 80)); }
    send('mouseup', px, py);
  }, { yFrac, seconds, w : box.w, h : box.h });
  await new Promise(r => setTimeout(r, 150));
}
// a coast: land in the lower left, water elsewhere
await drag('TOOL_WALL_LAND', 0.78, 8);
await drag('TOOL_VEGETATION', 0.78, 10);
await page.evaluate(() => { window.__sim.guiControls.tool = 'TOOL_NONE'; });
if (process.env.ZOOM) {
  await page.evaluate(({ z, x, y }) => { window.__sim.setCamera(x, y, z); },
                      { z : parseFloat(process.env.ZOOM), x : parseFloat(process.env.CAMX || '0.5'), y : parseFloat(process.env.CAMY || '0.5') });
}
console.log('running ' + ITERS + ' iterations...');
await page.waitForFunction(t => window.__sim.iterNum >= t, { timeout : 1800000, polling : 500 }, ITERS);
fs.writeFileSync(OUT, await page.screenshot({ encoding : 'binary' }));
console.log('wrote ' + OUT + ' (mode=' + MODE + ', iter=' + await page.evaluate(() => window.__sim.iterNum) + ')');
await browser.close();
