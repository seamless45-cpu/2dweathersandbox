#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 fragCoord;
in vec2 texCoord;

uniform vec2 resolution;
uniform vec2 texelSize;
uniform vec2 aspectRatios;

uniform sampler2D lightTex;
uniform sampler2D planeTex;
uniform sampler2D planeGearTex;

uniform sampler2D ambientLightTex;

uniform float minShadowLight;

uniform float sunAngle; // elevation of the sun, 0 = straight up, 90 = at the horizon

uniform float iterNum;

uniform float simHeight;

uniform vec2 planeDirectionAndGearPos;

uniform vec3 planePos;

out vec4 fragmentColor;

float light;

vec3 ambientLight;

const float dryLapse = 0.; // definition needed for common.glsl
#include "common.glsl"

#include "commonDisplay.glsl"

vec4 displayA380(vec2 pos, float angle, out vec3 emittedLight, out vec3 onLight)
{
  vec2 planeTexCoord = texCoord;

  bool planeDir = planeDirectionAndGearPos[0] == 1.; // true = left, false = right

  planeTexCoord.x -= mod(pos.x, 1.);
  // planeTexCoord.x = realMod(planeTexCoord.x, 1.0);
  planeTexCoord.y -= pos.y;
  float cellHeight = simHeight / resolution.y;

  float scaleMult = 60.0 / cellHeight; // 6000

  planeTexCoord.x *= scaleMult * aspectRatios.x;
  planeTexCoord.y *= -scaleMult;

  // planeTexCoord.y -= 0.7;

  // rotate

  float sin_factor = sin(angle);
  float cos_factor = cos(angle);

  planeTexCoord = vec2(planeTexCoord.x, planeTexCoord.y) * mat2(cos_factor, sin_factor, -sin_factor, cos_factor);

  planeTexCoord *= 0.15;              // scale
  planeTexCoord *= vec2(500., 1000.); // Aspect ratio

  planeTexCoord += vec2(0.5, 0.6);    // center rotation point


  if (planeTexCoord.x < 0.01 || planeTexCoord.x > 1.01 || planeTexCoord.y < 0.01 || planeTexCoord.y > 1.01) // prevent edge effect when mipmapping
    return vec4(0);

  vec2 gearTexCoord = vec2(planeDir ? planeTexCoord.x - 0.10 : 0.90 - planeTexCoord.x, (planeTexCoord.y - 0.46 + planeDirectionAndGearPos[1] * 0.01)) * 2.0;

  vec4 outputCol = texture(planeTex, planeTexCoord);

  vec2 planeFragCoord = planeTexCoord * vec2(1000., 500.);

  float T = mod(iterNum, 60.) / 60.;

  emittedLight += (planeDir ? vec3(1., 0., 0.) : vec3(0., 1., 0.)) * 5. * max(3. - length(planeFragCoord - vec2(planeDir ? 611. : 391., 287.)), 0.);      // wing red/green continuous light
  emittedLight += vec3(1., 1., 1.) * 5. * max(3. - length(planeFragCoord - vec2(planeDir ? 861. : 138., 286.)), 0.);                                      // Tail white continuous light

  emittedLight += vec3(1., 0., 0.) * 20. * max(7. - length(planeFragCoord - vec2(planeDir ? 341. : 659., 256.)), 0.) * ((T > 0.5 && T < 0.55) ? 1. : 0.); // red beacon light top

  emittedLight += vec3(1., 0., 0.) * 10. * max(5. - length(planeFragCoord - vec2(planeDir ? 460. : 540., 347.)), 0.) * ((T > 0.5 && T < 0.55) ? 1. : 0.); // red beacon light bottem

  emittedLight +=
    vec3(0.50, 0.65, 1.) * 30. * max(7. - length(planeFragCoord - vec2(planeDir ? 611. : 387., 287.)), 0.) * (((T > 0.0 && T < 0.05) || (T > 0.10 && T < 0.15)) ? 1. : 0.); // white wing beacon light

  emittedLight += vec3(1., 1., 1.) * 20. * max(7. - length(planeFragCoord - vec2(planeDir ? 861. : 138., 286.)), 0.) * ((T > 0.0 && T < 0.05) ? 1. : 0.);                   // Tail white beacon light


  float planeCenterLight = texture(lightTex, pos)[0]; // W/m2

  if (planeCenterLight < 100.0) {                     // if dark

                                                      // logo lights:
    onLight += vec3(1., 1., 1.) * (1. - smoothstep(0.0, 130.0, length(planeFragCoord - vec2(planeDir ? 800. : 210., 170.)))); // Tail logo

    // landing lights:
    if (planeDirectionAndGearPos[1] < 2.0) {                                                                                   // gear extended
      emittedLight += vec3(0.8, 0.9, 1.0) * 30. * max(3. - length((planeFragCoord - vec2(planeDir ? 170. : 836., 350.))), 0.); // Front gear landing light

      emittedLight += vec3(0.8, 0.9, 1.0) * 30. * max(3. - length((planeFragCoord - vec2(planeDir ? 336. : 660., 323.))), 0.); // Wing landing light

      onLight += vec3(1., 1., 1.) * 0.9 * (1. - smoothstep(0.0, 150.0, length(planeFragCoord - vec2(planeDir ? 220. : 770., 400.))));
    }
  }

  if (outputCol.a < 0.5)
    outputCol += texture(planeGearTex, gearTexCoord);

  onLight *= outputCol.a; // only shine on plane itself
  return outputCol;
}


