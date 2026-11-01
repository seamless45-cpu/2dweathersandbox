#define PI 3.1415926535897932384626433832795
#define rad2deg 57.2958
#define deg2rad 0.0174533

const float GAMMA = 2.0;
const vec3 ONE_OVER_GAMMA = vec3(1. / GAMMA);

const vec3 tempColorPalette[] = vec3[](vec3(1., 0.7, 1.), vec3(1., 0.5, 1.), vec3(1., 0.3, 1.), vec3(0.8, 0., 0.8), vec3(0.65, 0., 0.6), vec3(0.5, 0., 0.5), vec3(0.35, 0., 0.6), vec3(0., 0., 0.7), vec3(0., 0., 1.), vec3(0., 0.30, 1.), vec3(0., 0.44, 1.), vec3(0., 0.62, 1.0), vec3(0., 0.80, 1.0), vec3(0., 1., 1.), vec3(0., 0.50, 0.), vec3(0., 0.61, 0.0), vec3(0., 0.72, 0.), vec3(0., 0.85, 0.),
                                       vec3(0., 1., 0.), vec3(0.5, 1., 0.), vec3(0.80, 1., 0.), vec3(1., 1., 0.), vec3(1., 0.8, 0.), vec3(1., 0.6, 0.), vec3(1., 0.4, 0.), vec3(1., 0., 0.), vec3(0.85, 0., 0.), vec3(0.72, 0., 0.), vec3(0.61, 0., 0.), vec3(0.52, 0., 0.));


// ── black body colour ───────────────────────────────────────────────────────────────────────
// Anything that glows gets its colour from how hot it is: a lightning channel is a plasma at
// 10 000-30 000 K and photographs blue-white, a flame at 900-2 000 K is red-orange-yellow, and
// the two ends of that range come out of one curve instead of hand-picked RGB triples.
//
// Tanner Helland's fit of the Planckian locus, good to a few percent from 1000 K to 40 000 K.
// Returned as sRGB in 0..1.
vec3 blackbodySRGB(float kelvin)
{
  float t = clamp(kelvin, 1000.0, 40000.0) * 0.01;
  float r, g, b;

  if (t <= 66.0) {
    r = 1.0;
    g = (99.4708025861 * log(t) - 161.1195681661) / 255.0;
  } else {
    r = 329.698727446 * pow(t - 60.0, -0.1332047592) / 255.0;
    g = 288.1221695283 * pow(t - 60.0, -0.0755148492) / 255.0;
  }

  if (t >= 66.0)
    b = 1.0;
  else if (t <= 19.0)
    b = 0.0;
  else
    b = (138.5177312231 * log(t - 10.0) - 305.0447927307) / 255.0;

  return clamp(vec3(r, g, b), 0.0, 1.0);
}

// The same colour in the linear, pre-tone-map space the shaders work in (GAMMA is 2.0), scaled
// so the brightest channel is 1. Scaling to unit peak keeps temperature and brightness separate:
// a dim leader and a blinding stroke can share a temperature and still be multiplied by very
// different gains.
vec3 blackbodyRGB(float kelvin)
{
  vec3 c = blackbodySRGB(kelvin);
  c *= c; // the frame is gamma 2.0, so sRGB has to be squared before it is used as light
  return c / max(max(c.r, c.g), max(c.b, 1e-4));
}

// ── air temperature colour ──────────────────────────────────────────────────────────────────
// The temperature view is a false-colour map computed from the absolute temperature in kelvin,
// not a palette index into an image. Two things make air temperature different from the glowing
// things blackbodyRGB() describes above: the range is tiny (a cold stratospheric night is 195 K,
// a hot desert afternoon 335 K) and all of it radiates in the far infrared, so a true Planckian
// colour would be almost black everywhere. What is preserved from blackbody radiation is the
// order and the physics: the ramp starts at the violet/blue end and rotates through cyan, white,
// green, yellow and orange to deep red as the air warms.
//
// The stops sit on temperatures that mean something in the atmosphere, so the map can be read
// against the physics rather than being an arbitrary gradient:
//
//   195 K  -78 °C  dry ice / the coldest stratospheric air in this model
//   233 K  -40 °C  where the Celsius and Fahrenheit scales cross, the practical cold limit
//   273.15 K 0 °C  the freezing point: the one indisputable landmark on the scale
//   301 K  ~28 °C  the warm end of a temperate summer
//   310 K   37 °C  human body / heat-wave threshold
//   335 K   62 °C  the hottest surface air this model produces
//
// Between the stops the colour is interpolated with a smoothstep so the derivative is continuous:
// a hard linear join between two stops leaves a visible Mach band across a smooth temperature
// field, which reads as a fake contour line.
const float tempRampKelvin[] = float[](195.0, 208.0, 220.0, 233.0, 245.0, 256.0, 266.0, 273.15, 283.0, 293.0, 301.0, 310.0, 322.0, 335.0);

