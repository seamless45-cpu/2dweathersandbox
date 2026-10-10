import { launchBrowser } from './browser.mjs';
import fs from 'node:fs';

// Screenshots the app in its default state: default preset, default display mode,
// no brushes, after a fixed number of iterations. This is what loads on page open.
const URL = process.env.URL || 'http://127.0.0.1:8123/index.html';
const OUT = process.env.OUT || '/tmp/shot_default.png';
const ITERS = parseInt(process.env.ITERS || '400');
const SUN = process.env.SUNANGLE ? parseFloat(process.env.SUNANGLE) : null;

const browser = await launchBrowser([], { viewport : { width : 960, height : 540 } });
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)));

await page.goto(URL, { waitUntil : 'networkidle2', timeout : 120000 });
await page.evaluate(() => {
  document.getElementById('simResSelX').value = '300';
  document.getElementById('simResSelY').value = '150';
  document.querySelector('input[type="button"][onclick*="loadData"], button[onclick*="loadData"]').click();
});
await page.waitForFunction(() => window.__sim && window.__sim.SETUP_MODE === true, { timeout : 300000 });
await page.evaluate(() => { window.__sim.startSimulation(); });
await page.waitForFunction(() => window.__sim.SETUP_MODE === false, { timeout : 120000 });
await page.evaluate(sunAngle => {
  const s = window.__sim;
  s.guiControls.sound = false; s.guiControls.cameraShake = false;
  s.guiControls.auto_IterPerFrame = false; s.guiControls.IterPerFrame = 1;
  if (sunAngle !== null) { s.guiControls.dayNightCycle = false; s.guiControls.sunAngle = sunAngle; }
  for (const el of document.querySelectorAll('body *')) {
    if (el.tagName == 'SCRIPT' || el.id == 'mainCanvas' || el.contains(document.getElementById('mainCanvas'))) continue;
    el.style.display = 'none';
  }
}, SUN);
await page.waitForFunction(t => window.__sim.iterNum >= t, { timeout : 1800000, polling : 500 }, ITERS);
fs.writeFileSync(OUT, await page.screenshot({ encoding : 'binary' }));
console.log('wrote ' + OUT + ' (iter=' + await page.evaluate(() => window.__sim.iterNum) + ')');
await browser.close();
