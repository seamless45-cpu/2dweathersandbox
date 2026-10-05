#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 fragCoord;    // pixel
in vec2 texCoord;     // this normalized

in vec2 texCoordXmY0; // left
in vec2 texCoordX0Ym; // down
in vec2 texCoordXpY0; // right
in vec2 texCoordX0Yp; // up

in vec2 onScreenUV;

uniform sampler2D baseTex;
uniform sampler2D waterTex;
uniform isampler2D wallTex;
uniform sampler2D lightTex;
uniform sampler2D noiseTex;
uniform sampler2D surfaceTextureMap;
uniform sampler2D curlTex;
uniform sampler2D lightningTex;
uniform sampler2D lightningDataTex;

uniform sampler2D ambientLightTex;

uniform vec2 aspectRatios; // [0] Sim       [1] canvas

#define URBAN 0
#define FIRE_FOREST 1
#define SNOW_FOREST 2
#define FOREST 3
#define INDUS 4


uniform vec2 resolution; // sim resolution
uniform vec2 texelSize;

uniform float cellHeight; // in meters

uniform float dryLapse;
uniform float sunAngle;

uniform float minShadowLight;

uniform vec3 view;   // Xpos  Ypos    Zoom
uniform vec4 cursor; // Xpos   Ypos  Size   type

uniform float displayVectorField;

uniform float iterNum;

out vec4 fragmentColor;

#include "common.glsl"

#include "commonDisplay.glsl"

vec4 base, water;
ivec4 wall;
float lightIntensity;

vec3 color;
float opacity = 1.0;

vec3 emittedLight = vec3(0.); // pure light, like lightning

float shadowLight;

vec3 onLight; // extra light that lights up objects, just like sunlight and shadowlight


const vec3 bareDrySoilCol = pow(vec3(0.85, 0.60, 0.40), vec3(GAMMA));
// Wet earth is dark, and it is dark *brown*. This used to be vec3(0.5, 0.2, 0.1), which is a
// saturated red: every freshly watered surface cell turned that colour, and because only the
// top few cells of a wall are ever visible it drew a hard red stroke along the top of the whole
// landscape. Wet soil also keeps some of the dry colour instead of snapping to one flat value.
const vec3 bareWetSoilCol = pow(vec3(0.36, 0.25, 0.17), vec3(GAMMA));
const vec3 greenGrassCol = pow(vec3(0.0, 0.7, 0.2), vec3(GAMMA));
const vec3 dryGrassCol = pow(vec3(0.843, 0.588, 0.294), vec3(GAMMA));


vec4 surfaceTexture(int index, vec2 pos)
{
#define numTextures 5.;             // number of textures in the map
  const float texRelHeight = 1. / numTextures;
  pos.y = clamp(pos.y, 0.01, 0.99); // make sure position is within the subtexture
  pos /= numTextures;
  pos.y += float(index) * texRelHeight;
  return texture(surfaceTextureMap, pos);
}


// Two octaves of value noise from the noise texture, used for surface detail instead of a
// single sample. One sample of a smooth texture just dims the whole surface evenly, which is
// what made the terrain look like flat putty; a real ground surface needs detail that goes both
// darker and lighter than its base colour.
//
// The noise texture is mipmapped, and at the frequencies this is sampled at the driver picks a
// high mip level and hands back the average colour, i.e. no detail at all. The LOD is therefore
// pinned: a blurred octave for the large patchiness, a sharp one for the grain.
vec3 surfaceDetail(vec2 coord, float scale)
{
  vec2 p = coord * scale;
  vec3 patches = textureLod(noiseTex, p, 2.0).rgb;
  vec3 grain = textureLod(noiseTex, p * 3.1 + vec2(0.37, 0.11), 0.0).rgb;
  return mix(patches, grain, 0.40);
}

// How steep the ground is here, in cells of rise per cell across. Read straight out of the
// distance field: VERT_DISTANCE is how far the surface is above this column, so the difference
// between the two neighbouring columns is the local gradient of the surface.
float getSurfaceSlope()
{
  ivec4 wallLeft = texture(wallTex, texCoordXmY0);
  ivec4 wallRight = texture(wallTex, texCoordXpY0);

  float heightLeft = float(-wallLeft[VERT_DISTANCE]) + 1.0;
  float heightRight = float(-wallRight[VERT_DISTANCE]) + 1.0;

  return clamp(abs(heightRight - heightLeft) * 0.5, 0.0, 1.0);
}

