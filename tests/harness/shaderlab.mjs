import { launchBrowser } from './browser.mjs';
import fs from 'node:fs';

// Standalone WebGL2 test of the droplet display shaders, with the exact VAO layout
// app.js uses (attribute 0 = sprite quad, 1..3 = the 5-float droplet record).
const browser = await launchBrowser([], { viewport : { width : 500, height : 340 } });
const page = await browser.newPage();
page.on('console', m => console.log('[' + m.type() + ']', m.text().slice(0, 500)));
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 500)));

const vert = fs.readFileSync(new URL('../../shaders/vertex/precipDisplayShader.vert', import.meta.url), 'utf8');
const frag = fs.readFileSync(new URL('../../shaders/fragment/precipDisplayShader.frag', import.meta.url), 'utf8');

await page.setContent('<body style="margin:0;background:#111"><canvas id="c" width="480" height="300"></canvas></body>');

const result = await page.evaluate(async ({ vert, frag }) => {
  const c = document.getElementById('c');
  const gl = c.getContext('webgl2', { preserveDrawingBuffer : true });
  const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n')); return s; };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vert));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  gl.useProgram(p);

  const N = 1920;
  const drops = new Float32Array(N * 5);
  for (let i = 0; i < N; i++) {
    const k = i % 240, row = Math.floor(i / 240);
    if (row < 8) { drops[i * 5 + 0] = -0.95 + 1.9 * (k + 0.5) / 30; drops[i * 5 + 1] = -0.95 + 0.5 * (row + 0.5) / 8; drops[i * 5 + 2] = 10; }
    else { drops[i * 5 + 0] = -2; drops[i * 5 + 1] = -2; drops[i * 5 + 2] = -1; }
    drops[i * 5 + 3] = 0; drops[i * 5 + 4] = 0;
  }
  const quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([ -1, -1, 1, -1, -1, 1, 1, 1 ]), gl.STATIC_DRAW);
  const dropBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, dropBuf);
  gl.bufferData(gl.ARRAY_BUFFER, drops, gl.DYNAMIC_COPY);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const stride = 20;
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, dropBuf);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 0); gl.vertexAttribDivisor(1, 1);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 8); gl.vertexAttribDivisor(2, 1);
  gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 16); gl.vertexAttribDivisor(3, 1);

  gl.viewport(0, 0, c.width, c.height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.uniform2f(gl.getUniformLocation(p, 'aspectRatios'), 0.8333333, 1.6);
  gl.uniform3f(gl.getUniformLocation(p, 'view'), 0, 0.7, 1.0001);
  gl.uniform2f(gl.getUniformLocation(p, 'canvasSize'), c.width, c.height);
  gl.uniform1f(gl.getUniformLocation(p, 'wrapShift'), 0.0);
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, N);
  const err = gl.getError();
  const px = new Uint8Array(c.width * c.height * 4);
  gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let lit = 0, minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const i = (x + y * c.width) * 4;
    if (px[i] + px[i + 1] + px[i + 2] > 120) { lit++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  return { err, lit, bbox : lit ? { minX, maxX, minY, maxY } : null };
}, { vert, frag });

console.log('standalone shader test: ' + JSON.stringify(result));
fs.writeFileSync('/tmp/2dws_out_shaderlab.png', await page.screenshot({ encoding : 'binary' }));
await browser.close();
