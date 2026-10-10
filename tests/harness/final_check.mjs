// Final sanity: smaller/faster sim. NaN check, cloud strength, one clean scene shot.
import { launchBrowser } from './browser.mjs';
const b = await launchBrowser([], { viewport : { width : 1000, height : 640 } });
const p = await b.newPage();
await p.goto('http://127.0.0.1:8123/index.html', { waitUntil : 'networkidle2', timeout : 120000 });
await p.waitForFunction(() => !!document.querySelector('input[type="button"][onclick*="loadData"], button[onclick*="loadData"]'), { timeout : 120000 });
await p.evaluate(() => { document.getElementById('simResSelX').value='192'; document.getElementById('simResSelY').value='120'; loadData(); });
await p.waitForFunction(() => window.__sim && window.__sim.SETUP_MODE === true, { timeout : 300000 });
await p.evaluate(() => { const s=window.__sim; s.guiControls.sound=false; s.guiControls.dayNightCycle=false; s.guiControls.auto_IterPerFrame=false; s.guiControls.IterPerFrame=4; s.guiControls.displayMode='DISP_REAL'; s.startSimulation(); });
await p.waitForFunction(t=>window.__sim.iterNum>=t,{timeout:1200000,polling:400},500);

const res = await p.evaluate(() => {
  const s = window.__sim;
  function bad(tex, ch){ let b=0; for(let i=0;i<tex.length;i+=4) for(const c of ch) if(!isFinite(tex[i+c])) b++; return b; }
  const base = s.readTexture(0), water = s.readTexture(3);
  const w = s.sim_res_x, h = s.sim_res_y;
  let cells=0, topY=-1, maxC=0;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){ const c=water[(y*w+x)*4+1]; if(c>0.5){cells++; if(y>topY)topY=y;} maxC=Math.max(maxC,c); }
  return { baseBad: bad(base,[0,1,2,3]), waterBad: bad(water,[0,1,2,3]), cloudCells: cells, maxCloud:+maxC.toFixed(2), topPct:+(topY/h*100).toFixed(1), iterNum: s.iterNum };
});
console.log('RESULT:', JSON.stringify(res));
await p.evaluate(() => { const g=document.querySelector('.sfg.main'); if(g) g.style.display='none'; });
await new Promise(r=>setTimeout(r,300));
await p.screenshot({ path : '/tmp/vis/final_scene.png' });
console.log('captured');
await b.close();