vec3 getWallColor(float depth)
{
  vec2 surfaceCoord = vec2(texCoord.x * resolution.x, texCoord.y * resolution.y);

  // How much vegetation is actually growing here, and how healthy it is.
  float vegAmount = clamp(float(wall[VEGETATION]) / 60.0, 0.0, 1.0);
  float moisture = clamp(water[SOIL_MOISTURE] / fullGreenSoilMoisture, 0.0, 1.0);
  float lushness = vegAmount * smoothstep(0.05, 0.55, moisture);

  // grass goes from deep green while there is water to straw when the soil dries out
  const vec3 lushGrassCol = pow(vec3(0.10, 0.42, 0.12), vec3(GAMMA));
  const vec3 parchedGrassCol = pow(vec3(0.66, 0.55, 0.26), vec3(GAMMA));
  vec3 vegetationCol = mix(parchedGrassCol, lushGrassCol, smoothstep(0.0, 0.8, moisture));

  vec3 bareSoilCol = mix(bareDrySoilCol, bareWetSoilCol, map_rangeC(water[SOIL_MOISTURE], 0.0, 40.0, 0.0, 1.0));

  vec3 surfCol = mix(bareSoilCol, vegetationCol, lushness);

  // Bedrock exposure on steep slopes and deep inside the wall.
  float slope = getSurfaceSlope();
  float cliff = smoothstep(0.5, 0.95, slope);
  float bedrock = clamp(max(cliff * 0.7 * (1.0 - smoothstep(0.5, 6.0, depth)), smoothstep(10.0, 50.0, depth) * 0.6), 0.0, 1.0);

  // rock is not a flat grey: it is darker in the cracks and warmer where the light reaches it
  const vec3 rockCol = pow(vec3(0.42, 0.38, 0.34), vec3(GAMMA));
  const vec3 rockLitCol = pow(vec3(0.58, 0.53, 0.46), vec3(GAMMA));
  vec3 bedrockCol = mix(rockCol, rockLitCol, surfaceDetail(surfaceCoord, 0.06).r);
  bedrockCol *= 0.65 + 0.7 * surfaceDetail(surfaceCoord, 0.17).g; // strata and cracks

  vec3 color = mix(surfCol, bedrockCol, bedrock);

  // Multi-scale surface detail: patches of ground cover plus fine grain. The strength is
  // deliberately moderate: at full weight the cell-scale grain of the noise texture turns the
  // hillside into speckle, and it was part of what read as "blurry" at normal zoom.
  color *= mix(1.0, 0.55 + 0.90 * surfaceDetail(surfaceCoord, 0.16).g, 0.38 * (1.0 - bedrock));
  color *= mix(1.0, 0.62 + 0.76 * surfaceDetail(surfaceCoord * 0.3, 0.05).b, 0.32);

  // soil that has never been wet is bleached, so it is less saturated than fresh soil
  color = mix(vec3(dot(color, vec3(0.33, 0.42, 0.25))), color, 0.75 + 0.25 * smoothstep(0.0, 12.0, water[SOIL_MOISTURE]));

  // ── relief shading ───────────────────────────────────────────────────────
  // Approximate a surface normal from the height field and use it to modulate the surface colour
  // with a Lambertian term, the way relief shading works on a topographic map.
  //
  // The baseline is two cells, not one: the height field is a staircase of whole cells, so a
  // one cell baseline sees a full cell of rise on a smooth 45 degree slope and nothing on a flat
  // stretch, and the brightness then alternates column by column (vertical stripes down every
  // hillside). Two cells halve that quantisation, and the weight is kept low so what is left of
  // it stays gentle.
  ivec4 wallLeft = texture(wallTex, texCoordXmY0 - vec2(texelSize.x, 0.0));
  ivec4 wallRight = texture(wallTex, texCoordXpY0 + vec2(texelSize.x, 0.0));
  float hL = float(-wallLeft[VERT_DISTANCE]) + 1.0;
  float hR = float(-wallRight[VERT_DISTANCE]) + 1.0;
  // Surface normal: X component from the height difference, Y = 1 (facing up)
  vec2 surfNormal2D = normalize(vec2(-(hR - hL) * 0.25, 1.0));
  // Sun direction in the 2D side view: x = sin(sunAngle), y = cos(sunAngle)
  float sunDot = max(dot(surfNormal2D, vec2(sin(sunAngle), cos(sunAngle))), 0.0);
  // Gentle Lambertian term (0.45 ambient + 0.55 directional) mixed into the surface
  float surfaceLighting = 0.45 + 0.55 * sunDot;
  color *= mix(1.0, surfaceLighting, 0.30 * (1.0 - bedrock));

  // Snow cover, with the faint blue shadow tint snow actually has.
  const vec3 snowCol = pow(vec3(0.86, 0.89, 0.96), vec3(GAMMA));
  float snowCover = clamp(min(water[SNOW], fullWhiteSnowHeight) / fullWhiteSnowHeight - max(depth * 0.3, 0.0), 0.0, 1.0);
  // snow has subtle sparkle: a high-frequency noise modulates its brightness
  float snowSparkle = 0.90 + 0.10 * surfaceDetail(surfaceCoord, 0.22).r;
  color = mix(color, snowCol * mix(0.82, 1.0, snowSparkle), snowCover);

  return color;
}

const vec2 lightningTexRes = vec2(1024, 2048);
const float lightningTexAspect = lightningTexRes.x / lightningTexRes.y;

float calcLightningTime(float startIterNum)
{
  float lightningTime = iterNum - startIterNum;
  return lightningTime / 5.0; // 30.0    0. to 1. leader stage, 1. + Flash stage
}

float lightningIntensityOverTime(float Tin, vec2 lightningPos, float intensity)
{
  // Tin is normalized by calcLightningTime(): 0..1 is the leader phase,
  // then the return stroke arrives. Keep the leader very dim and make the
  // visible strike a compact cluster of hard, deterministic flicker pulses.
  float strikeT = Tin - 1.0;
  float intensitySq = pow(max(intensity, 0.0), 2.0);

  if (strikeT < 0.0) {
    float leaderRamp = smoothstep(0.65, 1.0, Tin);
    return leaderRamp * intensitySq * 0.015;
  }

  const float burstDuration = 0.62;
  if (strikeT > burstDuration) {
    return 0.0;
  }

  float pulseCount = floor(map_range(random2d(lightningPos * 5.137 + vec2(0.71)), 0.0, 1.0, 4.0, 8.0));
  float burst = 0.0;

  for (int i = 0; i < 8; i++) {
    float idx = float(i);
    float activePulse = 1.0 - step(pulseCount, idx);
    float pulseHash = random2d(lightningPos * (idx + 2.731) + vec2(idx * 19.17, 3.11));
    float pulseStart = 0.015 + idx * 0.055 + pulseHash * 0.045;
    float pulseAge = strikeT - pulseStart;

    float attack = smoothstep(0.0, 0.012, pulseAge);
    float falloff = exp(-max(pulseAge, 0.0) * map_range(pulseHash, 0.0, 1.0, 18.0, 34.0));
    float pulseShape = attack * falloff * step(0.0, pulseAge);
    float pulseAmp = map_range(random2d(lightningPos * (idx + 7.913) - vec2(1.7, idx)), 0.0, 1.0, 0.45, 1.25);
    burst += pulseShape * pulseAmp * activePulse;
  }

  float quickClamp = pow(max(1.0 - strikeT / burstDuration, 0.0), 2.5);
  return burst * quickClamp * intensitySq;
}