const vec3 tempRampColors[] = vec3[](vec3(0.16, 0.09, 0.36), // 195 K  deep indigo
                                      vec3(0.23, 0.13, 0.55), // 208 K  violet
                                      vec3(0.16, 0.27, 0.78), // 220 K  deep blue
                                      vec3(0.13, 0.47, 0.90), // 233 K  blue
                                      vec3(0.16, 0.66, 0.95), // 245 K  azure
                                      vec3(0.24, 0.85, 0.92), // 256 K  cyan
                                      vec3(0.55, 0.93, 0.90), // 266 K  pale cyan
                                      vec3(0.86, 0.96, 1.00), // 273 K  ice white
                                      vec3(0.60, 0.93, 0.46), // 283 K  mint
                                      vec3(0.97, 0.89, 0.28), // 293 K  yellow-green
                                      vec3(1.00, 0.76, 0.28), // 301 K  amber
                                      vec3(0.98, 0.52, 0.18), // 310 K  orange
                                      vec3(0.90, 0.27, 0.15), // 322 K  red
                                      vec3(0.62, 0.11, 0.10)); // 335 K  deep red

vec3 temperatureRampSRGB(float kelvin)
{
  const int n = 14;

  if (kelvin <= tempRampKelvin[0])
    return tempRampColors[0];
  if (kelvin >= tempRampKelvin[n - 1])
    return tempRampColors[n - 1];

  for (int i = 0; i < n - 1; i++) {
    float lo = tempRampKelvin[i];
    float hi = tempRampKelvin[i + 1];
    if (kelvin >= lo && kelvin <= hi) {
      float f = (kelvin - lo) / (hi - lo);
      f = f * f * (3.0 - 2.0 * f); // smoothstep: continuous slope across the stop
      return mix(tempRampColors[i], tempRampColors[i + 1], f);
    }
  }

  return tempRampColors[n - 1];
}

// The frame the display shaders write into is linear light (the post pass tone maps it and then
// applies gamma 2.0), so the sRGB colour has to be squared before it is written.
vec3 temperatureRamp(float kelvin)
{
  vec3 c = temperatureRampSRGB(kelvin);
  return c * c;
}

// functions for display shaders
void drawCursor(vec4 cursor, vec3 view)            // OFF: cursor.w < 1       Normal round: cursor.w 1 to 2         WHOLE WIDTH: cursor.w >= 2
{
  if (cursor.w >= 1.) {                            // draw cursor enabled
    float distFromMouseF;
    if (cursor.w >= 2.) {                          // whole width brush
      distFromMouseF = abs(cursor.y - texCoord.y); // whole width bar
    } else {
      vec2 vecFromMouse = cursor.xy - texCoord;
      vecFromMouse.x *= texelSize.y / texelSize.x; // aspect ratio correction to make it a circle
      distFromMouseF = length(vecFromMouse);
    }

    // float distance

    if (abs(distFromMouseF - cursor[2] * texelSize.y) < 0.000005 * resolution.x / view[2]) { // draw brush
      fragmentColor = vec4(0.5, 0.5, 0.5, 1.0);                                              // gray line
    }
  }
}

// Derived from etale_cohomology on shadertoy: https://www.shadertoy.com/view/4tXyDn
float m_stretch(float point, float stretch) { return (sign(point) * stretch - point) * (sign(abs(point) - stretch) + 1.); }

float sdf_arrow(vec2 uv, float len, float angle, float head_height, float stem_width)
{
  uv = vec2(cos(angle) * uv.x + sin(angle) * uv.y, -sin(angle) * uv.x + cos(angle) * uv.y);

  len -= head_height; // Make sure the norm INCLUDES the arrow head
  uv.x -= len;        // Place the arrow's origin at the stem's base!

  uv.y = abs(uv.y);
  float head = max(dot(uv, vec2(1., 1.)) - head_height, -uv.x);

  uv.x = m_stretch(2. * uv.x + len, len);
  uv.y = m_stretch(2. * uv.y, stem_width);
  float stem = length(uv);

  return min(head, stem); // Join head and stem!
}

