#version 300 es
precision highp float;

uniform vec2 resolution;
uniform vec2 texelSize;

uniform float dryLapse;

uniform float simHeight;

uniform float seed;
uniform float heightMult;

uniform vec4 initial_Tv[126];

in vec2 texCoord;
in vec2 fragCoord;

#include "common.glsl"

float getInitialT(int y)
{
  // profile temperatures are potential temperatures and must stay physical when converted back
  float lapse = float(y) / resolution.y * dryLapse;
  return cleanTempK(initial_Tv[y / 4][y % 4] - lapse) + lapse;
}


layout(location = 0) out vec4 base;
layout(location = 1) out vec4 water;
layout(location = 2) out ivec4 wall;

float rand(float n) { return fract(sin(n) * 43758.5453123); }

float noise(float p)
{
  float fl = floor(p);
  float fc = fract(p);
  return mix(rand(fl), rand(fl + 1.), fc) - 0.5;
}

void main()
{
  base = vec4(0.0);
  water = vec4(0.0);

  // WALL SETUP

  float height = 0.0;
  float height_m = 0.0;

  if (heightMult < 0.05) { // all sea

    height = 0.0;

  } else if (heightMult < 0.10) { // all land

    height = 0.005;

  } else { // generate hills / mountains
    float var = fragCoord.x * 0.001;

    for (float i = 2.0; i < 1000.0; i *= 1.5) { // add multiple frequencies of noise together
      height += noise(var * i + rand(seed + i) * 10.) * 0.5 / i;
    }

    height *= heightMult;
    height_m = height * simHeight; // sim height
  }

  if (texCoord.y < texelSize.y || texCoord.y < height) {                                                      // set to wall
    wall[DISTANCE] = 0;                                                                                       // set to wall
    if (height < texelSize.y) {
      wall[TYPE] = WALLTYPE_WATER;                                                                            // set walltype to water
      base[TEMPERATURE] = CtoK(25.0);                                                                         // set water temperature to 25 C
      water[TOTAL] = 1002.;                                                                                   // wall indicator, see advectionShader
    } else {
      wall[TYPE] = WALLTYPE_LAND;                                                                             // set walltype to land
      base[TEMPERATURE] = 1000.0;                                                                             // "no snow melting" indicator used by the pressure shader, not a temperature
      water[TOTAL] = 1001.;                                                                                   // wall indicator, see advectionShader
      water[SOIL_MOISTURE] = 25.0;                                                                            // soil moisture in mm

      wall[VEGETATION] = int(110.0 - fragCoord.y * 2. + noise(fragCoord.x * 0.01 + rand(seed) * 10.) * 150.); // set vegitation

      water[SNOW] = max(map_rangeC(height_m, 2000.0, 5000.0, 0.0, 100.0), 0.);                                // set snow
    }
  } else {                                                                                                    // air, not wall
    wall[DISTANCE] = 255;                                                                                     // reset distance to wall
    base[TEMPERATURE] = getInitialT(int(texCoord.y * (1.0 / texelSize.y)));                                   // set temperature

    // Horizontal structure in the starting field. The buoyancy force in the boundary shader is
    // the departure of a cell from the initial profile, so a perfectly uniform start is exactly
    // zero everywhere: no pressure gradient forms, the air never moves, nothing is ever lifted to
    // its condensation level, and the sky stays empty however long the simulation runs. A patch of
    // about a Kelvin is enough to break that symmetry and let convection organise itself.
    float nx = fragCoord.x * 0.010;
    float ny = fragCoord.y * 0.008;
    float patchiness = noise(nx + ny + rand(seed) * 10.0)
                     + 0.55 * noise(nx * 2.7 + ny * 2.1 + rand(seed + 3.0) * 10.0)
                     + 0.30 * noise(nx * 7.3 + ny * 5.5 + rand(seed + 7.0) * 10.0); // ~ -0.9 .. 0.9

    base[TEMPERATURE] += patchiness * 1.2; // potential temperature perturbation, around one Kelvin

    float realTemp = potentialToRealT(base[TEMPERATURE]);

    // Humidity profile: a sub-saturated surface layer (so the sea is not wrapped in fog), a moist
    // band a few hundred metres up where the cloud bases sit, and drier air aloft. Condensation
    // only starts above 100 % relative humidity, so the old start - 30 to 45 % saturation from
    // top to bottom - could not make a cloud at all, no matter how long the simulation ran or how
    // hard the surface was heated. The horizontal noise lets some columns reach saturation before
    // their neighbours, which is what breaks the first cloud into cells instead of a flat sheet.
    float hgt = texCoord.y;
    float rh = 0.88;
    rh = mix(rh, 1.02, smoothstep(0.02, 0.14, hgt)); // moistening up to the cloud layer
    rh = mix(rh, 0.90, smoothstep(0.14, 0.42, hgt)); // cloud layer
    rh = mix(rh, 0.40, smoothstep(0.45, 0.95, hgt)); // dry air aloft
    rh += patchiness * 0.12;

    water[TOTAL] = maxWater(realTemp) * clamp(rh, 0.05, 1.02);

    // maxWater() is capped and NaN proof, so the initial state is safe from the first
    // condensation boiling the cell and starting a vapor explosion
    water[TOTAL] = cleanWater(water[TOTAL]);
    water[CLOUD] = max(water[TOTAL] - maxWater(realTemp), 0.0); // 0 until lifted & condensed
  }
  wall[VERT_DISTANCE] = 100;                                    // preset height above ground to prevent water being deleted in boundaryshader ln 250*`
}