vec3 displayLightning(vec2 pos, float lightningTime, float currentLightningIntensity)
{
  vec2 lightningTexCoord = texCoord;

  lightningTexCoord.x -= mod(pos.x, 1.);

  lightningTexCoord.y -= pos.y;

  float scaleMult = 1. / pos.y; // 1.0 means lightning is as tall as the simheight

  lightningTexCoord.x *= scaleMult * aspectRatios[0] / lightningTexAspect;
  lightningTexCoord.y *= -scaleMult;

  lightningTexCoord.x += 0.5;                                                                                               // center lightning bolt

  if (lightningTexCoord.x < 0.01 || lightningTexCoord.x > 1.01 || lightningTexCoord.y < 0.01 || lightningTexCoord.y > 1.01) // prevent edge effect when mipmapping
    return vec3(0);

  float pixVal = texture(lightningTex, lightningTexCoord).r;

  const float branchShowFactor = 2.5;       // 1.5
  const float leaderBrightness = 50000.;    // 200.0
  const float mainBoltBrightness = 100000.; // 100000.

  float brightnessThreshold = 1. - lightningTime * branchShowFactor;
  brightnessThreshold += lightningTexCoord.y * branchShowFactor; // grow from the top to the bottem

  brightnessThreshold = clamp(brightnessThreshold, 0., 1.);

  if (lightningTime > 1.0) { // main bolt
    brightnessThreshold = 0.95;
    currentLightningIntensity *= mainBoltBrightness;
  } else {
    currentLightningIntensity *= leaderBrightness;
  }

  pixVal -= brightnessThreshold;

  pixVal = max(pixVal, 0.0);

  pixVal *= currentLightningIntensity;

  const vec3 lightningCol = vec3(0.70, 0.57, 1.0); // 0.584, 0.576, 1.0

  vec3 outputColor = max(pixVal * lightningCol, vec3(0));

  return outputColor;
}


float saturate(float x) { return min(1.0, max(0.0, x)); }
vec3 saturate(vec3 x) { return min(vec3(1., 1., 1.), max(vec3(0., 0., 0.), x)); }


vec3 bump3y(vec3 x, vec3 yoffset)
{
  vec3 y = vec3(1., 1., 1.) - x * x;
  y = saturate(y - yoffset);
  return y;
}
vec3 spectral_zucconi(float w)
{
  // w: [400, 700] wavelenght(nm)
  // x: [0,   1]
  float x = saturate((w - 400.0) / 300.0);
  const vec3 cs = vec3(3.54541723, 2.86670055, 2.29421995);
  const vec3 xs = vec3(0.69548916, 0.49416934, 0.28269708);
  const vec3 ys = vec3(0.02320775, 0.15936245, 0.53520021);
  return bump3y(cs * (x - xs), ys);
}


