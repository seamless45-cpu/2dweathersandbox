# Verification harness

Headless regression tests for the two bugs fixed in this branch:

| test | what it checks |
| --- | --- |
| `test_display.mjs` | the "Show Droplets" overlay. Injects a known grid of rain drops, renders with the toggle off and on and compares the two screenshots pixel by pixel: how much of the screen the overlay covers, what colour it is, and what it costs in frame rate. |
| `test_landonly.mjs` | land vapour conservation. Turns the whole domain into vegetated land, sets `landEvaporation` to the slider maximum and watches the water budget: total water (must stay flat), soil moisture (must actually fall when the air above evaporates from it) and NaN. |
| `shaderlab.mjs` | the droplet display shaders on their own: compiles them, builds the instanced VAO exactly like `app.js` does and rasterises a grid of drops. Useful to tell a shader problem from an application state problem. |
| `shot_default.mjs` | screenshots the default view: default preset, no brushes, fixed sun angle, after N iterations. This is the scene a brightness, haze or sharpness report is about. |
| `fps_probe.mjs` | measures render FPS in a given camera and display state, so removing an effect can be judged by numbers (`ZOOM`, `CAMY`, `SUNANGLE`, `MODE`, `ITERS`). |
| `test_visual.mjs` | screenshots a vegetated coast a few hundred iterations in (`SUNANGLE`, `ZOOM`, `SHOWDROPS`). |
| `test_smoke.mjs` | loads the page, starts a simulation, cycles every display mode, toggles the overlays, tools, pause, day/night and resizes, then reports every console error, page error and failed request. |

## Running

The tests drive a real WebGL2 context through SwiftShader, so they need a headless
Chromium. `@sparticuz/chromium` ships one and needs no system packages:

```sh
npm install puppeteer-core @sparticuz/chromium

# 1. build two runnable copies of the app with the test hook injected
node tests/harness/build.mjs              # current tree   -> /tmp/2dws_app
REF=HEAD~1 node tests/harness/build.mjs   # previous commit -> /tmp/2dws_before

# 2. serve them
ROOT=/tmp/2dws_app    PORT=8123 node tests/harness/server.mjs &
ROOT=/tmp/2dws_before PORT=8124 node tests/harness/server.mjs &

# 3. run a test against either of them
URL=http://127.0.0.1:8123/index.html node tests/harness/test_display.mjs --out /tmp/out
URL=http://127.0.0.1:8123/index.html node tests/harness/test_landonly.mjs --out /tmp/out
```

`build.mjs` injects `hook.js.txt` into `app.js` just before `} // end of mainscript`.
The hook only adds a `window.__sim` object that exposes the internal textures,
droplet buffers and a `renderFpsProbe()` helper. It is never part of the app
itself; the shipped `app.js` is untouched.

## Notes that cost time to find

* The dat.GUI panel covers the middle of the canvas, which is exactly where the
  droplets are drawn. Any screenshot-based comparison has to hide the GUI first
  (`display: none`, `visibility: hidden` is not enough - the panel's children
  override it) or it measures the panel.
* The simulation keeps running between two screenshots, so a droplet overlay test
  has to pause the simulation (`guiControls.paused = true`) or it measures the
  wet ground instead. The display pass itself still runs while paused.
* `gl.readPixels` on the default framebuffer returns zeros (the drawing buffer is
  not preserved), so pixel checks have to go through a page screenshot, not
  `readPixels`.
* Chromium needs `LD_LIBRARY_PATH=<dir with libnss3.so libnspr4.so>` unless the
  host already provides them; the tarball inside `@sparticuz/chromium`
  (`bin/al2023.tar.br`, brotli) contains them.
