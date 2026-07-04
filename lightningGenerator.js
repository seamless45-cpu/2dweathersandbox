onmessage = (event) => {
  const msg = event.data;
  // console.log(msg);
  let imgElement = generateLightningBolt(msg.width, msg.height);
  postMessage(imgElement);
};


function generateLightningBolt(width, height)
{
  // Fallback for browsers that don't support OffscreenCanvas (e.g., iOS Safari)
  let canvas;
  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(width, height);
  } else {
    // Fallback: use simple pixel manipulation
    canvas = {
      width: width,
      height: height,
      getContext: function(type) {
        return createCanvasContext(width, height, type);
      }
    };
  }
  
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, width, height);


  function genLightningColor(lineWidth)
  {
    const colR = 12;
    const colG = 12;
    const colB = 12;
    const brightness = Math.pow(lineWidth, 2.0);
    return `rgb(${colR * brightness}, ${colG * brightness}, ${colB * brightness})`;
  }


  ctx.beginPath();

  let startX = width / 2.0;
  let startY = 0;
  let angle = Math.PI / 6.;
  let lineWidth = 9.0;
  const targetAngle = 0.0;
  const maxBranches = 96;
  let numBranches = 0;

  ctx.moveTo(startX, startY);

  ctx.lineWidth = lineWidth;

  while (startY < height) {

    const nextX = startX + Math.sin(angle);
    const nextY = startY + Math.cos(angle);

    angle += (Math.random() - 0.7) * 1.4;  // 0.7

    angle -= (angle - targetAngle) * 0.07; // keep it going in a general direction

    ctx.lineTo(nextX, nextY);

    startX = nextX;
    startY = nextY;


    if (numBranches < maxBranches && Math.random() < 0.052 * (1. - nextY / height)) { // branch
      ctx.strokeStyle = genLightningColor(lineWidth);
      ctx.stroke();
      numBranches++;
      drawBranch(nextX, nextY, targetAngle + (Math.random() - 0.5) * 2.5, lineWidth * 0.5 * Math.random());
      ctx.beginPath();
      ctx.moveTo(nextX, nextY); // move back to last position after drawing branch
      ctx.lineWidth = lineWidth;
    }
  }
  ctx.strokeStyle = genLightningColor(lineWidth);
  ctx.stroke();


  // Get the image data
  const imgData = ctx.getImageData(0, 0, width, height);
  
  // Return in a format that works across all devices
  return {
    data: imgData.data,
    width: width,
    height: height
  };


  function drawBranch(startX, startY, targetAngle, line_width)
  {
    let angle = targetAngle;

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineWidth = line_width;

    while (startY < height) {

      const nextX = startX + Math.sin(angle);
      const nextY = startY + Math.cos(angle);

      angle += (Math.random() - 0.5) * 1.4;

      angle -= (angle - targetAngle) * 0.08; // keep it going in a general direction

      ctx.lineTo(nextX, nextY);

      startX = nextX;
      startY = nextY;

      if (Math.random() < 0.001) { // reduce width

        ctx.strokeStyle = genLightningColor(line_width);
        ctx.stroke();
        line_width -= 0.2;

        if (line_width < 0.1)
          return;

        if (numBranches < maxBranches && Math.random() < 0.25) { // secondary branch

          numBranches++;
          drawBranch(nextX, nextY, targetAngle + (Math.random() - 0.5) * 1.5, line_width);
        }

        ctx.beginPath();
        ctx.moveTo(nextX, nextY); // move back to last position after drawing branch
        ctx.lineWidth = line_width;
      }
    }
    ctx.strokeStyle = genLightningColor(line_width);
    ctx.stroke();
  }
}


// Fallback canvas context implementation for browsers without OffscreenCanvas
function createCanvasContext(width, height, type) {
  if (type !== '2d') {
    throw new Error('Only 2D context is supported in fallback mode');
  }
  
  const imageData = new Uint8ClampedArray(width * height * 4);
  const data = imageData;
  
  // Initialize with transparent black
  for (let i = 3; i < data.length; i += 4) {
    data[i] = 255; // alpha channel
  }
  
  return {
    canvas: { width, height },
    lineWidth: 1,
    strokeStyle: '#000',
    fillStyle: '#000',
    
    clearRect(x, y, w, h) {
      for (let py = Math.floor(y); py < Math.floor(y + h) && py < height; py++) {
        for (let px = Math.floor(x); px < Math.floor(x + w) && px < width; px++) {
          const idx = (py * width + px) * 4;
          data[idx] = 0;
          data[idx + 1] = 0;
          data[idx + 2] = 0;
          data[idx + 3] = 255;
        }
      }
    },
    
    beginPath() {
      this.path = [];
    },
    
    moveTo(x, y) {
      this.path = [{ x, y, cmd: 'M' }];
    },
    
    lineTo(x, y) {
      if (!this.path) this.path = [];
      this.path.push({ x, y, cmd: 'L' });
    },
    
    stroke() {
      if (!this.path || this.path.length < 2) return;
      
      const color = this._parseColor(this.strokeStyle);
      
      for (let i = 0; i < this.path.length - 1; i++) {
        const p1 = this.path[i];
        const p2 = this.path[i + 1];
        this._drawLine(p1.x, p1.y, p2.x, p2.y, this.lineWidth, color);
      }
    },
    
    getImageData(x, y, w, h) {
      const result = new Uint8ClampedArray(w * h * 4);
      for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
          const srcIdx = ((py + y) * width + (px + x)) * 4;
          const dstIdx = (py * w + px) * 4;
          result[dstIdx] = data[srcIdx];
          result[dstIdx + 1] = data[srcIdx + 1];
          result[dstIdx + 2] = data[srcIdx + 2];
          result[dstIdx + 3] = data[srcIdx + 3];
        }
      }
      return { data: result, width: w, height: h };
    },
    
    _parseColor(color) {
      const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      if (match) {
        return {
          r: parseInt(match[1]),
          g: parseInt(match[2]),
          b: parseInt(match[3])
        };
      }
      return { r: 0, g: 0, b: 0 };
    },
    
    _drawLine(x1, y1, x2, y2, lineWidth, color) {
      const dx = Math.abs(x2 - x1);
      const dy = Math.abs(y2 - y1);
      const sx = x1 < x2 ? 1 : -1;
      const sy = y1 < y2 ? 1 : -1;
      let err = dx - dy;
      
      const thickness = Math.max(1, Math.ceil(lineWidth));
      
      let x = x1;
      let y = y1;
      
      while (true) {
        // Draw thickened line
        for (let lx = -Math.floor(thickness / 2); lx < Math.ceil(thickness / 2); lx++) {
          for (let ly = -Math.floor(thickness / 2); ly < Math.ceil(thickness / 2); ly++) {
            const px = Math.floor(x + lx);
            const py = Math.floor(y + ly);
            if (px >= 0 && px < width && py >= 0 && py < height) {
              const idx = (py * width + px) * 4;
              data[idx] = color.r;
              data[idx + 1] = color.g;
              data[idx + 2] = color.b;
              data[idx + 3] = 255;
            }
          }
        }
        
        if (x === x2 && y === y2) break;
        const e2 = 2 * err;
        if (e2 > -dy) {
          err -= dy;
          x += sx;
        }
        if (e2 < dx) {
          err += dx;
          y += sy;
        }
      }
    }
  };
}
