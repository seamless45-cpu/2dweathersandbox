import { launchBrowser } from './browser.mjs';

// Measures render FPS in a given camera/display state, so an effect removal can be
// judged by numbers instead of by feel. SwiftShader (software GL) makes the
// fill-rate bound passes expensive, which is what we want to compare.
const URL = process.env.URL || 'http://127.0.0.1:8123/index.html';
const ZOOM = parseFloat(process.env.ZOOM || '1.0');
const Y = parseFloat(process.env.CAMY || '0.5');
const ITERS = parseInt(process.env.ITERS || '40');
const SUN = process.env.SUNANGLE ? parseFloat(process.env.SUNANGLE) : null;
const MODE = process.env.MODE || 'DISP_REAL';

const browser = await launchBrowser([], { viewport : { width : 640, height : 360 } });
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)));

await page.goto(URL, { waitUntil : 'networkidle2', timeout : 120000 });
await page.evaluate(() => {
  document.getElementById('simResSelX').value = '300';
  document.getElementById('simResSelY').value = '150';
  document.querySelector('input[type="button"][onclick*="loadData"], button[onclick*="loadData"]').click();
});
await page.waitForFunction(() => window.__sim && window.__sim.SETUP_MODE === true, { timeout : 300000 });
await page.evaluate(() => { window.__sim.startSimulation(); });
await page.waitForFunction(() => window.__sim.SETUP_MODE === false, { timeout : 120000 });
await page.evaluate(({ mode, sun, zoom, y }) => {
  const s = window.__sim;
  s.guiControls.sound = false; s.guiControls.cameraShake = false;
  s.guiControls.auto_IterPerFrame = false; s.guiControls.IterPerFrame = 1;
  s.guiControls.displayMode = mode;
  if (sun !== null) { s.guiControls.dayNightCycle = false; s.guiControls.sunAngle = sun; }
  for (const el of document.querySelectorAll('body *')) {
    if (el.tagName == 'SCRIPT' || el.id == 'mainCanvas' || el.contains(document.getElementById('mainCanvas'))) continue;
    el.style.display = 'none';
  }
  s.setCamera(0.5, y, zoom);
}, { mode : MODE, sun : SUN, zoom : ZOOM, y : Y });

await page.waitForFunction(t => window.__sim.iterNum >= t, { timeout : 600000, polling : 250 }, ITERS);

// measure twice, take the second (warm) measurement
let fps = await page.evaluate(() => window.__sim.renderFpsProbe(40));
const fps2 = await page.evaluate(() => window.__sim.renderFpsProbe(60));
console.log(JSON.stringify({ url : URL, mode : MODE, zoom : ZOOM, warmupFps : +fps.toFixed(2), fps : +fps2.toFixed(2) }));
await browser.close();
