#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 fragCoord;
in vec2 texCoord;

in vec2 texCoordX0Yp; // up
in vec2 texCoordX0Ym; // down
in vec2 texCoordXmY0; // left
in vec2 texCoordXpY0; // right

uniform sampler2D baseTex;
uniform sampler2D waterTex;
uniform isampler2D wallTex;
uniform sampler2D lightTex;

uniform vec2 resolution;
uniform vec2 texelSize;

uniform float sunAngle;

uniform float sunIntensity;

uniform float IR_rate;

uniform float greenhouseGases;
uniform float waterGreenHouseEffect;
uniform float waterTemperature; // configured temperature of lake / sea surfaces, in Kelvin

layout(location = 0) out vec4 light;
layout(location = 1) out vec4 reflectedLight;

uniform float dryLapse;

#include "common.glsl"

// ───────────────────────── lightning emission ─────────────────────────
// The strike is written into the ALPHA of the emitted-light buffer (reflectedLight.a).
// The ambient-light blur chain then diffuses it, and the display shader adds that
// channel back unclamped as the strike's glow/halo — the same tone-mapped ambient path
// fire and city lights use, so there is no separate post-process bloom.
uniform sampler2D lightningTex;
uniform sampler2D lightningDataTex;
uniform float iterNum;
uniform vec2 aspectRatios; // [0] sim       [1] canvas

const vec2 lightningTexRes = vec2(1024, 2048);
const float lightningTexAspect = lightningTexRes.x / lightningTexRes.y;

const vec3 tempColorPalette[] = vec3[](vec3(1., 0.7, 1.), vec3(1., 0.5, 1.), vec3(1., 0.3, 1.), vec3(0.8, 0., 0.8), vec3(0.65, 0., 0.6), vec3(0.5, 0., 0.5), vec3(0.35, 0., 0.6), vec3(0., 0., 0.7), vec3(0., 0., 1.), vec3(0., 0.30, 1.), vec3(0., 0.44, 1.), vec3(0., 0.62, 1.0), vec3(0., 0.80, 1.0), vec3(0., 1., 1.), vec3(0., 0.50, 0.), vec3(0., 0.61, 0.0), vec3(0., 0.72, 0.), vec3(0., 0.85, 0.),
                                       vec3(0., 1., 0.), vec3(0.5, 1., 0.), vec3(0.80, 1., 0.), vec3(1., 1., 0.), vec3(1., 0.8, 0.), vec3(1., 0.6, 0.), vec3(1., 0.4, 0.), vec3(1., 0., 0.), vec3(0.85, 0., 0.), vec3(0.72, 0., 0.), vec3(0.61, 0., 0.), vec3(0.52, 0., 0.));

float calcLightningTime(float startIterNum)
{
  float lightningTime = iterNum - startIterNum;
  return lightningTime / 5.0; // must match the display's pace (stock /5.0) so the glow fades with the bolt
}

float lightningIntensityOverTime(float Tin, vec2 lightningPos, float intensity)
{
  // Single smooth flash (in step with the display shader's bolt) — no uneven multi-pulse flicker.
  float T = max(Tin - 1., 0.);
  return max((1. / (0.05 + pow(T * 2.8, 3.))) - 0.005, 0.) * pow(intensity, 2.0);
}

vec3 displayLightning(vec2 pos, float lightningTime, float currentLightningIntensity)
{
  vec2 lightningTexCoord = texCoord;

  lightningTexCoord.x -= mod(pos.x, 1.);

  lightningTexCoord.y -= pos.y;

  float scaleMult = 1. / pos.y; // 1.0 means lightning is as tall as the simheight

  lightningTexCoord.x *= scaleMult * aspectRatios[0] / lightningTexAspect;
  lightningTexCoord.y *= -scaleMult;

  lightningTexCoord.x += 0.5;

  if (lightningTexCoord.x < 0.01 || lightningTexCoord.x > 1.01 || lightningTexCoord.y < 0.01 || lightningTexCoord.y > 1.01)
    return vec3(0);

  float pixVal = texture(lightningTex, lightningTexCoord).r;

  const float branchShowFactor = 2.5;
  const float leaderBrightness = 50000.;
  const float mainBoltBrightness = 100000.;

  float brightnessThreshold = 1. - lightningTime * branchShowFactor;
  brightnessThreshold += lightningTexCoord.y * branchShowFactor;

  brightnessThreshold = clamp(brightnessThreshold, 0., 1.);

  if (lightningTime > 1.0) { // main bolt
    brightnessThreshold = 0.95;
    currentLightningIntensity *= mainBoltBrightness;
  } else {
    currentLightningIntensity = leaderBrightness;
  }

  pixVal -= brightnessThreshold;
  pixVal = max(pixVal, 0.0);
  pixVal *= currentLightningIntensity;

  // Ground-reach ramp (matches the display shader) so the glow halo also reaches the ground.
  pixVal *= 1.0 + 0.8 * smoothstep(0.55, 1.0, lightningTexCoord.y);

  // violet (matches the display bolt); only its luminance feeds the glow halo
  vec3 lightningCol = vec3(0.72, 0.5, 1.0);

  return max(pixVal * lightningCol, vec3(0));
}


