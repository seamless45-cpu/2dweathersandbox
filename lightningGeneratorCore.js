function generateLightningBoltImageData(width, height, createCanvas)
{
  const lightningCanvas = createCanvas(width, height);
  const ctx = lightningCanvas.getContext('2d');

  ctx.clearRect(0, 0, width, height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'lighter';

  const maxBranches = 320;
  const maxDepth = 4;
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

  function addBolt(startX, startY, targetAngle, baseWidth, depth, isMain)
  {
    const points = [];

    let x = startX;
    let y = startY;
    let angle = targetAngle + rand(-0.22, 0.22);
    let w = baseWidth;

    let life = isMain ? 100000 : Math.floor(rand(35, 150));

    const stepBase = isMain ? 5.2 : 3.6;

    points.push({ x, y, w });

    while (y < height + 25 && life-- > 0 && w > 0.12)
    {
      // Small fast jitter.
      angle += rand(-0.42, 0.42);

      // Occasional sharper kink, more like real discharge paths.
      if (Math.random() < 0.14)
      {
        angle += rand(-0.95, 0.95);
      }

      // Keep the bolt moving in its general direction.
      angle -= (angle - targetAngle) * (isMain ? 0.10 : 0.065);

      // Soft horizontal containment so it does not drift too far offscreen.
      if (x < width * 0.12) angle += 0.16;
      if (x > width * 0.88) angle -= 0.16;

      const step = stepBase * rand(0.65, 1.55);

      x += Math.sin(angle) * step;
      y += Math.cos(angle) * step;

      // Gradual taper.
      w *= isMain ? 0.9968 : 0.9885;

      // Slight width flicker.
      points.push({
        x,
        y,
        w: w * rand(0.92, 1.08)
      });

      const verticalBias = clamp(1.0 - y / height, 0.12, 1.0);
      const branchChance = (isMain ? 0.085 : 0.020) * verticalBias;

      if (branchCount < maxBranches && depth < maxDepth && Math.random() < branchChance)
      {
        branchCount++;

        const branchAngle = targetAngle + rand(-1.25, 1.25);
        const branchWidth = Math.max(0.22, w * rand(0.28, 0.56));

        addBolt(
          x,
          y,
          branchAngle,
          branchWidth,
          depth + 1,
          false
        );
      }
    }

    if (points.length > 1)
    {
      bolts.push({
        points,
        main: isMain,
        alpha: isMain ? 1.0 : clamp(0.9 - depth * 0.18, 0.22, 0.9)
      });
    }
  }

  // Main bolt starts near the top center.
  addBolt(
    width * 0.5,
    -4,
    0,
    Math.max(2.75, width * 0.012),
    0,
    true
  );

  function strokeSegment(a, b, lineWidth, strokeStyle)
  {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineWidth = Math.max(0.1, lineWidth);
    ctx.strokeStyle = strokeStyle;
    ctx.stroke();
  }

  function renderBolt(bolt)
  {
    const passes = bolt.main
      ? [
          // Outer halo.
          { scale: 0.0, alpha: 0.026, color: '85,110,255' },
          { scale: 0.0,  alpha: 0.052, color: '115,145,255' },

          // Mid glow.
          { scale: 2.8,  alpha: 0.10,  color: '175,200,255' },

          // Hot inner channel.
          { scale: 1.35, alpha: 0.26,  color: '230,240,255' },

          // White core.
          { scale: 1.72, alpha: 0.88,  color: '255,255,255' }
        ]
      : [
          // Branches are softer and thinner.
          { scale: 7.5,  alpha: 0.018, color: '85,110,255' },
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
        const alpha = pass.alpha * bolt.alpha;

        strokeSegment(
          a,
          b,
          averageWidth * pass.scale,
          `rgba(${pass.color}, ${alpha})`
        );
      }
    }
  }

  // Draw branches first, then the main bolt on top.
  for (const bolt of bolts)
  {
    if (!bolt.main)
    {
      renderBolt(bolt);
    }
  }

  for (const bolt of bolts)
  {
    if (bolt.main)
    {
      renderBolt(bolt);
    }
  }

  return ctx.getImageData(0, 0, width, height);
}
