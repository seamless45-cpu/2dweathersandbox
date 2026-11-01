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

    float realTemp = potentialToRealT(base[TEMPERATURE]);

    // No liquid cloud at t=0, and the air starts UN-saturated (below the dew point) so the sky
    // loads genuinely clear — nothing condenses until real convection lifts the parcel to its
    // lifting condensation level. A saturated start (1.0) made cloud appear in the first couple
    // of seconds on load, which read as unexpected cloud forming while the sim was still starting
    // up. Keep the whole column comfortably below saturation; evaporation + surface heating will
    // moisten the boundary layer and the storm still builds from convection, just on its own time.
    float initSaturation = mix(0.45, 0.30, texCoord.y); // slightly moister near the surface, drier aloft
    water[TOTAL] = maxWater(realTemp) * initSaturation;

    // maxWater() is capped and NaN proof, so the initial state is safe from the first
    // condensation boiling the cell and starting a vapor explosion
    water[TOTAL] = cleanWater(water[TOTAL]);
    water[CLOUD] = max(water[TOTAL] - maxWater(realTemp), 0.0); // 0 until lifted & condensed
  }
  wall[VERT_DISTANCE] = 100;                                    // preset height above ground to prevent water being deleted in boundaryshader ln 250*`
}