// ========================= reworked longwave IR =========================
// The IR fluxes no longer crawl forward one cell per iteration. Each lighting
// pass now advances both fluxes IR_STEP cells using a leapfrog gather:
// the flux is picked up IR_STEP cells away and transmitted through the column
// in between (absorption + re-emission via the column's optical thickness).
// The whole atmospheric column therefore converges to radiative equilibrium
// in roughly resolution.y / IR_STEP iterations, and the fluxes also react
// IR_STEP times faster to changing temperatures, clouds and surfaces.
#define IR_STEP 1

// How opaque one air cell is to longwave radiation (Kirchhoff: emissivity == absorptivity)
float airEmissivity(vec4 waterSample, float heightComp)
{
  float emissivity = greenhouseGases;                          // greenhouse gasses
  emissivity += max(waterSample[TOTAL], 0.0) * waterGreenHouseEffect; // water vapor (wall indicators also make terrain opaque, as they should)
  emissivity += max(waterSample[CLOUD], 0.0) * 5.0;            // cloud water blocks all IR
                                                               // smoke is mostly transparent to IR
  emissivity *= heightComp;                                    // compensate for the height of the cell

  if (!(emissivity == emissivity)) // NaN, because a cell contained a corrupted water value
    return 1.0;                  // treat it as opaque instead of letting NaN into the heating of the air
  return min(emissivity, 1.0);                                 // limit to 1.0
}

// Optical thickness of numCells air cells that each have emissivity e:
// transmittance of the column is (1 - e)^numCells
float columnOpacity(float e, float numCells) { return 1.0 - pow(max(1.0 - e, 0.0), numCells); }

// Real (not potential) air temperature at any texCoord, limited to the physical range so that a
// corrupted cell can never emit an infinite amount of longwave radiation
float airTempAt(vec2 tc) { return cleanTempK(potentialToRealT(texture(baseTex, tc)[TEMPERATURE], tc.y)); }

// Surfaces radiate like black bodies (emissivity = 1.0) at their own temperature.
// Only water surfaces actually store their real temperature in baseTex: every other wall type
// stores the 1000.0 "no snow melt" indicator that the pressure shader reads (see advectionShader),
// which is NOT a temperature. Radiating that as a black body means 56 MW/m², which cooled the
// entire boundary layer by ~0.1 K per iteration until the temperature went below absolute zero.
// maxWater() turns into NaN at negative temperatures, so that is a vapor explosion: the skin
// temperature of dry surfaces is therefore taken from the air cell next to them, like before the
// IR rework, and everything is limited to the physical range afterwards.
float surfaceSkinTemp(ivec4 wallSample, vec2 wallTC, vec2 airTC)
{
  if (wallSample[TYPE] == WALLTYPE_WATER) {
    float T = texture(baseTex, wallTC)[TEMPERATURE]; // real water temperature in Kelvin
    if (!(T > 100.0) || T > 500.0)                   // NaN or the wall indicator of older save files
      T = waterTemperature;                          // fall back to the configured water temperature
    return cleanTempK(T);
  }

  float T = potentialToRealT(texture(baseTex, airTC)[TEMPERATURE], airTC.y); // the air just above/below the surface
  if (wallSample[TYPE] == WALLTYPE_FIRE)
    T += 100.0; // fire emits extra heat
  return cleanTempK(T);
}

float surfaceEmission(ivec4 wallSample, vec2 wallTC, vec2 airTC) { return IR_emitted(surfaceSkinTemp(wallSample, wallTC, airTC)); }
// ========================================================================