void main()
{
  vec2 lightTexCoord = vec2(texCoord.x, min(texCoord.y + texelSize.y * 0.5, 1.0 - texelSize.y)); // limit vertical sample position to top of simulation

  light = texture(lightTex, lightTexCoord)[0] / standardSunBrightness;
  ambientLight = texture(ambientLightTex, texCoord).rgb;

  // ── sky gradient ──────────────────────────────────────────────────────────────
  // Physically-based sky approximation using Rayleigh and Mie scattering.
  // Rayleigh scattering is wavelength-dependent and makes the sky blue overhead;
  // Mie scattering is wavelength-independent and makes the sky bright/white near
  // the sun and at the horizon.
  float height01 = clamp(texCoord.y, 0.0, 1.0); // 0 = horizon, 1 = top of the screen

  // Rayleigh-like vertical falloff: steep blue overhead, lighter towards horizon
  float skyHeight = pow(height01, 0.55);

  // linear-space sky colours. Reworked to read as a deeper, more saturated real sky rather
  // than a washed-out pale blue: a darker, more saturated zenith (deep air mass overhead),
  // a richer mid band, and a horizon that keeps its blue (a real horizon is not white — the
  // previous near-pale values washed out against the bright sunlight the sky is multiplied by).
  const vec3 zenithCol = vec3(0.010, 0.042, 0.20);
  const vec3 midSkyCol = vec3(0.045, 0.160, 0.44);
  const vec3 horizonCol = vec3(0.130, 0.300, 0.60);

  // Three-stop gradient for richer sky colour
  vec3 mixedCol;
  if (skyHeight > 0.5) {
    mixedCol = mix(midSkyCol, zenithCol, (skyHeight - 0.5) * 2.0);
  } else {
    mixedCol = mix(horizonCol, midSkyCol, skyHeight * 2.0);
  }

  // ── Mie scattering (brightening near sun/horizon) ──────────────────────────
  // The sun's position brightens the sky around it. We approximate the Mie
  // scattering lobe with a polynomial instead of exp() for performance.
  float sunElevNorm = clamp(cos(sunAngle), 0.0, 1.0); // how high the sun is
  float sunY = sunElevNorm; // approximate sun position in screen Y
  float sunDist = abs(height01 - sunY);
  float mieLobe = max(0.0, 1.0 - sunDist * 2.5) * 0.18 * sunElevNorm; // polynomial approximation of exp(-x²*8)
  vec3 mieCol = vec3(0.95, 0.90, 0.80); // warm white
  mixedCol += mieCol * mieLobe;

  // Aerial haze near the horizon: a gentle hint of the horizon colour, not a white-out. Kept
  // restrained so the lower band keeps its blue instead of washing out against the sunlight.
  float haze = pow(1.0 - height01, 9.0);
  mixedCol = mix(mixedCol, horizonCol, haze * 0.38);

  // The sky takes the colour of the sunlight, so at sunrise and sunset it reddens
  float scatering = clamp(map_range(abs(sunAngle), 75. * deg2rad, 90. * deg2rad, 0.0, 1.0), 0.0, 1.0);
  mixedCol = mix(mixedCol, mixedCol * sunColor(scatering) * 1.6, scatering * 0.8);

  // ── sunset/sunrise band ────────────────────────────────────────────────────
  // A warm orange-red band appears near the horizon when the sun is low.
  // Uses polynomial falloff instead of pow() for performance.
  float horizonFade = (1.0 - height01) * (1.0 - height01); // quadratic, cheaper than pow()
  float sunsetBand = scatering * horizonFade * 1.5;
  const vec3 sunsetCol = vec3(0.82, 0.32, 0.08); // pre-gamma-corrected
  mixedCol = mix(mixedCol, sunsetCol, clamp(sunsetBand, 0.0, 0.6));

  // At night the sky is very dark with faint airglow
  float night = clamp(map_range(abs(sunAngle), 90. * deg2rad, 100. * deg2rad, 0.0, 1.0), 0.0, 1.0);
  const vec3 nightZenithCol = vec3(0.002, 0.005, 0.018);
  const vec3 nightHorizonCol = vec3(0.015, 0.025, 0.050);
  mixedCol = mix(mixedCol, mix(nightHorizonCol, nightZenithCol, skyHeight), night);

  vec3 airplaneLights;

  vec3 airplaneOnLight;

  vec4 A380Col = displayA380(planePos.xy, planePos.z, airplaneLights, airplaneOnLight);

  mixedCol *= 1.0 - A380Col.a;
  mixedCol += A380Col.rgb * A380Col.a;

  vec3 finalColor = mixedCol * (light + minShadowLight + airplaneOnLight);

  float airDensityFactor = clamp(1.0 - texCoord.y, 0., 1.);

  finalColor += ambientLight * 0.1 * airDensityFactor / standardSunBrightness;

  finalColor += airplaneLights;

  fragmentColor = vec4(finalColor, 1.0);
}