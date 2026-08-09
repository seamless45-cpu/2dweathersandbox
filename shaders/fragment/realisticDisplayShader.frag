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
const vec3 bareWetSoilCol = pow(vec3(0.5, 0.2, 0.1), vec3(GAMMA));
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

vec3 getWallColor(float depth)
{
vec3 vegetationCol = mix(greenGrassCol, dryGrassCol, max(1.0 - water[SOIL_MOISTURE] * (1. / fullGreenSoilMoisture), 0.)); // green to brown
vec3 bareSoilCol = mix(bareDrySoilCol, bareWetSoilCol, map_rangeC(water[SOIL_MOISTURE], 0.0, 20.0, 0.0, 1.0));
vec3 surfCol = mix(bareSoilCol, vegetationCol, min(float(wall[VEGETATION]) / 50., 1.));
const vec3 rockCol = vec3(0.70);                                 // gray rock
vec3 color = mix(surfCol, rockCol, clamp(depth * 0.35, 0., 1.)); // * 0.15
color *= texture(noiseTex, vec2(texCoord.x * resolution.x, texCoord.y * resolution.y) * 0.2).rgb;                                   // add noise texture
color = mix(color, vec3(1.0), clamp(min(water[SNOW], fullWhiteSnowHeight) / fullWhiteSnowHeight - max(depth * 0.3, 0.), 0.0, 1.0)); // mix in white for snow cover
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

// ---------------------------------------------------------------------------
// Rainbow spectrum: integrates spectral bands across the bow. Each wavelength
// peaks at its own deflection angle (angViolet for 400 nm, angRed for 700 nm),
// which produces the colour dispersion and soft bow edges. Swap angViolet /
// angRed to get the reversed order of the secondary bow.
// ---------------------------------------------------------------------------
vec3 rainbowSpectrum(float angle, float angViolet, float angRed, float width, float strength)
{
vec3 col = vec3(0.0);
const int SPECTRAL_SAMPLES = 14;
for (int i = 0; i < SPECTRAL_SAMPLES; i++) {
float t = float(i) / float(SPECTRAL_SAMPLES - 1);
float wl = mix(400.0, 700.0, t);
float bowAngle = mix(angViolet, angRed, t);
float d = (angle - bowAngle) / width;
col += spectral_zucconi(wl) * exp(-d * d);
}
return col * (strength * 2.4 / float(SPECTRAL_SAMPLES));
}

// ---------------------------------------------------------------------------
// Procedural animated precipitation droplets (world space, driven by iterNum)
// ---------------------------------------------------------------------------

// One parallax layer of rain streaks. 'amount' in [0,1] scales droplet density,
// 'slant' tilts the streaks with the wind.
float rainLayer(vec2 uv, float t, float layer, float amount, float slant)
{
if (amount <= 0.001)
return 0.0;
float scale = mix(34.0, 68.0, layer);       // spatial frequency of the streak field
float speed = mix(0.030, 0.052, layer);     // fall speed in screen heights per iteration
vec2 suv = vec2(uv.x + uv.y * slant, uv.y); // wind slants the streaks
vec2 p = vec2(suv.x * scale, (suv.y + t * speed) * scale * 0.42);
// desynchronise the columns so streaks don't fall in lockstep
float colRnd = random2d(vec2(floor(p.x) * 0.371, layer * 13.73));
p.y += colRnd * 64.0;
vec2 id = floor(p);
vec2 f = fract(p) - 0.5;
float rnd = random2d(id + layer * 7.31);
float densityGate = step(1.0 - amount, random2d(id + 41.7 + layer * 3.13));
float thickness = 0.07 + 0.08 * rnd;
float halfLen = 0.16 + 0.24 * rnd;
float streak = (1.0 - smoothstep(thickness * 0.25, thickness, abs(f.x))) *
               (1.0 - smoothstep(halfLen * 0.15, halfLen, abs(f.y)));
return streak * densityGate * (0.45 + 0.55 * rnd);
}

// One parallax layer of slowly drifting snow flakes.
float snowLayer(vec2 uv, float t, float layer, float amount, float slant)
{
if (amount <= 0.001)
return 0.0;
float scale = mix(24.0, 46.0, layer);
float speed = mix(0.0035, 0.0065, layer); // snow drifts down much slower than rain
vec2 p = vec2(uv.x + uv.y * slant * 0.55, uv.y + t * speed) * scale;
vec2 id = floor(p);
vec2 f = fract(p) - 0.5;
float rnd = random2d(id + layer * 11.31);
float densityGate = step(1.0 - amount, random2d(id + 57.17 + layer * 5.93));
vec2 offs = (vec2(rnd, random2d(id + 9.71 + layer * 2.3)) - 0.5) * 0.6;
offs.x += sin(t * mix(0.05, 0.13, rnd) + rnd * 6.2831) * 0.13; // gentle side sway
float radius = 0.055 + 0.095 * rnd;
float flake = 1.0 - smoothstep(radius * 0.2, radius, length(f - offs));
return flake * densityGate * (0.35 + 0.65 * rnd);
}

// Adds animated rain/snow droplets to emittedLight for this air column.
// precip = water[PRECIPITATION], tempC in Celsius, light scales visibility
// (droplets are nearly invisible at night, but flash with lightning).
void applyPrecipitationDroplets(vec2 fragCoordIn, float precip, float windX, float tempC, float light)
{
float amount = clamp(precip * 5.0, 0.0, 1.0);
if (amount <= 0.001)
return;
vec2 uv = fragCoordIn / resolution.y;                  // world space, aspect correct
float rainMix = map_rangeC(tempC, 0.5, 3.0, 0.0, 1.0); // 1 = rain, 0 = snow
float slant = clamp(windX * 1.4, -1.0, 1.0);

float rainAmt = amount * rainMix;
float rain = 0.0;
rain += rainLayer(uv, iterNum, 0.00, rainAmt, slant) * 0.90;
rain += rainLayer(uv, iterNum, 0.50, rainAmt, slant) * 0.60;
rain += rainLayer(uv, iterNum, 1.00, rainAmt, slant) * 0.35;

float snowAmt = amount * (1.0 - rainMix);
float snow = 0.0;
snow += snowLayer(uv, iterNum, 0.00, snowAmt, slant) * 0.90;
snow += snowLayer(uv, iterNum, 0.50, snowAmt, slant) * 0.60;
snow += snowLayer(uv, iterNum, 1.00, snowAmt, slant) * 0.40;

const vec3 rainCol = vec3(0.62, 0.72, 0.95); // cold bluish highlights
const vec3 snowCol = vec3(1.00, 1.00, 1.00);
float dropletLight = clamp(light * 1.15 + 0.03, 0.03, 1.0);
emittedLight += (rain * rainCol + snow * snowCol * 0.85) * dropletLight * 0.8;
}

float rand(float n) { return fract(sin(n) * 43758.5453123); }

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
vec3 cloudCol = vec3(1.0 / (cloudwater * 0.005 + 1.0)); // 0.10 white to black
float cloudDensity = max(cloudwater * 13.6, 0.0);
float totalDensity = cloudDensity + water[PRECIPITATION] * 0.30; // soft rain-shaft haze; individual droplets are drawn by applyPrecipitationDroplets()
// float cloudOpacity = clamp(cloudwater * 4.0, 0.0, 1.0);
float cloudOpacity = clamp(1.0 - (1.0 / (1. + totalDensity)), 0.0, 1.0);

const vec3 smokeThinCol = vec3(0.8, 0.51, 0.26);
const vec3 smokeThickCol = vec3(0., 0., 0.);
float smokeOpacity = clamp(1. - (1. / (water[SMOKE] + 1.)), 0.0, 1.0);
float fireIntensity = clamp((smokeOpacity - 0.8) * 25., 0.0, 1.0);
vec3 fireCol = hsv2rgb(vec3(fireIntensity * 0.008, 0.98, 5.0)) * 1.0; // 1.0, 0.7, 0.0
vec3 smokeOrFireCol = mix(mix(smokeThinCol, smokeThickCol, smokeOpacity), fireCol, fireIntensity);
shadowLight += fireIntensity * 2.5;                                                                                 // 1.5
float opacity = 1. - (1. - smokeOpacity) * (1. - cloudOpacity);                                                     // alpha blending
vec3 color = (smokeOrFireCol * smokeOpacity / opacity) + (cloudCol * cloudOpacity * (1. - smokeOpacity) / opacity); // color blending

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

// animated rain streaks / snow flakes falling through this air column,
// lit by the sun, fire glow and lightning
applyPrecipitationDroplets(fragCoordIn, water[PRECIPITATION], base[VX], KtoC(realTemp),
                           clamp(lightIntensity + shadowLight * 0.35 + dot(onLight, vec3(1.0 / 3.0)), 0.0, 1.5));

return vec4(color, opacity);
}

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
// Precomputed values (tweak to taste)
// Frequencies
const int numWaveComp = 5;
const float freqs[numWaveComp] = float[numWaveComp](2.3, 3.7, 5.1, 7.6, 21.7);
// Amplitudes
const float amps[numWaveComp] = float[numWaveComp](0.05, 0.03, 0.02, 0.015, 0.004);
// Speeds
const float speeds[numWaveComp] = float[numWaveComp](0.006, 0.011, 0.018, 0.025, 0.05);
// Phases (in radians)
const float phases[numWaveComp] = float[numWaveComp](1.2, 3.9, 0.7, 5.1, 3.1);
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
color = vec3(0, 0.5, 1.0); // water
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