void main()
{
  if (fragCoord.y >= resolution.y - 1.)
    light = vec4(sunIntensity, 0, 0, 0); // at top: full sun, no IR
  else {

    float cellHeightCompensation = 300. / resolution.y; // 300 cells = 1.0     100 cells = 3.0

    // sunlight calculation

    vec2 sunRay = vec2(sin(sunAngle) * texelSize.x, cos(sunAngle) * texelSize.y);
    float sunlight = texture(lightTex, texCoord + sunRay)[SUNLIGHT];
    // float sunlight = bilerp(lightTex, fragCoord + vec2(sin(sunAngle) ,

    float realTemp = cleanTempK(potentialToRealT(texture(baseTex, texCoord)[TEMPERATURE]));
    vec4 water = texture(waterTex, texCoord);
    ivec4 wall = texture(wallTex, texCoord);

    float scatering = clamp(map_range(abs(sunAngle), 75. * deg2rad, 90. * deg2rad, 0., 1.), 0., 1.); // how red the sunlight is
    vec3 sunlightColor = sunColor(scatering);

    if (wall[DISTANCE] != 0) {                                                                          // is not wall

      reflectedLight.rgb += sunlightColor * sunlight * (1. - texCoord.y) * 2.0 / standardSunBrightness; // scatering in air

      float net_heating = 0.0;

      if (fragCoord.y < resolution.y - 2.) {                                                                                   // prevent shadow bug above simulation area
        float reflection = min(pow(water[CLOUD] * 0.0010 + water[PRECIPITATION] * 0.00020, 0.5) * cellHeightCompensation, 1.); // 0.035 cloud + 0.35 precipitation
        reflection += 0.0002;                                                                                                  // clear air scattering
        float absorbtion = min(water[SMOKE] * 0.020 * cellHeightCompensation, 1.);                                             // 0.025 dust/smoke

        float lightReflected = sunlight * reflection;
        float lightAbsorbed = sunlight * absorbtion;

        sunlight = max(0., sunlight - lightReflected - lightAbsorbed);


        // vec3 finalLight = sunColor(scatering)

        reflectedLight.rgb = sunlightColor * lightReflected / standardSunBrightness; // sunlight reflected by clouds and precipitation


        // float avgSunlight = (texture(lightTex, texCoordX0Ym)[SUNLIGHT] + texture(lightTex, texCoordX0Yp)[SUNLIGHT] + texture(lightTex, texCoordXmY0)[SUNLIGHT] + texture(lightTex,
        // texCoordXpY0)[SUNLIGHT]) / 4.0;

        // sunlight -= (sunlight - avgSunlight) * 0.8; // smooth

        net_heating += lightAbsorbed * lightHeatingConst; // dust/smoke being heated
      }

      // ─────────────────── reworked longwave / IR calculation ───────────────────
      // Downwelling flux: gathered IR_STEP cells up, transmitted through the column between
      vec2 tcUp = texCoord + vec2(0.0, texelSize.y * float(IR_STEP));
      vec2 tcUpMid = texCoord + vec2(0.0, texelSize.y * float(IR_STEP / 2));
      float IR_down;

      if (texture(wallTex, tcUp)[DISTANCE] == 0) { // a surface / ceiling is within IR_STEP cells above
        IR_down = surfaceEmission(texture(wallTex, tcUp), tcUp, tcUp - vec2(0.0, texelSize.y)); // the air cell right below the ceiling
      } else {
        float eMid = airEmissivity(texture(waterTex, tcUpMid), cellHeightCompensation);
        float tau = columnOpacity(eMid, float(IR_STEP));
        IR_down = mix(texture(lightTex, tcUp)[IR_DOWN], IR_emitted(airTempAt(tcUpMid)), tau);
      }

      // Upwelling flux: gathered IR_STEP cells down, transmitted through the column between
      vec2 tcDn = texCoord - vec2(0.0, texelSize.y * float(IR_STEP));
      vec2 tcDnMid = texCoord - vec2(0.0, texelSize.y * float(IR_STEP / 2));
      float IR_up;

      ivec4 wallBelowFar = texture(wallTex, tcDn);
      if (wallBelowFar[DISTANCE] == 0) { // the ground is within IR_STEP cells below
        float eLocal = airEmissivity(water, cellHeightCompensation);
        float cellsToSurface = clamp(float(wall[VERT_DISTANCE] - 1), 0.0, float(IR_STEP)); // air cells in between
        float tau = columnOpacity(eLocal, cellsToSurface);
        IR_up = mix(surfaceEmission(wallBelowFar, tcDn, tcDn + vec2(0.0, texelSize.y)), IR_emitted(cleanTempK(realTemp)), tau); // the air cell right above the ground
      } else {
        float eMid = airEmissivity(texture(waterTex, tcDnMid), cellHeightCompensation);
        float tau = columnOpacity(eMid, float(IR_STEP));
        IR_up = mix(texture(lightTex, tcDn)[IR_UP], IR_emitted(airTempAt(tcDnMid)), tau);
      }

      if (wall[VERT_DISTANCE] == 1) { // 1 above surface

        switch (wall[TYPE]) {
        case WALLTYPE_RUNWAY:
        case WALLTYPE_URBAN:
        case WALLTYPE_INDUSTRIAL:
          if (abs(sunAngle) > 85. * deg2rad)
            reflectedLight.rgb += vec3(1.00, 0.97, 0.57) * 0.03; // Urban area emits light
                                                                 // NOBREAK
        case WALLTYPE_LAND:
          // IR_up was already set to the emission of the surface below
          net_heating += (IR_down - IR_up) * lightHeatingConst;
          break;
        case WALLTYPE_WATER:
          // IR_up was already set to the emission of the water surface below
          net_heating += (IR_down - IR_up) * lightHeatingConst;
          break;
        case WALLTYPE_FIRE:
          // IR_up was already set to the (boosted) emission of the fire below
          net_heating = 0.0;
        }
      } else if (texture(wallTex, texCoordX0Yp)[DISTANCE] == 0) // wall above
      {
        // IR_down was already set to the emission of the surface above
        net_heating += (IR_up - IR_down) * lightHeatingConst;
      } else {

        // in air: absorb both fluxes according to this cell's emissivity and
        // re-emit at this cell's own temperature (Stefan-Boltzmann)
        float emissivity = airEmissivity(water, cellHeightCompensation);

        float emitted = IR_emitted(cleanTempK(realTemp)) * emissivity; // this amount is emitted both up and down

        net_heating += ((IR_down + IR_up) * emissivity - emitted * 2.0) * lightHeatingConst;
      }
      // ──────────────────────────────────────────────────────────────────────────

      float smokeOpacity = clamp(1. - (1. / (water[SMOKE] + 1.)), 0.0, 1.0);
      float fireIntensity = clamp((smokeOpacity - 0.8) * 25., 0.0, 1.0);
      vec3 fireCol = hsv2rgb(vec3(fireIntensity * 0.008, 0.98, 5.0)) * 1.0; // 1.0, 0.7, 0.0
      vec3 FinalFireCol = mix(vec3(0), fireCol, fireIntensity);

      reflectedLight.rgb += FinalFireCol * 0.1;

      net_heating *= IR_rate;

      light = vec4(sunlight, net_heating, IR_down, IR_up);
      // light = vec4(1, 0, 0, 0);
    } else {                                    // is wall
      if (wall[TYPE] == WALLTYPE_WATER)         // water
        light = vec4(sunlight * 0.90, 0, 0, 0); // light absorbed by water
      else {                                    // land

        const vec3 groundCol = vec3(0.60, 0.5, 0.4);

        vec3 lightReflected = vec3(sunlight) * groundCol;
        vec3 lightAbsorbed = vec3(sunlight) - lightReflected;

        light = vec4(0.0, 0, 0, 0); // all light absorbed by ground
        reflectedLight.rgb += lightReflected / standardSunBrightness;
      }
    }

    // ── lightning strike → glow (alpha of the emitted-light buffer) ──────────────
    reflectedLight.a = 0.0;
    {
      vec4 lightningData = texture(lightningDataTex, vec2(0.5));
      if (lightningData[INTENSITY] > 1.0) {
        vec2 lightningPos = lightningData.xy;
        float lightningTime = calcLightningTime(lightningData[START_ITERNUM]);
        float lightningIntensity = lightningIntensityOverTime(lightningTime, lightningPos, lightningData[INTENSITY]);
        float cloudMask = clamp(max(texture(waterTex, texCoord)[CLOUD] * 13.6, 0.0), 0.0, 1.0);
        // The 0.06 base (stock) cut the glow almost entirely where there is no cloud (the lower
        // half of the bolt), so the halo stopped short of the ground. Raise the base so the glow
        // carries down the full length of the bolt.
        vec3 bolt = displayLightning(lightningPos, lightningTime, lightningIntensity) * (0.18 + 0.82 * cloudMask);
        reflectedLight.a = max(max(bolt.r, bolt.g), bolt.b);
      }
    }
  }
}