/*
void drawDirLines(vec2 vel)
{
  vec2 localcoord = vec2(-1.0, 0.0);
  float centerDist = length(localcoord); // distance from center of cell
  float velMag = length(vel);

  float relAngle = acos(dot(vel, localcoord) / (velMag * centerDist)); // angle between velocity and line from center of cell to this pixel

  float velMagSqrt = sqrt(velMag);

  float sizeMult = 3.952 / velMagSqrt;

  if (mod(relAngle, 0.50) < 0.01)
    fragmentColor = vec4(vec3(0), 1.);
}
*/

void drawIsoBars(float press)
{
  if (abs(mod(press, 0.001)) < 0.0001)
    fragmentColor = vec4(vec3(0), 1.);
}

float vectorField(vec2 vel, float intensity)
{
#define sizeMult 2.00

  float velMag = length(vel);

  velMag = min(velMag, 0.10);            // limit to prevent arrows becoming to large

  vec2 limvel = normalize(vel) * velMag; // velocity vector with limited magnitude

  vec2 localcoord = mod(fragCoord, 1.0) - vec2(0.5);

  localcoord += limvel * 2.0; // keep the arrow centered

  localcoord /= sqrt(velMag) * sizeMult;

  const float size = 1.0;

  float velAngle = atan(vel.y, vel.x);

  float arrow = sdf_arrow(localcoord, size, velAngle, 0.2 * size, 0.1 * size);
  return smoothstep(0.1, 0.0, arrow) * intensity;
}

void drawVectorField(vec2 vel, float intensity)
{
  float arrow = vectorField(vel, intensity);
  fragmentColor.xyz -= vec3(arrow);
  fragmentColor.w += arrow; // make it not transparent
}


// prevents sampling from wall cell unless nearest is wall cell
// fixes visual quirks such as fog near walls
vec4 bilerpWallVis(sampler2D tex, isampler2D wallTex, vec2 pos)
{
  // return texture(tex, pos / resolution); // direct sample for debugging

  vec2 st = pos - vec2(0.5); // calc pixel coordinats

  vec2 ipos = vec2(floor(st));
  vec2 fpos = fract(st);

  vec4 a = texture(tex, (ipos + vec2(0.5, 0.5)) / resolution);
  vec4 b = texture(tex, (ipos + vec2(1.5, 0.5)) / resolution);
  vec4 c = texture(tex, (ipos + vec2(0.5, 1.5)) / resolution);
  vec4 d = texture(tex, (ipos + vec2(1.5, 1.5)) / resolution);

  ivec4 wa = texture(wallTex, (ipos + vec2(0.5, 0.5)) / resolution);
  ivec4 wb = texture(wallTex, (ipos + vec2(1.5, 0.5)) / resolution);
  ivec4 wc = texture(wallTex, (ipos + vec2(0.5, 1.5)) / resolution);
  ivec4 wd = texture(wallTex, (ipos + vec2(1.5, 1.5)) / resolution);

  float mixAB = fpos.x;
  float mixCD = fpos.x;
  float mixAB_CD = fpos.y;

  bool isWall = false;

  // find nearest cell and check if it's wall
  if (mixAB_CD < 0.5) {
    if (mixAB < 0.5) { // A
      if (wa[1] == 0) {
        mixAB_CD = 0.;
        mixAB = 0.;
        isWall = true;
      }
    } else { // B
      if (wb[1] == 0) {
        mixAB_CD = 0.;
        mixAB = 1.;
        isWall = true;
      }
    }
  } else {
    if (mixCD < 0.5) { // C
      if (wc[1] == 0) {
        mixAB_CD = 1.;
        mixCD = 0.;
        isWall = true;
      }
    } else { // D
      if (wd[1] == 0) {
        mixAB_CD = 1.;
        mixCD = 1.;
        isWall = true;
      }
    }
  }

  if (!isWall) { // prevent mixing from wall
    if (wa[1] == 0)
      mixAB = 1.;
    else if (wb[1] == 0)
      mixAB = 0.;

    if (wc[1] == 0)
      mixCD = 1.;
    else if (wd[1] == 0)
      mixCD = 0.;

    if (wa[1] == 0 && wb[1] == 0)
      mixAB_CD = 1.;
    else if (wc[1] == 0 && wd[1] == 0)
      mixAB_CD = 0.;
  }

  return mix(mix(a, b, mixAB), mix(c, d, mixCD), mixAB_CD);
}