vec4 getAirColor(vec2 fragCoordIn)
{
  vec2 bndFragCoord = vec2(fragCoordIn.x, clamp(fragCoordIn.y, 0., resolution.y)); // bound y within range
  base = bilerpWallVis(baseTex, wallTex, bndFragCoord);
  wall = texture(wallTex, bndFragCoord * texelSize);                               // texCoord
  water = bilerpWallVis(waterTex, wallTex, bndFragCoord);
  lightIntensity = texture(lightTex, bndFragCoord * texelSize)[0] / standardSunBrightness;

  ivec4 wallX0Ym = texture(wallTex, texCoordX0Ym);

  float realTemp = potentialToRealT(base[TEMPERATURE]);

  bool nightTime = abs(sunAngle) > 85.0 * deg2rad; // false = day time

  shadowLight = minShadowLight;

  // fragmentColor = vec4(vec3(light),1); return; // View light texture for debugging

  float cloudwater = water[CLOUD];

  // ── cloud shading ────────────────────────────────────────────────────────
  // How brightly a cloud is lit depends on how much sunlight actually reaches that cell:
  // lightIntensity is the sunlight the simulation has left after the cloud above has absorbed
  // and reflected its share, so tops come out bright and thick bases come out grey.
  //
  // This used to be driven by the screen height (texCoord.y) instead, which is not a property of
  // the cloud at all: every cloud pixel sits in the upper part of the screen, so every cloud was
  // painted the same near-white whatever its thickness, and the whole sky turned milky.
  float cloudDensity = max(cloudwater * 13.6, 0.0);
  float totalDensity = cloudDensity + water[PRECIPITATION] * 0.8; // visualize precipitation

  float cloudOpacity = clamp(1.0 - (1.0 / (1. + totalDensity)), 0.0, 1.0);

  float cloudLitFactor = clamp(0.25 + 0.90 * lightIntensity, 0.0, 1.0);
  const vec3 cloudTopCol = vec3(0.88, 0.90, 0.94);
  const vec3 cloudBaseCol = vec3(0.34, 0.38, 0.46); // pre-gamma-corrected
  vec3 cloudCol = mix(cloudBaseCol, cloudTopCol, cloudLitFactor);

  // Dense cloud bodies are darker than their sunlit tops
  cloudCol *= mix(1.0, 0.70, clamp(totalDensity * 0.25, 0.0, 1.0));

  // Thin clouds at the edges are slightly translucent, showing a bluish tint from scattering
  float cloudThickness = clamp(totalDensity * 0.04, 0.0, 1.0);
  vec3 cloudEdgeTint = vec3(0.55, 0.62, 0.74);
  cloudCol = mix(cloudEdgeTint, cloudCol, cloudThickness);

  // Sunset/sunrise: clouds pick up the colour of the sunlight
  float scatering = clamp(map_range(abs(sunAngle), 75. * deg2rad, 90. * deg2rad, 0.0, 1.0), 0.0, 1.0);
  cloudCol = mix(cloudCol, cloudCol * sunColor(scatering) * 1.5, scatering * 0.7);
  // Night clouds: very dim, just slightly brighter than the sky
  float night = clamp(map_range(abs(sunAngle), 90. * deg2rad, 100. * deg2rad, 0.0, 1.0), 0.0, 1.0);
  cloudCol *= mix(1.0, 0.08, night);

  const vec3 smokeThinCol = vec3(0.8, 0.51, 0.26);
  const vec3 smokeThickCol = vec3(0., 0., 0.);


  float smokeOpacity = clamp(1. - (1. / (water[SMOKE] + 1.)), 0.0, 1.0);
  float fireIntensity = clamp((smokeOpacity - 0.8) * 25., 0.0, 1.0);

  // ── black-body fire colour ───────────────────────────────────────────────
  // Fire colour follows a temperature gradient: deep red at the cool edges,
  // through orange and yellow, to near-white at the hottest core.
  // Uses simple mix with linear ramps instead of smoothstep for performance.
  vec3 fireCol;
  {
    float fi = fireIntensity;
    const vec3 fireRed    = vec3(0.62, 0.08, 0.003);  // pre-gamma-corrected
    const vec3 fireOrange = vec3(0.96, 0.30, 0.02);
    const vec3 fireYellow = vec3(1.00, 0.72, 0.12);
    const vec3 fireWhite  = vec3(1.00, 0.92, 0.70);
    fireCol = mix(fireRed, fireOrange, clamp(fi * 3.33, 0.0, 1.0));           // 0..0.3
    fireCol = mix(fireCol, fireYellow, clamp((fi - 0.3) * 3.33, 0.0, 1.0)); // 0.3..0.6
    fireCol = mix(fireCol, fireWhite, clamp((fi - 0.6) * 2.5, 0.0, 1.0));   // 0.6..1.0
    fireCol *= 4.0; // emissive
  }

  vec3 smokeOrFireCol = mix(mix(smokeThinCol, smokeThickCol, smokeOpacity), fireCol, fireIntensity);

  shadowLight += fireIntensity * 2.5;                                                                                 // 1.5

  float opacity = 1. - (1. - smokeOpacity) * (1. - cloudOpacity);                                                     // alpha blending
  vec3 color = (smokeOrFireCol * smokeOpacity / max(opacity, 0.001)) + (cloudCol * cloudOpacity * (1. - smokeOpacity) / max(opacity, 0.001)); // color blending


  vec4 lightningData = texture(lightningDataTex, vec2(0.5));
  vec2 lightningPos = lightningData.xy;
  float lightningStartIterNum = lightningData[START_ITERNUM];

  float lightningTime = calcLightningTime(lightningStartIterNum);
  float currentLightningIntensity = lightningIntensityOverTime(lightningTime, lightningPos, lightningData[INTENSITY]);


  if (lightningData[INTENSITY] > 1.0) { // CG
    emittedLight += displayLightning(lightningPos, lightningTime, currentLightningIntensity);
    emittedLight /= 1. + cloudDensity * 100.0;
  }

#define lightningOnLightBrightness 0.004 // 0.002

  vec2 dist = vec2(lightningPos.x - texCoord.x, max((abs(lightningPos.y / 2. - texCoord.y) - 0.1), 0.));
  dist.x *= aspectRatios[0];
  float lightningOnLight = lightningOnLightBrightness / (pow(length(dist), 2.) + 0.03);
  lightningOnLight *= currentLightningIntensity;
  onLight += vec3(lightningOnLight);

  return vec4(color, opacity);
}

float rand(float n) { return fract(sin(n) * 43758.5453123); }

