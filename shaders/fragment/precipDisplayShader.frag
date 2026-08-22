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

// Hail look: 0 = realistic dense ice, 1 = legacy debug yellow
#define HAIL_LEGACY_YELLOW 0

// 1 = original flat-color view, 0 = realistic shading
#define DEBUG_FLAT 0

// Mass -> opacity: ~linear at the original 0.10 rate for small mass,
// saturating toward 1.0 for heavy cells.
const float MASS_ALPHA_K = 0.12;

// Key light direction (view space, +z toward viewer)
const vec3 LIGHT_DIR_RAW = vec3(-0.35, 0.50, 0.80);
// ==================================================================

float saturate(float x) { return clamp(x, 0.0, 1.0); }
float hash11(float p) { return fract(sin(p * 12.9898) * 43758.5453); }

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

// Fake a hemisphere normal so flat billboards shade like spheres.
vec3 sphereNormal(vec2 uv)
{
  float d = saturate(dot(uv, uv));
  return normalize(vec3(uv, sqrt(max(1.0 - d, 1e-4))));
}

void shade(vec3 n, out float diff, out float spec, out float fres)
{
  vec3 L = normalize(LIGHT_DIR_RAW);
  diff = max(dot(n, L), 0.0);
  vec3 h = normalize(L + vec3(0.0, 0.0, 1.0));
  spec = pow(max(dot(n, h), 0.0), 90.0);
  fres = pow(1.0 - saturate(n.z), 3.0);
}

// ---------------------------- rain --------------------------------
// Side-view streak: fat glassy head at the bottom, thinning tail upward.
vec4 rain(vec2 uv, float a)
{
  // Wider near the head, needle-thin toward the tail.
  float halfW = mix(0.92, 0.10, smoothstep(-0.55, 1.0, uv.y));
  float dx = abs(uv.x) / max(halfW, 0.04);

  vec2 headC = vec2(0.0, -0.58);
  vec2 headQ = (uv - headC) / vec2(0.62, 0.42);
  float head = length(headQ);

  float tail = 1.0 - smoothstep(0.55, 1.05, dx);
  tail *= 1.0 - smoothstep(0.35, 1.0, uv.y);
  tail *= smoothstep(-1.05, -0.15, uv.y);

  float headMask = 1.0 - smoothstep(0.82, 1.05, head);
  float mask = max(tail, headMask);
  if (mask <= 0.0)
    discard;

  float ndx = uv.x / max(halfW, 0.05);
  float spec = pow(saturate(1.0 - abs(ndx - 0.22)), 10.0) * headMask;
  float core = saturate(1.0 - abs(ndx));

  vec3 deep = vec3(0.18, 0.38, 0.62);
  vec3 mid = vec3(0.45, 0.68, 0.88);
  vec3 hi = vec3(0.86, 0.94, 1.0);

  vec3 col = mix(deep, mid, core);
  col = mix(col, hi, spec);
  col += vec3(1.0) * spec * 0.55;

  // Tail is more transparent so overlapping streaks don't chalk out.
  float alpha = a * mix(tail * 0.38, 0.92, headMask);
  return vec4(col, saturate(alpha));
}

// ---------------------------- snow --------------------------------
vec4 snow(vec2 uv, float mI, float a)
{
  float r = length(uv);
  if (r > 1.0)
    discard;

  float seed = hash11(flakeSeed * 0.137 + mI * 0.031 + density_out * 17.17);
  float ang = atan(uv.y, uv.x) + seed * 6.2831853;

  // Six primary arms + finer secondary branches.
  float arms = pow(abs(cos(ang * 3.0)), 5.5);
  float arms2 = pow(abs(cos(ang * 6.0)), 10.0) * 0.45;
  float ring = exp(-pow((r - 0.42) * 5.5, 2.0)) * 0.35;

  float core = exp(-r * r * 10.0);
  float flake = exp(-r * 2.05) * (0.18 + 0.82 * arms + arms2) + ring;
  flake = max(flake, core);

  float halo = exp(-r * r * 2.2) * 0.28;
  float mask = saturate(flake + halo);
  if (mask <= 0.001)
    discard;

  vec3 col = mix(vec3(0.76, 0.85, 0.96), vec3(1.0), saturate(core * 1.4 + arms * 0.25));
  return vec4(col, a * mask);
}

// ---------------------------- hail --------------------------------
vec4 hail(vec2 uv, float a)
{
  float r2 = dot(uv, uv);
  float body = 1.0 - smoothstep(0.86, 0.98, sqrt(r2)); // hard edge
  if (body <= 0.0)
    discard;

  float diff, spec, fres;
  shade(sphereNormal(uv), diff, spec, fres);

#if HAIL_LEGACY_YELLOW
  vec3 base = vec3(0.95, 0.85, 0.35);
#else
  vec3 base = vec3(0.80, 0.86, 0.90); // dense wet ice
#endif

  vec3 col = base * (0.45 + 0.55 * diff);
  col = mix(col, vec3(0.92, 0.96, 1.0), fres * 0.45);
  col += vec3(1.0) * spec * 1.4;           // hard glint
  col *= 0.88 + 0.12 * exp(-r2 * 2.0);     // inner density hint

  return vec4(col, a * body * 0.95);
}

// ------------------- mixed phase (melting) ------------------------
vec4 wetSnow(vec2 uv, float mW, float mI, float a)
{
  float r2 = dot(uv, uv);
  if (r2 > 1.0)
    discard;

  float wet = saturate(mW / max(mW + mI, 1e-5));
  float body = exp(-r2 * 2.6); // soft lump

  float diff, spec, fres;
  shade(sphereNormal(uv * 0.92), diff, spec, fres);

  vec3 dry = vec3(0.93, 0.96, 1.0) * (0.75 + 0.25 * diff);
  vec3 wetCol = vec3(0.35, 0.55, 0.80) * (0.35 + 0.65 * diff) + vec3(0.55, 0.75, 0.95) * fres * 0.5;

  vec3 col = mix(dry, wetCol, wet * 0.75);
  col += vec3(1.0) * spec * (0.25 + 0.9 * wet); // melting = glossy

  return vec4(col, a * body);
}

// ==================================================================
void main()
{
  if (mass_out[WATER] < 0.)
    discard;

  float mW = mass_out[WATER];
  float mI = max(mass_out[ICE], 0.0);

#if DEBUG_FLAT
  if (mI > 0.0) {
    if (mW == 0.0)
      fragmentColor = (density_out < 1.0) ? vec4(1.0, 1.0, 1.0, 1.0)  // snow
                                          : vec4(1.0, 1.0, 0.0, 1.0); // hail
    else
      fragmentColor = vec4(0.5, 1.0, 1.0, 1.0); // mix
  } else {
    fragmentColor = vec4(0.0, 0.5, 1.0, 1.0); // rain
  }
  return;
#endif

  float massAlpha = 1.0 - exp(-MASS_ALPHA_K * (mW + mI));
  vec2 uv = spriteUV();
  vec4 col;

  if (mI > 0.0 && mW == 0.0)
    col = (density_out < 1.0) ? snow(uv, mI, massAlpha) : hail(uv, massAlpha);
  else if (mI > 0.0)
    col = wetSnow(uv, mW, mI, massAlpha);
  else
    col = rain(uv, massAlpha);

  if (col.a <= 0.001)
    discard;

  fragmentColor = col;
}
