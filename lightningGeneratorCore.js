function generateLightningBoltImageData(width, height, createCanvas)
{
  // ── Input validation ──────────────────────────────────────────────
  width  = Math.floor(width)  || 0;
  height = Math.floor(height) || 0;

  if (width < 1 || height < 1 || width > 8192 || height > 8192)
  {
    throw new RangeError(
      `Invalid canvas dimensions: ${width}×${height}. Must be 1–8192.`
    );
  }

  if (typeof createCanvas !== 'function')
  {
    throw new TypeError('createCanvas must be a function.');
  }

  const lightningCanvas = createCanvas(width, height);
  const ctx = lightningCanvas && lightningCanvas.getContext('2d');

  if (!ctx)
  {
    throw new Error('Failed to obtain a 2D rendering context.');
  }

  // ── Setup ─────────────────────────────────────────────────────────
  ctx.clearRect(0, 0, width, height);
  ctx.lineCap  = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'lighter';

  const MAX_BRANCHES   = 260;   // reduced from 320 to limit total strokes
  const MAX_DEPTH      = 4;
  const MAX_MAIN_STEPS = 4000;  // hard cap so the main loop always terminates
  let branchCount = 0;
  const bolts = [];

  function rand(min, max)
  {
    return min + Math.random() * (max - min);
  }

  function clamp(value, min, max)
  {
    return Math.min(max, Math.max(min, value));
  }

  // ── Bolt generation (iterative-safe recursion, depth-limited) ─────
  function addBolt(startX, startY, targetAngle, baseWidth, depth, isMain)
  {
    if (depth > MAX_DEPTH) return;

    const points = [];

    let x     = startX;
    let y     = startY;
    let angle = targetAngle + rand(-0.22, 0.22);
    let w     = baseWidth;

    const life     = isMain ? MAX_MAIN_STEPS : Math.floor(rand(35, 150));
    const stepBase = isMain ? 5.2 : 3.6;
    let   steps    = 0;

    points.push({ x, y, w });

    while (y < height + 25 && steps < life && w > 0.12)
    {
      steps++;

      angle += rand(-0.42, 0.42);

      if (Math.random() < 0.14)
      {
        angle += rand(-0.95, 0.95);
      }

      // Pull back toward the intended direction.
      angle -= (angle - targetAngle) * (isMain ? 0.10 : 0.065);

      // Horizontal containment.
      if (x < width * 0.12) angle += 0.16;
      if (x > width * 0.88) angle -= 0.16;

      const step = stepBase * rand(0.65, 1.55);

      x += Math.sin(angle) * step;
      y += Math.cos(angle) * step;

      w *= isMain ? 0.9968 : 0.9885;

      points.push({ x, y, w: w * rand(0.92, 1.08) });

      // Branching.
      const verticalBias = clamp(1.0 - y / height, 0.12, 1.0);
      const branchChance = (isMain ? 0.085 : 0.020) * verticalBias;

      if (branchCount < MAX_BRANCHES && depth < MAX_DEPTH && Math.random() < branchChance)
      {
        branchCount++;
        addBolt(
          x, y,
          targetAngle + rand(-1.25, 1.25),
          Math.max(0.22, w * rand(0.28, 0.56)),
          depth + 1,
          false
        );
      }
    }

    if (points.length > 1)
    {
      bolts.push({
        points,
        main:  isMain,
        alpha: isMain ? 1.0 : clamp(0.9 - depth * 0.18, 0.22, 0.9)
      });
    }
  }

  addBolt(width * 0.5, -4, 0, Math.max(2.75, width * 0.012), 0, true);

  // ── Rendering ─────────────────────────────────────────────────────
  function strokeSegment(a, b, lineWidth, strokeStyle)
  {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineWidth   = Math.max(0.1, lineWidth);
    ctx.strokeStyle = strokeStyle;
    ctx.stroke();
  }

  function renderBolt(bolt)
  {
    const passes = bolt.main
      ? [
          // Outer halo  (fixed: was scale 0.0 → invisible / degenerate)
          { scale: 9.0,  alpha: 0.026, color: '85,110,255'  },
          { scale: 6.0,  alpha: 0.052, color: '115,145,255' },

          // Mid glow
          { scale: 2.8,  alpha: 0.10,  color: '175,200,255' },

          // Hot inner channel
          { scale: 1.35, alpha: 0.26,  color: '230,240,255' },

          // White core
          { scale: 1.72, alpha: 0.88,  color: '255,255,255' }
        ]
      : [
          { scale: 7.5,  alpha: 0.018, color: '85,110,255'  },
          { scale: 5.2,  alpha: 0.045, color: '125,155,255' },
          { scale: 1.55, alpha: 0.11,  color: '195,215,255' },
          { scale: 0.68, alpha: 0.52,  color: '255,255,255' }
        ];

    for (const pass of passes)
    {
      for (let i = 0; i < bolt.points.length - 1; i++)
      {
        const a = bolt.points[i];
        const b = bolt.points[i + 1];
        const averageWidth = (a.w + b.w) * 0.5;

        strokeSegment(
          a, b,
          averageWidth * pass.scale,
          `rgba(${pass.color}, ${(pass.alpha * bolt.alpha).toFixed(4)})`
        );
      }
    }
  }

  // Branches first, main bolt on top.
  for (const bolt of bolts) { if (!bolt.main) renderBolt(bolt); }
  for (const bolt of bolts) { if ( bolt.main) renderBolt(bolt); }

  return ctx.getImageData(0, 0, width, height);
}