void main()
{
  vec2 bndFragCoord = vec2(fragCoord.x, clamp(fragCoord.y, 0., resolution.y)); // bound y within range
  base = bilerpWallVis(baseTex, wallTex, bndFragCoord);
  wall = texture(wallTex, bndFragCoord * texelSize);                           // texCoord
  water = bilerpWallVis(waterTex, wallTex, bndFragCoord);
  lightIntensity = texture(lightTex, bndFragCoord * texelSize)[0] / standardSunBrightness;

  ivec4 wallX0Ym = texture(wallTex, texCoordX0Ym);

  float realTemp = potentialToRealT(base[TEMPERATURE]);

  bool nightTime = abs(sunAngle) > 85.0 * deg2rad; // false = day time

  shadowLight = minShadowLight;

  // fragmentColor = vec4(vec3(light),1); return; // View light texture for debugging

  float cloudwater = water[CLOUD];

  if (texCoord.y < 0.) {                                     // < texelSize.y below simulation area

    float depth = float(-wall[VERT_DISTANCE]) - fragCoord.y; // -1.0?

    color = getWallColor(depth);

    lightIntensity = texture(lightTex, vec2(texCoord.x, texelSize.y))[0] / standardSunBrightness; // sample lowest part of sim area
    lightIntensity *= pow(0.5, -fragCoord.y);                                                     // 0.5 should be same as in lightingshader deeper is darker

  } else if (texCoord.y > 1.0) {                                                                  // above simulation area
    // color = vec3(0); // no need to set
    opacity = 0.0;                  // completely transparent
  } else if (wall[DISTANCE] == 0) { // is wall
                                    // color = getWallColor(texCoord);

    ivec4 wallXmY0 = texture(wallTex, texCoordXmY0);
    ivec4 wallXpY0 = texture(wallTex, texCoordXpY0);
    ivec4 wallX0Ym = texture(wallTex, texCoordX0Ym);

    // A wall is decided one cell at a time, so the silhouette against the sky is a staircase of
    // cell sized steps and the landscape looks like it is built out of blocks. The display is
    // alpha blended over the sky, so fading the top of the open surface column into the sky
    // over a fraction of a cell antialiases the step without changing the simulation data.
    if (wallX0Ym[DISTANCE] != 0) {          // the cell above is open: this is a surface cell
      opacity = min(opacity, 1.0 - smoothstep(0.55, 1.0, fract(fragCoord.y)));
    }

    // Sunlight does not cross the surface: the lighting pass stores the light that reaches a cell
    // in the air, and inside a wall it stores zero ("all light absorbed by ground", the reflected
    // part is added to the emitted light that is blurred into the ambient term). Sampling the
    // light texture at the fragment's own cell therefore gave every terrain pixel below the
    // surface nothing to be lit by, which is why the ground read as a black silhouette and the
    // whole scene depended on the screen bloom to be visible at all.
    //
    // The sunlight a surface actually receives is the one in the air cell just above it: the
    // surface of this column is (-wall[VERT_DISTANCE]) + 1 cells up (VERT_DISTANCE is 0 at the
    // surface and counts downwards, or positive above ground). Water walls store their own light
    // and are left alone.
    //
    // The sample is taken a few cells up rather than at the surface itself. The terrain is a
    // staircase of whole cells and the sunlight is ray marched, so on a slope lit at a grazing
    // angle the cell directly above each tread sits in the alternating shadow of the next riser:
    // sampling there draws a picket fence of bright and dark columns down every hillside.
    // A few cells higher the staircase pattern has washed out and what is left is the real
    // shading of the hill.
    if (wall[TYPE] != WALLTYPE_WATER) {
      const float surfaceLightSampleHeight = 5.5; // cells above the surface
      float surfaceLightCoordY = texCoord.y + (float(-wall[VERT_DISTANCE]) + surfaceLightSampleHeight) * texelSize.y;
      lightIntensity = texture(lightTex, vec2(texCoord.x, clamp(surfaceLightCoordY, 0.0, 1.0)))[0] / standardSunBrightness;
    }

    switch (wall[TYPE]) {
      // case WALLTYPE_INERT:
      //   color = vec3(0, 0, 0);
      //   break;

    case WALLTYPE_RUNWAY:

      if (wall[VERT_DISTANCE] == 0) {
        vec2 modTexCoord = mod(texCoord * resolution, 1.0);

        color = vec3(0.1);
        color *= texture(noiseTex, vec2(texCoord.x * resolution.x, texCoord.y * resolution.y) * 0.2).rgb; // add noise texture

        if (length(modTexCoord - vec2(0.7, 0.97)) < 0.03) {                                               // side lights
          onLight += vec3(1., 0.8, 0.3) * 300.0;
        }

        if (abs(mod(-iterNum - floor(texCoord.x * resolution.x), 150.0)) < 1.0 && length(modTexCoord - vec2(0.2, 0.98)) < 0.02) {
          onLight += vec3(0., 1.0, 0.) * 5000.0;
        }

        break;
      }

    case WALLTYPE_URBAN:
    case WALLTYPE_INDUSTRIAL:
    case WALLTYPE_FIRE:
    case WALLTYPE_LAND:

      // horizontally interpolate depth value
      float interpDepth = mix(mix(float(-wallXmY0[VERT_DISTANCE]), float(-wall[VERT_DISTANCE]), clamp(fract(fragCoord.x) + 0.5, 0.5, 1.)), float(-wallXpY0[VERT_DISTANCE]), clamp(fract(fragCoord.x) - 0.5, 0., 0.5));
      float depth = interpDepth - fract(fragCoord.y); // - 1.0 ?

      color = getWallColor(depth);

      break;
    case WALLTYPE_WATER:

      // Travelling wave components of the water surface. This was five summed octaves,
      // which is ten sin() calls for every water pixel (five frequencies for each of the
      // left and right travelling waves) to move the surface by a fraction of a cell. Two
      // components keep the wind dependent motion, at 40% of the cost.
      // Frequencies
      const int numWaveComp = 2;
      const float freqs[numWaveComp] = float[numWaveComp](2.3, 6.7);
      // Amplitudes
      const float amps[numWaveComp] = float[numWaveComp](0.055, 0.025);
      // Speeds
      const float speeds[numWaveComp] = float[numWaveComp](0.008, 0.024);
      // Phases (in radians)
      const float phases[numWaveComp] = float[numWaveComp](1.2, 4.4);

      // Sum up the components
      float waveSignalL = 0.0;
      float waveSignalR = 0.0;

      for (int i = 0; i < numWaveComp; i++) {
        waveSignalL += sin(fragCoord.x * freqs[i] + iterNum * speeds[i] + phases[i]) * amps[i];
        waveSignalR += sin(fragCoord.x * freqs[i] - iterNum * speeds[i] + phases[i]) * amps[i];
      }

      vec4 baseX0Yp = texture(baseTex, texCoordX0Yp);
      float windSpeed = baseX0Yp[VX] * 10.;

      // combine based on wind direction
      float waterLevel = 0.8 + waveSignalL * max(-windSpeed, 0.) + waveSignalR * max(windSpeed, 0.);

      if (wall[VERT_DISTANCE] == 0 && fract(fragCoord.y) > waterLevel) { // air
        vec4 airColor = getAirColor(fragCoord + vec2(0., 0.5));

        opacity = airColor.a;
        color = airColor.rgb;
      } else {
        // ── water body ────────────────────────────────────────────────────────────
        // Beer-Lambert style depth-dependent absorption: shallow water is turquoise
        // because short wavelengths scatter back; deep water is near-black because
        // all wavelengths are absorbed over long path lengths.
        float depthBelowSurface = max(-float(wall[VERT_DISTANCE]) - (waterLevel - fract(fragCoord.y)), 0.0); // cells below the water line

        float shallow = exp(-depthBelowSurface * 0.55);

        const vec3 shallowCol = pow(vec3(0.18, 0.55, 0.62), vec3(GAMMA)); // turquoise, lit from above
        const vec3 deepCol = pow(vec3(0.02, 0.06, 0.15), vec3(GAMMA));    // very dark blue, light fully absorbed
        const vec3 sandCol = pow(vec3(0.55, 0.48, 0.36), vec3(GAMMA));    // the lit bottom, seen through very shallow water

        color = mix(deepCol, shallowCol, shallow);

        // ── Fresnel reflection ────────────────────────────────────────────────
        // At grazing angles the water reflects the sky instead of transmitting
        // light through itself. This makes the horizon band of the sea a
        // mirror of the sky, the way real water looks.
        float viewAngle = clamp(fract(fragCoord.y) - waterLevel + 1.0, 0.0, 1.0);
        float fresnel = pow(1.0 - viewAngle, 4.0) * 0.40;
        // The reflected colour is a hint of the sky, matched to the sky shader's horizon so the
        // sea does not read as a brighter blue-white sheet than the sky above it
        vec3 skyReflectCol = pow(vec3(0.47, 0.65, 0.85), vec3(GAMMA));
        color = mix(color, skyReflectCol * clamp(lightIntensity, 0.0, 1.5), fresnel);

        // The bottom shows through only in the last fraction of a cell.
        float seeThrough = smoothstep(0.55, 0.0, depthBelowSurface) * 0.35;
        color = mix(color, sandCol * (0.5 + 0.7 * shallow), seeThrough);

        // ── wave surface detail ──────────────────────────────────────────────
        // Specular highlight from the wave signal, simulating sunlight glinting
        // off a rippled surface. Everything comes from the wave sum above: no extra
        // sin() calls, and the power is done as multiplications instead of pow().
        float waveSlope = (waveSignalL + waveSignalR) * freqs[0];
        float ripple = 0.5 + 0.5 * sin(waveSignalL * 12.0 + phases[1]);

        float glintBase = clamp(1.0 - abs(waveSlope) * 0.3 - (1.0 - ripple) * 0.2, 0.0, 1.0);
        float glint2 = glintBase * glintBase;
        float glint = glint2 * glint2 * glint2; // ^6 without pow()

        // only the very top of the water column gets the reflection of the sky
        float surfaceBand = smoothstep(0.25, 0.0, waterLevel - fract(fragCoord.y));
        color += vec3(0.95, 0.97, 1.0) * glint * surfaceBand * 0.28 * clamp(lightIntensity, 0.0, 2.0);

        // Subtle subsurface scattering: a thin bright band just below the surface
        // where sunlight has scattered through the upper layer of water.
        float subsurface = smoothstep(0.0, 0.3, waterLevel - fract(fragCoord.y)) * smoothstep(1.5, 0.3, waterLevel - fract(fragCoord.y));
        color += vec3(0.08, 0.22, 0.18) * subsurface * clamp(lightIntensity, 0.0, 1.5) * shallow;

        // foam where the water meets the ground, and on the crests of the waves
        float shoreFoam = smoothstep(0.45, 0.0, depthBelowSurface);
        // Wave crest foam: where the wave slope changes rapidly
        float crestFoam = smoothstep(0.4, 0.8, abs(waveSlope) * 8.0) * surfaceBand;
        float foam = max(shoreFoam, crestFoam * 0.4);
        vec3 foamCol = vec3(0.85, 0.90, 0.94) * (0.50 + 0.50 * ripple);
        color = mix(color, foamCol, foam * 0.35);
      }

      // draw 45° slopes under water

      float localX = fract(fragCoord.x);
      float localY = fract(fragCoord.y);

      if (wallXmY0[DISTANCE] == 0 && wallXmY0[TYPE] != WALLTYPE_WATER && (fragCoord.y < 1. || wallX0Ym[TYPE] != WALLTYPE_WATER)) { // wall to the left and below
        if (localX + localY < 1.0) {
          opacity = 1.0;
          water = texture(waterTex, texCoord);
          color = getWallColor(float(-wall[VERT_DISTANCE]) - localY);
          shadowLight = minShadowLight;
        }
      }
      if (wallXpY0[DISTANCE] == 0 && wallXpY0[TYPE] != WALLTYPE_WATER && (fragCoord.y < 1. || wallX0Ym[TYPE] != WALLTYPE_WATER)) { // wall to the right and below
        if (localY - localX < 0.0) {
          opacity = 1.0;
          water = texture(waterTex, texCoord);
          color = getWallColor(float(-wall[VERT_DISTANCE]) - localY);
          shadowLight = minShadowLight;
        }
      }

      break;
    }
  } else { // air

    vec4 airColor = getAirColor(fragCoord);

    opacity = airColor.a;
    color = airColor.rgb;


    // ── rainbow ────────────────────────────────────────────────────────────────
    // A rainbow needs a low, bright sun and rain in the air. This branch runs for every
    // sky pixel, and the arc geometry (length, atan), the spectral curve and the alpha
    // term used to be computed unconditionally even in a clear sky at noon. Bail out
    // before the geometry unless the arc can actually contribute.
    float rainbowIntensity = min(pow(lightIntensity, 2.0) * 1.9, 1.0) * min(water[PRECIPITATION] * 3.0, 1.0);
    float rainSnowFactor = map_rangeC(KtoC(realTemp), 0.0, 5.0, 0.0, 1.0);

    if (rainbowIntensity > 0.001 && rainSnowFactor > 0.001) {
      vec2 rainbowCenter = vec2(0.0, -1.5 + abs(sunAngle) * 0.60);
      float centerDist = length(onScreenUV - rainbowCenter) * 1.3;
      const float cameraHeight = 1.0;
      float angle = atan(centerDist / cameraHeight) * rad2deg;
      float arcFade = smoothstep(39.5, 40.5, angle) * smoothstep(43.0, 42.0, angle);

      if (arcFade > 0.0) {
        float waveLength = map_range(angle, 40.0, 42.5, 400., 700.);
        vec3 rainbowCol = spectral_zucconi(waveLength) * rainbowIntensity * rainSnowFactor * 0.7 * arcFade;

        emittedLight += rainbowCol;
        opacity = max(opacity - length(rainbowCol), 0.);
      }
    }


    if (wall[VERT_DISTANCE] >= 0 && wall[VERT_DISTANCE] < 10) { // near surface
      float localX = fract(fragCoord.x);
      float localY = fract(fragCoord.y);
      // ivec4 wallX0Ym = texture(wallTex, texCoordX0Ym);

#define texAspect 2560. / 4096. // height / width of tree texture
#define maxTreeHeight 40.       // height in meters when vegetation max = 127
#define maxBuildingHeight 400.  // height in meters upto wich the urban texture reaches


      if (wallX0Ym[TYPE] == WALLTYPE_URBAN) {

        float heightAboveGround = localY + float(wall[VERT_DISTANCE] - 1);

        float urbanTexHeightNorm = maxBuildingHeight / cellHeight; // example: 200 / 40 = 5

        float urbanTexCoordX = mod(fragCoord.x, resolution.x) * texAspect / urbanTexHeightNorm;
        float urbanTexCoordY = heightAboveGround / urbanTexHeightNorm;

        // urbanTexCoordY += map_rangeC(float(wallX0Ym[VEGETATION]), 127., 50., 0., 1.0); // building height

        urbanTexCoordY = 1.0 - urbanTexCoordY;

        vec4 texCol = surfaceTexture(URBAN, vec2(urbanTexCoordX, urbanTexCoordY));
        if (texCol.a > 0.5) { // if not transparent

          if (nightTime) {
            shadowLight = 1.0;                 // city lights
            texCol.rgb *= vec3(1.0, 0.8, 0.5); // yellowish windows
          } else {                             // day time
            texCol.rgb *= vec3(0.8, 0.9, 1.0); // Blueish windows

            if (length(texCol.rgb) < 0.1)
              texCol.rgb = texture(noiseTex, fragCoord * 0.3).rgb * 0.3;
          }
          color = texCol.rgb;
          opacity = texCol.a;
        }
      } else if (wallX0Ym[TYPE] == WALLTYPE_INDUSTRIAL) {

        float heightAboveGround = localY + float(wall[VERT_DISTANCE] - 1);

        float urbanTexHeightNorm = maxBuildingHeight / cellHeight; // example: 200 / 40 = 5

        float urbanTexCoordX = mod(fragCoord.x, resolution.x) * texAspect / urbanTexHeightNorm;
        float urbanTexCoordY = heightAboveGround / urbanTexHeightNorm;

        // urbanTexCoordY += map_rangeC(float(wallX0Ym[VEGETATION]), 127., 50., 0., 1.0); // building height

        urbanTexCoordY = 1.0 - urbanTexCoordY;

        vec4 texCol = surfaceTexture(INDUS, vec2(urbanTexCoordX, urbanTexCoordY));
        if (texCol.a > 0.5) { // if not transparent

          if (nightTime) {
            shadowLight = 1.0;                 // city lights
            texCol.rgb *= vec3(1.0, 0.8, 0.5); // yellowish windows
          } else {                             // day time
            texCol.rgb *= vec3(0.8, 0.9, 1.0); // Blueish windows

            if (length(texCol.rgb) < 0.1)
              texCol.rgb = texture(noiseTex, fragCoord * 0.3).rgb * 0.3;
          }
          color = texCol.rgb;
          opacity = texCol.a;
        }
      }


      if (wall[VERT_DISTANCE] == 1) {                                                 // 1 above surface
                                                                                      //  if (wallX0Ym[VERT_DISTANCE] == 0) {

        float treeTexHeightNorm = maxTreeHeight / cellHeight;                         // example: 40 / 120 = 0.333

        float treeTexCoordY = localY / treeTexHeightNorm;                             // full height trees

        treeTexCoordY += map_rangeC(float(wallX0Ym[VEGETATION]), 127., 50., 0., 1.0); // apply trees height depending on vegetation

        float treeTexCoordX = fragCoord.x * texAspect / treeTexHeightNorm;            // static scaled trees

        float heightAboveGround = localY / treeTexHeightNorm;

        treeTexCoordX -= base.x * heightAboveGround * 1.00; // 2.5  trees waving with the wind effect

        treeTexCoordX *= 0.72;                              // Trees only go up to 72% of the texture height
        treeTexCoordY *= 0.72;                              // Trees only go up to 72% of the texture height
        treeTexCoordY = 1. - treeTexCoordY;                 // texture is upside down

        // The five sub textures are stacked in one image, and each of them only fills the upper
        // half of its own fifth. surfaceTexture() maps 0..1 onto the whole fifth, so a full
        // height tree reached past the artwork into the transparent gap above it and came back
        // with an alpha of 0: the canopies were never drawn at all. Rescale into the half that
        // actually has trees in it.
        treeTexCoordY = 0.5 + 0.5 * treeTexCoordY;

        vec4 texCol;
        if (wallX0Ym[TYPE] == WALLTYPE_LAND || wallX0Ym[TYPE] == WALLTYPE_URBAN) { // land below
          vec4 surfaceWater = texture(waterTex, texCoordX0Ym);                     // snow on land below
          float snow = surfaceWater[SNOW];
          if (snow * 0.01 / cellHeight > heightAboveGround)
            texCol = vec4(vec3(1.), 1.);                                                                                                                          // show white snow layer above ground
          else {                                                                                                                                                  // display vegetation
          vec4 treeColor = surfaceTexture(FOREST, vec2(treeTexCoordX, treeTexCoordY));
          // How much of the green has gone out of the canopy as the soil dries.
          const vec3 parchedCanopyCol = vec3(0.42, 0.38, 0.20); // pre-gamma-corrected
          float parched = map_rangeC(surfaceWater[SOIL_MOISTURE], 4.0, 40.0, 0.85, 0.0) * treeColor.a;
          vec4 vegetationCol = mix(treeColor, vec4(parchedCanopyCol, 1.), parched);
          // The underside of a canopy is in its own shadow, darker at the base
          vegetationCol.rgb *= mix(0.55, 1.0, clamp(localY / max(treeTexHeightNorm, 0.001), 0.0, 1.0));
          texCol = mix(vegetationCol, surfaceTexture(SNOW_FOREST, vec2(treeTexCoordX, treeTexCoordY)), min(snow / fullWhiteSnowHeight, 1.0));
          }
        } else if (wallX0Ym[TYPE] == WALLTYPE_FIRE) {
          texCol = surfaceTexture(FIRE_FOREST, vec2(treeTexCoordX, treeTexCoordY));
        }
        if (texCol.a > 0.5) { // if not transparent
          color = texCol.rgb;

          shadowLight = minShadowLight;        // make sure trees are dark at night

          if (wallX0Ym[TYPE] == WALLTYPE_FIRE) // fire below
            shadowLight = 1.0;

          opacity = 1. - (1. - opacity) * (1. - texCol.a); // alpha blending
        }

        // draw 45° slopes
        ivec4 wallXmY0 = texture(wallTex, texCoordXmY0);
        ivec4 wallXpY0 = texture(wallTex, texCoordXpY0);

        if (wallXmY0[DISTANCE] == 0 && wall[TYPE] != WALLTYPE_WATER) { // wall to the left and below
          if (localX + localY < 1.0) {
            opacity = 1.0;
            water = texture(waterTex, texCoordX0Ym);
            color = getWallColor(localY - 0.6);
            shadowLight = minShadowLight; // fire should not light ground
          }
        }
        if (wallXpY0[DISTANCE] == 0 && wall[TYPE] != WALLTYPE_WATER) { // wall to the right and below
          if (localY - localX < 0.0) {
            opacity = 1.0;
            water = texture(waterTex, texCoordX0Ym);
            color = getWallColor(localY - 0.6);
            shadowLight = minShadowLight; // fire should not light ground
          }
        }
      }
    }
    float arrow = vectorField(base.xy, displayVectorField);

    if (arrow > 0.5) {
      fragmentColor = vec4(vec3(1., 1., 0.), 1.);
      return; // exit shader
    }

    // color.rg += vec2(arrow);
    // color.b -= arrow;
    // opacity += arrow;
    // lightIntensity += arrow;
  }


  float scatering = clamp(map_range(abs(sunAngle), 75. * deg2rad, 90. * deg2rad, 0., 1.), 0., 1.); // how red the sunlight is

  vec3 finalLight = sunColor(scatering) * lightIntensity;


  if (fract(cursor.w) > 0.5) {                                               // enable flashlight
    vec2 vecFromMouse = cursor.xy - texCoord;
    vecFromMouse.x *= texelSize.y / texelSize.x;                             // aspect ratio correction to make it a circle
                                                                             // shadowLight += max(1. / (1.+length(vecFromMouse)*5.0),0.0); // point light
    shadowLight += max(cos(min(length(vecFromMouse) * 5.0, 2.)) * 1.0, 0.0); // smooth flashlight
  }

  // ── skylight in the shadows ──────────────────────────────────────────────
  // The ambient term is the emitted light that the lighting pass collected and the blur
  // chain diffused: the light reflected off the clouds, the ground and the sea. It is what
  // a shadowed surface is lit by in the real world, but the display only added it below the
  // simulation area (the pow(1 - (-texCoord.y * 15)) ramp, which is zero for every texCoord.y
  // >= 0, that is, the whole visible scene). Every pixel in a cast shadow therefore received
  // as little light as the minShadowLight floor, a deep blue-black, and terrain shadows read
  // as wet black paint. The ground, unlike the sky, is a reflecting surface, so it gets the
  // full ambient term; the sky is left to the sky shader, which handles this itself. The term
  // is weighted and capped so a shadow stays darker than the sunlit side of the same surface.
  vec3 ambientLight = texture(ambientLightTex, texCoord).rgb;

  if (texCoord.y >= 0.) {
    const float ambientGroundFactor = 2.2; // reflected light reaches every surface regardless of cloud
    onLight += ambientLight * ambientGroundFactor;
    onLight = min(onLight, vec3(0.30));    // skylight never bridges the gap to direct sunlight
  } else {
    onLight += ambientLight * pow(1. - clamp(-texCoord.y * 15., 0., 1.), 2.5);
  }


  finalLight += vec3(shadowLight) + onLight;

  // ── atmospheric perspective (distance fog) ─────────────────────────────────
  // A slight fade towards the horizon colour for depth. This is deliberately weak: at 0.35 it
  // mixed every surface in the lower half of the screen a third of the way towards a bright
  // blue-white, which washed out the terrain (and read as blur, since contrast is what the eye
  // reads as sharpness).
  float fogDistance = clamp(1.0 - texCoord.y, 0.0, 1.0); // more fog near ground
  float fogFactor = fogDistance * fogDistance * 0.12; // quadratic falloff, cheaper than pow()

  // Fog colour follows the sky at the horizon: pale blue during the day, orange at sunset.
  // These match the sky shader's horizon colour so fogged terrain still blends into the sky.
  vec3 horizonFogCol;
  {
    float nightFactor = clamp(map_range(abs(sunAngle), 90. * deg2rad, 100. * deg2rad, 0.0, 1.0), 0.0, 1.0);
    vec3 dayFogCol = pow(vec3(0.49, 0.66, 0.85), vec3(GAMMA));
    vec3 sunsetFogCol = pow(vec3(0.80, 0.50, 0.30), vec3(GAMMA));
    const vec3 nightFogCol = vec3(0.008, 0.012, 0.025); // pre-computed dark blue
    horizonFogCol = mix(dayFogCol, sunsetFogCol, scatering * 0.7);
    horizonFogCol = mix(horizonFogCol, nightFogCol, nightFactor);
  }

  // Apply fog to surface/terrain for depth perception
  color = mix(color, horizonFogCol, fogFactor);

  opacity += length(emittedLight);
  opacity = clamp(opacity, 0.0, 1.0);
  fragmentColor = vec4(max(color * finalLight, 0.) + emittedLight, opacity);

  drawCursor(cursor, view); // over everything else
}
