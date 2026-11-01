// Lightning channel map generator — CG (cloud-to-ground) and IC (intra-cloud) flashes.
//
// One texture holds a complete flash, split into three independent channels so the display
// shader can drive each part of the discharge with its own light curve instead of cutting a
// single grey bolt into pieces with brightness thresholds:
//
//   R  cloud-to-ground trunk      the main stepped-leader / return-stroke channel
//   G  cloud-to-ground branches   the fork tree off the trunk, plus the ground streamers
//   B  intra-cloud crawlers       horizontal "spider" filaments near the cloud base
//   A  opaque
//
// Values are coverage (0..1), not colour: the shaders tint the channel and add its glow, so the
// texture carries only geometry. Every layer is drawn white on transparent, supersampled 2x and
// box-filtered down, so the edges come out anti-aliased and thin channels stay thin instead of
// being fattened by a brightness threshold the way the old generator relied on.
//
// The file is loaded both as a worker (app.js spawns it so the page stays responsive) and as a
// plain script (fallback when workers are unavailable), so it defines one global function and
// only registers a message handler when it is actually running inside a worker.

(function (scope) {
  'use strict';

  /* ────────────────────────────── random ────────────────────────────── */

  // Small deterministic PRNG. Every texture is generated from its own seed, so the same
  // variants come back on every load instead of the bolt shapes changing per session.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function ()
    {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const lerp = (a, b, t) => a + (b - a) * t;

  /* ───────────────────────────── canvases ───────────────────────────── */

  function makeCanvas(w, h)
  {
    if (typeof OffscreenCanvas !== 'undefined')
      return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  /* ─────────────────────────── channel growth ─────────────────────────── */
  //
  // A channel is an axis (its overall direction of travel) with a lateral offset that keeps
  // flipping sign: a step to the left is answered by a step to the right, so the channel
  // staircases down its axis instead of drifting off in smooth S curves. The axis itself
  // straightens back to the initial heading, so a bolt always makes progress from the cloud to
  // the ground and can never loop back on itself.

  function grow(rng, o)
  {
    const pts = [];
    let x = o.x, y = o.y;
    let axis = o.angle;
    const heading = o.angle;
    let off = 0;
    let sign = rng() < 0.5 ? -1 : 1;

    const segLen = o.segLen || 10;
    const kink = o.kink === undefined ? 0.45 : o.kink;
    const zigzag = o.zigzag === undefined ? 0.72 : o.zigzag;
    const spring = o.spring === undefined ? 0.22 : o.spring;
    const axisDrift = o.axisDrift === undefined ? 0.03 : o.axisDrift;
    const wander = o.wander === undefined ? 0.02 : o.wander;
    const micro = o.micro === undefined ? 0.04 : o.micro;
    const sub = o.sub === undefined ? 2 : Math.max(1, o.sub | 0);
    const wTop = o.wTop;
    const wBot = o.wBot;
    const taperPow = o.taperPow === undefined ? 1.0 : o.taperPow;
    const bounds = o.bounds;

    let travelled = 0;
    let guard = 4000;

    while (travelled < o.length && guard-- > 0) {
      // Two ways to build a channel. "hold" gives the classic lightning look: a long straight
      // leg, then a sharp kink to a new angle, then another straight leg — which is what a
      // stepped leader looks like after the steps have been merged into one bright channel.
      // Without it the channel is a spring-damped meander, which suits the soft in-cloud
      // paths that only ever show up as a diffuse glow.
      if (rng() < zigzag) {
        sign = -sign;
        if (o.hold)
          off = sign * (0.12 + rng() * 0.55) * kink;
        else
          off += sign * kink * (0.35 + rng() * 0.9);
      }
      if (!o.hold)
        off -= off * spring;
      if (o.steer)
        off = o.steer(off, x, y, axis);
      off = Math.max(-1.15, Math.min(1.15, off));

      const a = axis + off;
      const run = segLen * (0.5 + rng() * 1.0);
      const subLen = run / sub;

      for (let k = 0; k < sub; k++) {
        const aa = a + (rng() - 0.5) * 2.0 * micro;
        const nx = x + Math.sin(aa) * subLen;
        const ny = y + Math.cos(aa) * subLen;
        const t = Math.min((travelled + subLen) / o.length, 1);
        pts.push({x : x, y : y, nx : nx, ny : ny, w : lerp(wTop, wBot, Math.pow(t, taperPow)), t : t, a : aa});
        x = nx;
        y = ny;
        travelled += subLen;
      }

      // the axis itself may bend slowly, but it is always pulled back to its overall heading
      axis += (rng() - 0.5) * wander;
      axis += (heading - axis) * axisDrift;

      if (bounds && (x < bounds.x0 - 26 || x > bounds.x1 + 26 || y < bounds.y0 - 26 || y > bounds.y1 + 160))
        break;
    }
    return pts;
  }

  function strokePath(g, pts, widthScale, alpha)
  {
    // Round caps and joins. Every segment is stroked on its own, and with the default butt caps
    // the joins between them are gaps: a thin channel comes out of the generator as a dotted
    // line, which then has to be smeared away at render time to hide it.
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.globalAlpha = alpha === undefined ? 1 : alpha;
    for (let i = 0; i < pts.length; i++) {
      const s = pts[i];
      g.lineWidth = Math.max(s.w * widthScale, 0.30);
      g.beginPath();
      g.moveTo(s.x, s.y);
      g.lineTo(s.nx, s.ny);
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  // A channel has to reach the ground. `grow` measures its length along the path it walks, and a
  // bolt that wanders sideways covers less vertical distance than it travels: a trunk drawn for a
  // length of 1.08 h could stop a tenth of the way above the surface, which is exactly what a
  // strike that "stops in mid air" is. Carry the last leg on, mostly downwards, until it has
  // crossed the bottom edge of the map. Anything drawn past the edge is clipped by the canvas, so
  // this cannot make a bolt longer than the map.
  function extendToGround(pts, h)
  {
    if (!pts.length)
      return pts;

    const last = pts[pts.length - 1];
    if (last.ny >= h)
      return pts;

    let x = last.nx, y = last.ny;
    let dx = last.nx - last.x, dy = last.ny - last.y;
    const len = Math.hypot(dx, dy) || 1;

    // Keep a little of the last leg's sideways drift so the join is not a visible corner, but
    // make sure the channel descends: a segment that was heading up would otherwise never reach
    // the edge.
    dx = (dx / len) * 0.35;
    dy = Math.max(Math.abs(dy / len), 0.6);
    const norm = Math.hypot(dx, dy);
    dx /= norm;
    dy /= norm;

    const step = Math.max(h / 60, 6);
    let guard = 400;
    while (y < h + step && guard-- > 0) {
      const nx = x + dx * step, ny = y + dy * step;
      pts.push({ x, y, nx, ny, w : last.w, t : last.t, a : last.a });
      x = nx;
      y = ny;
    }

    return pts;
  }

  /* ─────────────────────── cloud-to-ground flash ─────────────────────── */

  function generateCG(rng, w, h)
  {
    const trunk = [];
    const branches = [];
    const centre = w * 0.5;
    const margin = w * 0.17; // keep the channel away from the frame edge

    // Push the channel back inside as it nears an edge: a clipped channel reads as a broken bolt.
    function steerInside(off, x)
    {
      if (x < margin) return off + (1 - x / margin) * 0.9;
      if (x > w - margin) return off - (1 - (w - x) / margin) * 0.9;
      return off;
    }

    const trunkShape = {
      segLen : h / 30,
      kink : 1.00,
      zigzag : 0.46,
      spring : 0.20,
      micro : 0.05,
      sub : 3,
      axisDrift : 0.025,
      wander : 0.090,   // the whole channel also snakes across a kilometre, not just its kinks
      hold : true,
    };

    // ── main channel: from the cloud base to the ground ──
    const startX = centre + (rng() - 0.5) * w * 0.09;
    const main = grow(rng, Object.assign({}, trunkShape, {
      x : startX,
      y : -4,
      angle : (rng() - 0.5) * 0.10,
      length : h * 1.08,
      wTop : 4.4,
      wBot : 1.8,
      taperPow : 0.7,
      steer : steerInside,
      bounds : {
        x0 : 0,
        x1 : w,
        y0 : 0,
        y1 : h,
      },
    }));
    trunk.push({pts : extendToGround(main, h), alpha : 1});

    // ── major forks: a CG channel usually splits once (sometimes twice) before it reaches the
    // ground. The fork leaves the trunk high up and diverges slowly, so the classic "Y" still
    // reads at the small size a bolt occupies on screen.
    if (main.length > 40 && rng() < 0.9) {
      const at = main[Math.floor(main.length * (0.08 + rng() * 0.30))];
      const dir = rng() < 0.5 ? -1 : 1;
      const forkAxis = (rng() - 0.5) * 0.10 + dir * (0.12 + rng() * 0.30);
      const fork = grow(rng, Object.assign({}, trunkShape, {
        x : at.x,
        y : at.y,
        angle : forkAxis,
        length : h * (0.55 + rng() * 0.5),
        wTop : at.w * 0.8,
        wBot : 0.8,
        taperPow : 0.75,
        steer : steerInside,
        bounds : {
          x0 : 0,
          x1 : w,
          y0 : 0,
          y1 : h,
        },
      }));
      trunk.push({pts : fork, alpha : 0.95});

      // occasionally a second, shorter fork on the other side
      if (rng() < 0.5) {
        const at2 = main[Math.floor(main.length * (0.14 + rng() * 0.30))];
        const fork2 = grow(rng, Object.assign({}, trunkShape, {
          x : at2.x,
          y : at2.y,
          angle : -dir * (0.15 + rng() * 0.32),
          length : h * (0.30 + rng() * 0.4),
          wTop : at2.w * 0.6,
          wBot : 0.6,
          taperPow : 0.85,
          steer : steerInside,
          bounds : {
            x0 : 0,
            x1 : w,
            y0 : 0,
            y1 : h,
          },
        }));
        trunk.push({pts : fork2, alpha : 0.82});
      }
    }

    // ── branches: a fork tree, dense high up (close to the charge centre) and thinning out
    // toward the ground, which is how a real channel sheds its branches. They also sag: the
    // outward angle they leave at is bent toward straight down over their length.
    const sources = trunk.slice();
    for (let b = 0; b < sources.length; b++) {
      const src = sources[b].pts;
      const skip = Math.max(4, Math.round(src.length / 30));
      for (let i = skip; i < src.length - 2; i += skip) {
        const s = src[i];
        const depth = s.y / h;                            // 0 at the cloud, 1 at the ground
        const chance = 0.42 * Math.pow(1 - depth, 1.8);   // branches die out toward the ground
        if (rng() > chance)
          continue;

        const dir = rng() < 0.5 ? -1 : 1;
        // branches leave downward and outward: a branch that points back up the channel reads
        // as a wire loop, not as lightning
        const baseAngle = dir * (0.45 + rng() * 0.8);
        const len = (0.09 + rng() * 0.19) * h * (1 - depth * 0.45);
        const bW = Math.max(s.w * (0.34 + rng() * 0.30), 0.85);

        const br = grow(rng, {
          x : s.x,
          y : s.y,
          angle : baseAngle,
          length : len,
          wTop : bW,
          wBot : 0.40,
          taperPow : 0.85,
          segLen : h / 48,
          kink : 1.00,
          zigzag : 0.50,
          spring : 0.20,
          micro : 0.05,
          sub : 2,
          axisDrift : 0.04,
          wander : 0.02,
          hold : true,
          // sag toward straight down over the length of the branch
          steer : (off, x, y2) => steerInside(off - Math.sign(baseAngle) * 0.05, x),
          bounds : {
            x0 : 0,
            x1 : w,
            y0 : 0,
            y1 : h,
          },
        });
        branches.push({pts : br, alpha : 0.72 + rng() * 0.28});

        // one level of sub-branches on the longer ones
        if (rng() < 0.30 && br.length > 8) {
          const sub = br[Math.floor(br.length * (0.25 + rng() * 0.4))];
          const br2 = grow(rng, {
            x : sub.x,
            y : sub.y,
            angle : (rng() < 0.5 ? -1 : 1) * (0.55 + rng() * 0.75),
            length : len * (0.30 + rng() * 0.30),
            wTop : bW * 0.55,
            wBot : 0.32,
            taperPow : 0.9,
            segLen : h / 58,
            kink : 1.00,
            zigzag : 0.52,
            spring : 0.18,
            micro : 0.06,
            sub : 2,
            hold : true,
            drift : 0,
            bounds : {
              x0 : 0,
              x1 : w,
              y0 : 0,
              y1 : h,
            },
          });
          branches.push({pts : br2, alpha : 0.45 + rng() * 0.25});
        }
      }
    }

    // ── ground streamers: the upward connecting discharges that rush to meet the descending
    // leader. They live in the branch map, because they are part of the same channel tree; the
    // display shader separates them by their position at the very bottom of the texture.
    const contact = main.length ? main[main.length - 1] : {x : centre, y : h};
    const numStreamers = 4 + Math.floor(rng() * 4);
    for (let i = 0; i < numStreamers; i++) {
      const dir = rng() < 0.5 ? -1 : 1;
      const st = grow(rng, {
        x : contact.x + (rng() - 0.5) * 4,
        y : h + 3,
        angle : Math.PI + dir * (0.10 + rng() * 0.55),
        length : h * (0.025 + rng() * 0.05),
        wTop : 0.9 + rng() * 0.5,
        wBot : 0.3,
        taperPow : 0.9,
        segLen : h / 110,
        kink : 0.5,
        zigzag : 0.68,
        spring : 0.2,
        micro : 0.06,
        sub : 2,
        wander : 0.03,
        bounds : {
          x0 : 0,
          x1 : w,
          y0 : 0,
          y1 : h,
        },
      });
      branches.push({pts : st, alpha : 0.5 + rng() * 0.35});
    }

    return {trunk : trunk, branches : branches};
  }

  /* ──────────────────────── intra-cloud flash ──────────────────────── */
  //
  // An IC discharge never leaves the cloud: it crawls horizontally through the charge layer.
  // What reaches the eye is the cloud lighting up from inside plus, where the cloud base is
  // thin, a network of horizontal filaments (the "spider lightning" seen under a storm base).

  function generateIC(rng, w, h)
  {
    const crawlers = [];

    // The network is drawn into a band near the top of the map, because that is where the shader
    // looks for it: it is mapped onto a sheet a few hundred metres thick, not onto the full height
    // of the flash. The band is wider than it needs to be on screen on purpose — the display
    // squashes it about four to one to get the flat, layered look of a real discharge, so the map
    // has to carry vertical detail for it to have anything to squash.
    const bandY = h * 0.26;         // centre of the charge layer
    const bandTop = h * 0.04;
    const bandBottom = h * 0.50;

    // Steering pulls the path back into the layer and away from the edges. The vertical term is
    // the weak one: a real in-cloud channel meanders freely inside the layer, and forcing it to
    // the centre line is what made every filament a straight horizontal rule.
    function steerBand(off, x, y, axis)
    {
      // Which way is "up" depends on which way the lane runs. `grow` turns the heading by adding
      // to the offset, so a positive offset lifts a lane that runs right but drops a lane that
      // runs left; steering that ignores this pushes a lane that has drifted out of the layer
      // further out.
      const sgn = Math.sin(axis) >= 0 ? 1 : -1;
      const over = y > bandBottom ? y - bandBottom : y < bandTop ? y - bandTop : 0;
      const edge = w * 0.07;
      let o = off + sgn * over * 0.05;
      if (x < edge)
        o += (1 - x / edge) * 0.6;
      if (x > w - edge)
        o -= (1 - (w - x) / edge) * 0.6;
      return o;
    }

    const bounds = {
      x0 : 0,
      x1 : w,
      y0 : bandTop,
      y1 : bandBottom,
    };

    // Settings shared by every segment of the network. The jitter is deliberately large: `kink`
    // sets how far each leg swings off the axis and `wander` how fast the axis itself turns, so a
    // filament crosses the layer several times over its length instead of running along it.
    function channel(len, width, angle)
    {
      return {
        angle : angle,
        length : len,
        // Strokes are deliberately fat. The display reads this map about two and a half to one
        // smaller vertically than horizontally, so a one pixel filament averages down to a third
        // of its coverage and the network dissolves into speckle. Three to five pixels wide in
        // the map survives that and lands as a thin bright line on screen.
        wTop : width,
        wBot : Math.max(0.7, width * 0.30),
        taperPow : 0.75,
        segLen : h / 150,
        // `hold` gives the angular geometry real channels have: a long straight run, a sharp
        // turn, another run. Smooth meandering (spring damping) is what made these read as soft
        // wavy lines rather than as lightning.
        hold : true,
        kink : 0.85,
        zigzag : 0.55,
        micro : 0.02,
        sub : 3,
        axisDrift : 0.010,
        wander : 0.030,
        steer : steerBand,
        bounds : bounds,
      };
    }

    // One channel plus its sub-branches, recursively. Real intra-cloud flashes are trees: a
    // handful of trunk channels radiating through the layer, each throwing off forks, each fork
    // throwing off its own. Two levels of recursion is what turns a few smooth strokes into a
    // network — the tips are thinner, shorter and dimmer, so the eye reads depth in it.
    function branch(x, y, angle, len, width, depth, alpha)
    {
      const o = channel(len, width, angle);
      o.x = x;
      o.y = y;
      const pts = grow(rng, o);
      if (pts.length < 2)
        return;

      crawlers.push({pts : pts, alpha : alpha});

      if (depth <= 0 || pts.length < 4)
        return;

      const forks = 2 + Math.floor(rng() * 3);
      for (let f = 0; f < forks; f++) {
        // A fork leaves from somewhere along the parent, not always from its middle, and turns
        // by a wide angle: real branches split at 30 to 80 degrees, not a few degrees.
        const at = 0.25 + rng() * 0.7;
        const s = pts[Math.min(pts.length - 1, Math.floor(at * pts.length))];
        const turn = (rng() < 0.5 ? -1 : 1) * (0.5 + rng() * 0.95);
        branch(s.nx, s.ny, angle + turn,
               len * (0.30 + rng() * 0.30),
               Math.max(0.8, width * (0.45 + rng() * 0.20)),
               depth - 1,
               alpha * (0.55 + rng() * 0.35));
      }
    }

    // Trunks radiate from a common region, which is what makes spider lightning look like a crown
    // rather than like a set of parallel scratches.
    const trunks = 10 + Math.floor(rng() * 5);
    for (let t = 0; t < trunks; t++) {
      const dir = t % 2 === 0 ? 1 : -1;
      const spread = (rng() - 0.5) * 1.30; // up to ~37 degrees off horizontal
      const x = w * 0.5 + (rng() - 0.5) * w * 0.30;
      const y = bandY + (rng() - 0.5) * h * 0.26;
      branch(x, y, dir * Math.PI * 0.5 + spread,
             w * (0.12 + rng() * 0.26),
             2.6 + rng() * 1.2,
             2,
             0.8 + rng() * 0.2);
    }

    // A few shorter channels tying the crown together, so it reads as one network rather than as
    // separate flashes that happen to be next to each other.
    for (let b = 0; b < 6; b++)
      branch(w * (0.15 + rng() * 0.7), bandY + (rng() - 0.5) * h * 0.30,
             (rng() < 0.5 ? -1 : 1) * (0.2 + rng() * 1.1),
             w * (0.08 + rng() * 0.16),
             1.5 + rng() * 0.8,
             1,
             0.40 + rng() * 0.35);

    return {crawlers : crawlers};
  }

  /* ───────────────────────────── rendering ───────────────────────────── */

  function renderLayers(width, height, seed, ss)
  {
    const rng = mulberry32(seed);

    const cg = generateCG(rng, width, height);
    const ic = generateIC(rng, width, height);

    const out = new Uint8ClampedArray(width * height * 4);

    // One supersampled scratch canvas and one final-size canvas are reused for every layer:
    // four full-size canvases would cost four times the memory of the whole texture.
    const big = makeCanvas(width * ss, height * ss);
    const bigCtx = big.getContext('2d');
    const small = makeCanvas(width, height);
    const smallCtx = small.getContext('2d');
    smallCtx.imageSmoothingEnabled = true;
    smallCtx.imageSmoothingQuality = 'high';

    function bake(channel, paint)
    {
      bigCtx.setTransform(1, 0, 0, 1, 0, 0);
      bigCtx.clearRect(0, 0, big.width, big.height);
      bigCtx.setTransform(ss, 0, 0, ss, 0, 0);
      bigCtx.lineCap = 'round';
      bigCtx.lineJoin = 'round';
      bigCtx.strokeStyle = '#fff';
      paint(bigCtx);

      smallCtx.clearRect(0, 0, width, height);
      smallCtx.drawImage(big, 0, 0, width, height);
      const src = smallCtx.getImageData(0, 0, width, height).data;

      // The alpha of the layer is its coverage; the colour is always white.
      for (let i = 0; i < out.length; i += 4)
        out[i + channel] = src[i + 3];
    }

    // R — cloud-to-ground trunk (the return-stroke channel)
    bake(0, (g) => {
      for (const p of cg.trunk)
        strokePath(g, p.pts, 1, p.alpha);
    });

    // G — cloud-to-ground branches and ground streamers, plus a soft sheath around the trunks
    // (the shader uses that sheath to give the main channel a little width)
    bake(1, (g) => {
      for (const p of cg.trunk)
        strokePath(g, p.pts, 2.2, 0.16 * p.alpha);
      for (const p of cg.branches)
        strokePath(g, p.pts, 1, p.alpha);
    });

    // B — intra-cloud crawlers
    bake(2, (g) => {
      for (const p of ic.crawlers)
        strokePath(g, p.pts, 1, p.alpha);
    });

    // A stays fully opaque: the texture is never blended, and a premultiplying upload path
    // must not be able to scale the colour channels down.
    for (let i = 3; i < out.length; i += 4)
      out[i] = 255;

    return out;
  }

  /* ────────────────────────────── public ────────────────────────────── */

  // width / height in pixels, seed for the variant. Returns an object with an RGBA buffer.
  function generateLightningBolt(width, height, seed, supersample)
  {
    width = Math.max(8, Math.round(width || 512));
    height = Math.max(8, Math.round(height || 1024));
    seed = seed === undefined ? 1 : seed;
    const ss = supersample || 2;
    const data = renderLayers(width, height, seed, ss);
    return {data : data, width : width, height : height};
  }

  scope.generateLightningBolt = generateLightningBolt;

  // Worker entry point. `importScripts` only exists in a worker scope, which keeps the message
  // handler from being registered when the file is loaded as a normal script.
  if (typeof scope.importScripts === 'function' && typeof scope.document === 'undefined') {
    scope.onmessage = function (event)
    {
      const msg = event.data || {};
      const img = generateLightningBolt(msg.width, msg.height, msg.seed, msg.supersample);
      scope.postMessage(img, [img.data.buffer]);
    };
  }
})(typeof self !== 'undefined' ? self : this);
