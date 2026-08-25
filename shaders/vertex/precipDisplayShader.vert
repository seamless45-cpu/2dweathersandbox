#version 300 es
precision highp float;

// Per-vertex sprite corner in [-1, 1] (bound to attribute location 0 by the
// instanced display VAO). Each droplet instance expands this into a quad.
layout(location = 0) in vec2 a_quadCoord;

// Per-instance droplet state (bound to attribute locations 1..3).
layout(location = 1) in vec2 dropPosition; // sim position in [-1, 1]
layout(location = 2) in vec2 mass;         // [0] water   [1] ice
layout(location = 3) in float density;

out vec2 position_out;
out vec2 mass_out;
out float density_out;
out vec2 quadCoord_out; // [-1,1] within the sprite, for a round falloff

uniform vec2 texelSize;
uniform vec2 aspectRatios; // [0] sim aspect   [1] canvas aspect
uniform vec3 view;         // [0] Xpos   [1] Ypos   [2] Zoom
uniform vec2 canvasSize;
uniform float wrapShift; // shifts the whole band horizontally for wrap copies

void main()
{
  vec2 outpos = dropPosition;

  outpos.x += wrapShift; // render wrapped copies when the map wraps horizontally
  outpos.x += view.x;
  outpos.y += view.y * aspectRatios[0];

  outpos *= view[2]; // zoom

  outpos.y *= aspectRatios[1] / aspectRatios[0];

  // The previous (point-sprite) version sized drops with
  //   gl_PointSize = view[2] * 4.0 / aspectRatios[0];
  // Replicate that size in clip space for the instanced quad. The corner
  // coordinate already runs from -1 to 1, so one multiplication covers the
  // full sprite diameter.
  float sizePx = view[2] * 4.0 / aspectRatios[0];
  // Convert pixel size to clip-space size on each axis; divide Y by the canvas
  // aspect ratio so the sprite stays circular on non-square viewports.
  vec2 quadOffset = a_quadCoord * vec2(sizePx / canvasSize.x, sizePx / canvasSize.y);

  gl_Position = vec4(outpos + quadOffset, 0.0, 1.0);

  position_out = dropPosition;
  mass_out = mass;
  density_out = density;
  quadCoord_out = a_quadCoord;
}
