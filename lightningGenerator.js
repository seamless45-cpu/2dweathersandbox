// Fresh lightning bolt generator.
//
// A single jagged, tapering main leader (thick at the top, thin at the tip) with
// a few short, thin, jagged branches that taper to a point. The whole thing is
// drawn in pure grayscale on an OffscreenCanvas; the display and lighting shaders
// tint it (violet) and add the soft glow via the ambient/blur pass — so there is
// NO baked-in glow or colour in the texture, and the bolt stays crisp and thin.

onmessage = (event) => {
  const msg = event.data;
  postMessage(generateLightningBolt(msg.width, msg.height));
};

function generateLightningBolt(width, height) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const mainColor = 'rgb(255,255,255)'; // the channel (bright; the display tints it violet)
  const branchColor = 'rgb(246,246,246)'; // a touch softer, still above the display threshold

  // One jagged, tapering channel from (x, y) running downward.
  function drawChannel(x, y, widthTop, widthBottom, jag, color, branchChance, branchWidth) {
    let angle = (Math.random() - 0.5) * 0.6;          // slight initial lean
    const targetAngle = (Math.random() - 0.5) * 0.35; // the lean it drifts back toward
    while (y < height) {
      const step = 2.5 + Math.random() * 3.5;         // short, irregular steps
      angle += (Math.random() - 0.5) * jag;           // strong zig-zag
      angle -= (angle - targetAngle) * 0.09;          // steer gently back on course
      const nx = x + Math.sin(angle) * step;
      const ny = y + Math.cos(angle) * step;
      const depth = Math.min(ny / height, 1.0);
      ctx.lineWidth = widthTop + (widthBottom - widthTop) * depth; // taper with depth
      ctx.strokeStyle = color;                          // reset (a branch may have changed it)
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(nx, ny);
      ctx.stroke();
      x = nx; y = ny;

      if (branchChance > 0 && Math.random() < branchChance * (1.0 - depth)) {
        drawBranch(x, y, targetAngle + (Math.random() - 0.5) * 1.7,
                   branchWidth * (0.6 + Math.random() * 0.8));
      }
    }
  }

  // A short, thin, jagged branch that tapers to a point.
  function drawBranch(x, y, baseAngle, widthTop) {
    let angle = baseAngle;
    const startY = y;
    const len = (0.12 + Math.random() * 0.22) * height; // branches are short
    const endY = y + len;
    ctx.strokeStyle = branchColor;
    while (y < endY) {
      const step = 2.5 + Math.random() * 3.5;
      angle += (Math.random() - 0.5) * 0.8;             // jagged
      angle -= (angle - baseAngle) * 0.10;              // drift back toward the base lean
      const nx = x + Math.sin(angle) * step;
      const ny = y + Math.cos(angle) * step;
      const t = Math.min((ny - startY) / len, 1.0);
      ctx.lineWidth = Math.max(widthTop * (1.0 - t * 0.85), 0.4); // taper to a point
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(nx, ny);
      ctx.stroke();
      x = nx; y = ny;
    }
  }

  // the main leader: thick at the top, tapering to a thin tip near the bottom
  drawChannel(width / 2.0, 0, 7.0, 2.0, 0.7, mainColor, 0.03, 2.4);

  return ctx.getImageData(0, 0, width, height);
}
