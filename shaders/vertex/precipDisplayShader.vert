#version 300 es
precision highp float;

// Instanced sprite quad:
//   loc 0  corner        per-vertex  [-1, +1]
//   loc 1  dropPosition  per-instance
//   loc 2  mass          per-instance  [water, ice]
//   loc 3  density       per-instance

layout(location = 0) in vec2 corner;
layout(location = 1) in vec2 dropPosition;
layout(location = 2) in vec2 mass; // [0] water   [1] ice
layout(location = 3) in float density;

out vec2 position_out; // sprite-local UV in [-1, +1]
flat out vec2 mass_out;
flat out float density_out;
flat out float flakeSeed;

uniform vec2 aspectRatios; // sim   canvas
uniform vec3 view;         // Xpos  Ypos    Zoom
uniform vec2 canvasSize;   // pixels
uniform float wrapShift;   // -2 / 0 / +2 when the world is tiled

uniform sampler2D baseTex;

#define WATER 0
#define ICE   1

void main()
{
  mass_out = mass;
  density_out = density;
  flakeSeed = float(gl_InstanceID);
  position_out = corner;

  // Inactive droplets stay in the TF buffer; skip them cheaply.
  if (mass[WATER] < 0.0) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
    return;
  }

  float mW = max(mass[WATER], 0.0);
  float mI = max(mass[ICE], 0.0);
  float totalMass = max(mW + mI, 1e-4);
  float massScale = 0.72 + 0.55 * sqrt(totalMass / 0.15);

  // Side-view sprites: rain is a tall streak, snow/hail stay closer to square.
  float baseSize = 5.0;
  vec2 spriteScale = vec2(1.0);
  float windTilt = 0.0;

  if (mI > 0.0 && mW == 0.0) {
    if (density >= 0.999) { // hail
      baseSize = 3.4 * massScale;
      spriteScale = vec2(1.0);
    } else { // snow
      baseSize = 7.2 * massScale;
      spriteScale = vec2(1.05);
    }
  } else if (mI > 0.0) { // melting / wet snow
    baseSize = 5.6 * massScale;
    spriteScale = vec2(0.62, 1.35);
  } else { // rain
    baseSize = 4.8 * massScale;
    spriteScale = vec2(0.32, 2.55);

    vec2 texCoord = dropPosition * 0.5 + 0.5;
    vec4 air = texture(baseTex, texCoord);
    windTilt = clamp(air.x * 14.0, -0.85, 0.85);
  }

  vec2 outpos = dropPosition;
  outpos.x += wrapShift;
  outpos.x += view.x;
  outpos.y += view.y * aspectRatios[0];
  outpos *= view[2]; // zoom
  outpos.y *= aspectRatios[1] / aspectRatios[0];

  // Match the old gl_PointSize = zoom * size / simAspect conversion,
  // but as a true quad so it works on mobile (gl_PointSize is unreliable).
  float pointPx = view[2] * baseSize / max(aspectRatios[0], 1e-4);
  vec2 halfExtent = vec2(pointPx / max(canvasSize.x, 1.0), pointPx / max(canvasSize.y, 1.0));

  vec2 maxHalf = halfExtent * vec2(abs(spriteScale.x) + abs(windTilt * spriteScale.y), abs(spriteScale.y));
  if (abs(outpos.x) > 1.0 + maxHalf.x || abs(outpos.y) > 1.0 + maxHalf.y) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
    return;
  }

  vec2 local = corner * spriteScale;
  local.x += local.y * windTilt;

  gl_Position = vec4(outpos + local * halfExtent, 0.0, 1.0);
}