// ------------------------------ rainbow -----------------------------------
// Physically-shaped bow around the antisolar point: primary arc 40.0°-42.4°
// (violet->red), fainter secondary arc 50.5°-53.4° with reversed colour
// order, faint supernumerary interference bands just inside the primary,
// and Alexander's dark band falling out naturally between the two arcs.
vec2 rainbowCenter = vec2(0.0, -1.5 + abs(sunAngle) * 0.60); // antisolar point
float centerDist = length(onScreenUV - rainbowCenter) * 1.3;
const float cameraHeight = 1.0;
float viewAngle = atan(centerDist / cameraHeight) * rad2deg;                    // degrees away from antisolar axis
float rainSnowFactor = map_rangeC(KtoC(realTemp), 0.0, 5.0, 0.0, 1.0);          // no bow in snowfall
float sunElevDeg = 90.0 - abs(sunAngle) * rad2deg;
float bowGeoFactor = 1.0 - smoothstep(30.0, 42.0, sunElevDeg);                  // bow sinks below the horizon as the sun rises
float bowStrength = min(pow(lightIntensity, 2.0) * 1.9, 1.0) * min(water[PRECIPITATION] * 3.0, 1.0) * rainSnowFactor * bowGeoFactor;
vec3 rainbowCol = vec3(0.0);
if (bowStrength > 0.001) {
vec3 primary = rainbowSpectrum(viewAngle, 40.0, 42.4, 0.55, 1.00);
vec3 secondary = rainbowSpectrum(viewAngle, 53.4, 50.5, 1.00, 0.40); // reversed order, fainter
// faint supernumerary interference bands just inside the primary bow
float sd = viewAngle - 39.35;
float supernumerary = exp(-sd * sd * 1.1) * (0.30 + 0.70 * cos(sd * 6.5));
vec3 superCol = vec3(0.65, 0.85, 0.60) * max(supernumerary, 0.0) * 0.16;
rainbowCol = (primary + secondary + superCol) * bowStrength * 0.7;
}
emittedLight += rainbowCol;
opacity = max(opacity - length(rainbowCol), 0.); // remove some white rain to prevent overbrightening and increase color saturation

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
vec4 texCol;
if (wallX0Ym[TYPE] == WALLTYPE_LAND || wallX0Ym[TYPE] == WALLTYPE_URBAN) { // land below
vec4 surfaceWater = texture(waterTex, texCoordX0Ym);                     // snow on land below
float snow = surfaceWater[SNOW];
if (snow * 0.01 / cellHeight > heightAboveGround)
texCol = vec4(vec3(1.), 1.);                                                                                                                          // show white snow layer above ground
else {                                                                                                                                                  // display vegetation
vec4 treeColor = surfaceTexture(FOREST, vec2(treeTexCoordX, treeTexCoordY));
vec4 vegetationCol = mix(treeColor, vec4(dryGrassCol, 1.), max(0.5 - surfaceWater[SOIL_MOISTURE] * (0.5 / fullGreenSoilMoisture), 0.) * treeColor.a); // green to brown
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
vec3 ambientLight = texture(ambientLightTex, texCoord).rgb;
onLight += ambientLight * pow(1. - clamp(-texCoord.y * 15., 0., 1.), 2.5);
finalLight += vec3(shadowLight) + onLight;
opacity += length(emittedLight);
opacity = clamp(opacity, 0.0, 1.0);
fragmentColor = vec4(max(color * finalLight, 0.) + emittedLight, opacity);
drawCursor(cursor, view); // over everything else
}
