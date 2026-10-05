import { launchBrowser } from './browser.mjs';

// Loads the page like a user, exercises the UI and reports every console error,
// page error and failed request. Catches the kind of issue a screenshot cannot:
// an exception thrown from a click handler, a shader that fails to link, a
// missing file.
const URL = process.env.URL || 'http://127.0.0.1:8123/index.html';
const browser = await launchBrowser([], { viewport : { width : 800, height : 500 } });
const page = await browser.newPage();

const problems = [];
const notes = [];
page.on('console', m => {
  if (m.type() === 'error') problems.push('console.error: ' + m.text().slice(0, 300));
  else if (m.type() === 'warning') notes.push('console.warn: ' + m.text().slice(0, 200));
});
page.on('pageerror', e => problems.push('pageerror: ' + String(e).slice(0, 300)));
page.on('requestfailed', r => {
  const u = r.url();
  // the sounding CORS proxies and meteociel are expected to fail in the sandbox
  if (/meteociel|workers\.dev|allorigins|corsproxy|fonts\.googleapis|fonts\.gstatic/.test(u)) return;
  problems.push('requestfailed: ' + u.slice(0, 160) + ' (' + (r.failure() && r.failure().errorText) + ')');
});

await page.goto(URL, { waitUntil : 'networkidle2', timeout : 120000 });

// the intro screen must be on screen and its start button must exist
await page.waitForFunction(() => !!document.querySelector('input[type="button"][onclick*="loadData"], button[onclick*="loadData"]'), { timeout : 120000 });
notes.push('start button found');

// start the simulation
await page.evaluate(() => {
  document.getElementById('simResSelX').value = '150';
  document.getElementById('simResSelY').value = '75';
  document.querySelector('input[type="button"][onclick*="loadData"], button[onclick*="loadData"]').click();
});
await page.waitForFunction(() => window.__sim && window.__sim.SETUP_MODE === true, { timeout : 300000 });
await page.evaluate(() => window.__sim.startSimulation());
await page.waitForFunction(() => window.__sim.SETUP_MODE === false, { timeout : 180000 });
await page.waitForFunction(() => window.__sim.iterNum > 20, { timeout : 300000, polling : 250 });
notes.push('simulation running, iter=' + await page.evaluate(() => window.__sim.iterNum));
notes.push('intro screen removed: ' + await page.evaluate(() => !document.getElementById('IntroScreen')));

// cycle every display mode
await page.evaluate(async () => {
  const all = [ 'DISP_TEMP', 'DISP_HUMID', 'DISP_PRECIP', 'DISP_AIR', 'DISP_IR', 'DISP_UNIVERSAL', 'DISP_REAL' ];
  const s = window.__sim;
  for (const m of all) {
    s.guiControls.displayMode = m;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  }
});
notes.push('cycled 7 display modes');

// toggle the overlay and the tools, and pause/resume
await page.evaluate(async () => {
  const s = window.__sim;
  const flip = async (k, a, b) => { s.guiControls[k] = a; await new Promise(r => requestAnimationFrame(r)); s.guiControls[k] = b; await new Promise(r => requestAnimationFrame(r)); };
  await flip('showDrops', true, false);
  await flip('displayVectorField', true, false);
  await flip('paused', true, false);
  await flip('dayNightCycle', false, true);
  await flip('smoothCamera', false, true);
  await flip('tool', 'TOOL_WALL_LAND', 'TOOL_WATER');
  s.guiControls.tool = 'TOOL_NONE';
});
notes.push('toggled overlays, tools, pause and day/night');

// resize, which recreates the framebuffers
await page.setViewport({ width : 900, height : 560 });
await page.evaluate(() => window.dispatchEvent(new Event('resize')));
await new Promise(r => setTimeout(r, 2000));
await page.waitForFunction(() => window.__sim.iterNum > 0, { timeout : 60000 });
notes.push('survived a resize');

// open and close the GUI panel
await page.evaluate(() => {
  const c = document.querySelector('.dg .close-button, .dg li.title');
  if (c) c.click();
});
await new Promise(r => setTimeout(r, 500));

console.log('--- notes ---');
notes.forEach(n => console.log('  ' + n));
console.log('--- problems (' + problems.length + ') ---');
const seen = new Set();
for (const p of problems) {
  const key = p.slice(0, 120);
  if (seen.has(key)) continue;
  seen.add(key);
  console.log('  ' + p);
}
console.log(problems.length ? 'FAIL' : 'SUCCESS: no console errors, page errors or failed requests');
await browser.close();
process.exit(problems.length ? 1 : 0);
