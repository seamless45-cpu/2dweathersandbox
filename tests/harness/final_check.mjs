// Final comprehensive check: run default scene, verify no NaN, clouds present, water smooth.
import { launchBrowser } from './browser.mjs';
const b = await launchBrowser([], { viewport : { width : 1280, height : 800 } });
const p = await b.newPage();
await p.goto('http://127.0.0.1:8123/index.html', { waitUntil : 'networkidle2', timeout : 120000 });
await p.waitForFunction(() => !!document.querySelector('input[type="button"][onclick*="loadData"], button[onclick*="loadData"]'), { timeout : 120000 });
await p.evaluate(() => { document.getElementById('simResSelX').value='320'; document.getElementById('simResSelY').value='200'; loadData(); });
await p.waitForFunction(() => window.__sim && window.__sim.SETUP_MODE === true, { timeout : 300000 });
await p.evaluate(() => { const s=window.__sim; s.guiControls.sound=false; s.guiControls.cameraShake=false; s.guiControls.dayNightCycle=false; s.guiControls.auto_IterPerFrame=false; s.guiControls.IterPerFrame=4; s.guiControls.displayMode='DISP_REAL'; s.startSimulation(); });
await p.waitForFunction(t=>window.__sim.iterNum>=t,{timeout:1800000,polling:500},1200);

const res = await p.evaluate(() => {
  const s = window.__sim;
  // NaN / Inf check over base (temp) and water textures.
  function scan(tex, channels) {
    let bad = 0, max = 0;
    for (let i = 0; i < tex.length; i += 4) {
      for (const c of channels) {
        const v = tex[i + c];
        if (!isFinite(v)) bad++;
        else max = Math.max(max, Math.abs(v));
      }
    }
    return { bad, max };
  }
  const base = s.readTexture(0);          // Float32 base
  const water = s.readTexture(3);         // Float32 water
  const bBad = scan(base, [0,1,2,3]);
  const wBad = scan(water, [0,1,2,3]);
  // CLOUD = index 1 in water texture.
  let cloudCells = 0, maxCloud = 0;
  for (let i = 1; i < water.length; i += 4) {
    const c = water[i];
    if (c > 0.5) cloudCells++;
    maxCloud = Math.max(maxCloud, c);
  }
  return { baseBad: bBad.bad, baseMax: bBad.max, waterBad: wBad.bad, waterMax: wBad.max, cloudCells, maxCloud, iterNum: s.iterNum };
});
console.log(JSON.stringify(res, null, 2));
await p.evaluate(() => { const g=document.querySelector('.sfg.main'); if(g) g.style.display='none'; });
await new Promise(r=>setTimeout(r,600));
await p.screenshot({ path : '/tmp/vis/final_scene.png' });
console.log('final scene captured');
await b.close();
