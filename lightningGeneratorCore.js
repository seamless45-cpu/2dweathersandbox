/**
 * Generates one pre-baked lightning bolt image (512x1024) used by the sim.
 *
 * Reworked version:
 *  · Branches are fixed: they peel off the main bolt at a proper outward angle,
 *    always keep moving downward, taper gradually (instead of collapsing to
 *    nothing after a few steps) and stop cleanly when they get too thin.
 *  · Branch iterations are set to 1: branches only ever spawn from the main
 *    bolt, never from other branches (no recursive sub-branching).
 *  · Rendering is a single iteration: one stroke pass per segment, with the
 *    glow coming from the canvas shadow instead of 3 redundant passes.
 */

// how many generations of branching are allowed (1 = branches only grow off the main bolt)
const BRANCH_ITERATIONS = 1;
// how many render passes are drawn over the segment list
const RENDER_ITERATIONS = 1;

function generateLightningBoltImageData(width, height, createCanvas)
{
  const lightningCanvas = createCanvas(width, height);
  const ctx = lightningCanvas.getContext('2d');

  ctx.clearRect(0, 0, width, height);

  // Store all segments so the glow + core come from a single render iteration
  const segments = [];

  function addSegment(x1, y1, x2, y2, lineWidth, isMainBolt) { segments.push({ x1, y1, x2, y2, lineWidth, isMainBolt }); }

  // Real lightning: hot white core with a blue-violet atmospheric glow
  function getCoreColor(w) {
    const intensity = Math.min(1, w / 4);
    const r = Math.floor(225 + 30 * intensity);
    const g = Math.floor(238 + 17 * intensity);
    return `rgb(${r}, ${g}, 255)`;
  }

  // ─── Main Bolt ───
  let currX = width / 2.0 + (Math.random() - 0.5) * width * 0.2;
  let currY = 0;
  let angle = (Math.random() - 0.5) * 0.4;   // Start nearly vertical
  let lineWidth = 5.0 + Math.random() * 3.0; // Slightly varied thickness
  const maxBranches = 26;
  let numBranches = 0;

  while (currY < height) {
    // Variable step size creates sharp zigzags instead of smooth curves
    const step = 2 + Math.random() * 6;

    // Jagged randomness with a strong pull back to vertical
    angle += (Math.random() - 0.5) * 1.4;
    angle -= angle * 0.2;

    const nextX = currX + Math.sin(angle) * step;
    const nextY = currY + Math.cos(angle) * step;

    addSegment(currX, currY, nextX, nextY, lineWidth, true);

    // Branching: more frequent in the upper 60% of the bolt, rare near ground
    const heightFactor = 1 - (currY / height) * 0.7;
    if (numBranches < maxBranches && Math.random() < 0.05 * heightFactor) {
      numBranches++;
      // Branches peel off to the side and keep moving downward
      const side = Math.random() < 0.5 ? -1 : 1;
      const branchAngle = side * (0.35 + Math.random() * 0.65);
      const branchWidth = lineWidth * (0.40 + Math.random() * 0.35);
      const branchLength = (height - nextY) * (0.25 + Math.random() * 0.35);
      drawBranch(nextX, nextY, branchAngle, branchWidth, branchLength, 1);
    }

    currX = nextX;
    currY = nextY;
  }

  // ─── Branch Generator ───
  function drawBranch(x, y, angle, w, remainingLength, generation)
  {
    if (generation > BRANCH_ITERATIONS)
      return; // iteration limit reached: no further branching

    let traveled = 0;

    while (y < height && w > 0.5 && traveled < remainingLength) {
      const step = 2 + Math.random() * 5;

      // Erratic wiggle, but clamped so the branch always travels downward
      angle += (Math.random() - 0.5) * 0.9;
      angle = Math.max(-1.25, Math.min(1.25, angle));

      const nextX = x + Math.sin(angle) * step;
      const nextY = y + Math.cos(angle) * step;

      addSegment(x, y, nextX, nextY, w, false);

      // Gradual taper keeps branches visible for their whole length
      w *= 0.965;
      traveled += step;

      x = nextX;
      y = nextY;
    }
  }

  // ─── Render (single iteration: core stroke, glow via canvas shadow) ───
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(120, 165, 255, 0.85)';
  ctx.shadowBlur = 12;

  for (let pass = 0; pass < RENDER_ITERATIONS; pass++) {
    for (const s of segments) {
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.lineWidth = Math.max(0.6, s.lineWidth);
      ctx.strokeStyle = getCoreColor(s.lineWidth);
      ctx.stroke();
    }
  }

  return ctx.getImageData(0, 0, width, height);
}
