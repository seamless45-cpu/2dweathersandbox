#version 300 es
precision mediump float;

in vec2 position_out;
flat in vec2 mass_out;
flat in float density_out;
flat in float flakeSeed;
out vec4 fragmentColor;

// Precipitation mass:
#define WATER 0
#define ICE   1

// ============================ config ==============================
// Sprite-local coordinate source:
//   0 -> position_out already carries local coords in [-1,+1] (instanced quads)
//   1 -> particles drawn as gl_POINTS (uses gl_PointCoord)
#define SPRITE_COORD_SOURCE 0

// Mass -> opacity: ~linear at the original 0.10 rate for small mass,
// saturating toward 1.0 for heavy cells.
const float MASS_ALPHA_K = 0.12;
// ==================================================================

float saturate(float x) { return clamp(x, 0.0, 1.0); }

vec2 spriteUV()
{
#if SPRITE_COORD_SOURCE == 1
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  p.y = -p.y; // +y up, like the quad path
  return p;
#else
  return position_out; // expected in [-1,+1]
#endif
}

// ───────────────────────── simple shapes ─────────────────────────
// Reworked droplet look: one flat color per type with a soft mask.
// No fake lighting, no specular, no crystal arms — just clean, simple
// shapes that still read as rain / snow / hail.

// ---------------------------- rain --------------------------------
// Simple flat streak (the quad is already stretched tall by the vertex shader)
vec4 rain(vec2 uv, float a)
{
  float mask = (1.0 - smoothstep(0.55, 1.0, abs(uv.x))) * (1.0 - smoothstep(0.72, 1.0, abs(uv.y)));
  if (mask <= 0.0)
    discard;
  return vec4(0.55, 0.74, 0.95, a * mask * 0.85);
}

// ---------------------------- snow --------------------------------
// Simple soft dot
vec4 snow(vec2 uv, float a)
{
  float r = length(uv);
  if (r > 1.0)
    discard;
  float mask = 1.0 - smoothstep(0.5, 1.0, r);
  return vec4(0.92, 0.96, 1.0, a * mask);
}

// ---------------------------- hail --------------------------------
// Simple solid dot with a slightly harder edge
vec4 hail(vec2 uv, float a)
{
  float r = length(uv);
  if (r > 1.0)
    discard;
  float mask = 1.0 - smoothstep(0.8, 1.0, r);
  return vec4(0.80, 0.87, 0.92, a * mask);
}

// ------------------- mixed phase (melting) ------------------------
// Simple soft dot tinted towards blue the wetter it is
vec4 wetSnow(vec2 uv, float mW, float mI, float a)
{
  float r = length(uv);
  if (r > 1.0)
    discard;
  float wet = saturate(mW / max(mW + mI, 1e-5));
  float mask = 1.0 - smoothstep(0.55, 1.0, r);
  vec3 col = mix(vec3(0.92, 0.96, 1.0), vec3(0.45, 0.62, 0.85), wet * 0.7);
  return vec4(col, a * mask);
}

// ==================================================================
void main()
{
  if (mass_out[WATER] < 0.)
    discard;

  float mW = mass_out[WATER];
  float mI = max(mass_out[ICE], 0.0);

  float massAlpha = 1.0 - exp(-MASS_ALPHA_K * (mW + mI));
  vec2 uv = spriteUV();
  vec4 col;

  if (mI > 0.0 && mW == 0.0)
    col = (density_out < 1.0) ? snow(uv, massAlpha) : hail(uv, massAlpha);
  else if (mI > 0.0)
    col = wetSnow(uv, mW, mI, massAlpha);
  else
    col = rain(uv, massAlpha);

  if (col.a <= 0.001)
    discard;

  fragmentColor = col;
}
