#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

vec2 fragCoord;          // (in) not used just defined for commonDisplay.glsl
in vec2 texCoord;        // this
in vec2 texCoordXmY0;    // left
in vec2 texCoordX0Ym;    // down
in vec2 texCoordXpY0;    // right
in vec2 texCoordX0Yp;    // up

uniform vec2 resolution; // sim resolution
uniform vec2 texelSize;

uniform float exposure;

uniform sampler2D hdrTex;
uniform sampler2D bloomTex;  // tight glow (quarter resolution)
uniform sampler2D bloomTex2; // wide halo  (sixteenth)
uniform float bloomStrength;
out vec4 fragmentColor;


#include "commonDisplay.glsl"

// ── tone mapping ────────────────────────────────────────────────────────────────
// ACES filmic tone mapping curve. This gives a natural highlight rolloff,
// preserves saturation in bright areas, and produces a cinematic look.
// Based on the ACES reference implementation (simplified for real-time).
vec3 ACESFilm(vec3 x)
{
  float a = 2.51;
  float b = 0.03;
  float c = 2.43;
  float d = 0.59;
  float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

// Extended Reinhard as fallback / secondary curve
vec3 reinhardToneMap(vec3 x)
{
  const float whitePoint = 2.2;
  return clamp(x * (1.0 + x / (whitePoint * whitePoint)) / (1.0 + x), 0.0, 1.0);
}

// Interleaved gradient noise for dithering
float interleavedGradientNoise(vec2 pixel)
{
  return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
}

void main()
{
  // The scene is rendered into a linear HDR buffer, and the bloom is added back on top of it
  // here, in the same linear units and before tone mapping, so the glow rolls off through the
  // same curve as the light that caused it. The bloom chain only carries light above the
  // threshold (see bloomExtractShader.frag), which in this scene means lightning, the sun and
  // bright sunlit cloud edges — not the whole frame, which is what made the old bloom wash the
  // image out.
  vec3 outputCol = texture(hdrTex, texCoord).rgb;

  // Two levels of glow, weighted so they cannot push the sum above one: the tight one keeps the
  // light on the channel, the wide one is the halo that carries across the sky. Three levels
  // each weighted ~0.55 and multiplied by a strength of 2.4 added up to four times the blurred
  // energy, which is why the glow read as a fog bank pasted over the frame rather than as light
  // coming off the bolt. Sampling the coarse level with the bilinear filter smooths it for free.
  vec3 bloom = texture(bloomTex, texCoord).rgb * 0.62
             + texture(bloomTex2, texCoord).rgb * 0.38;
  outputCol += bloom * bloomStrength;

  outputCol *= exposure;

  // 1. ACES filmic tone mapping: natural highlight rolloff with good saturation
  outputCol = ACESFilm(outputCol);

  // 2. gamma correction
  outputCol = pow(outputCol, ONE_OVER_GAMMA);

  // 3. gentle S-curve for contrast. Kept subtle: it lifts everything above middle grey, and a
  //    strong curve was part of why the daylight image read as overexposed.
  outputCol = mix(outputCol, outputCol * outputCol * (3.0 - 2.0 * outputCol), 0.12);

  // 4. saturation: a small boost to offset what the tone curve takes out of bright areas
  float luma = dot(outputCol, vec3(0.2126, 0.7152, 0.0722));
  outputCol = clamp(mix(vec3(luma), outputCol, 1.10), 0.0, 1.0);

  // 5. subtle vignette: darken the edges to draw focus to the center.
  // Uses squared distance to avoid the sqrt() in length() for performance.
  vec2 vigCoord = texCoord - vec2(0.5);
  vigCoord.x *= 0.7;
  float vigDist2 = dot(vigCoord, vigCoord); // squared distance, no sqrt needed
  float vignette = 1.0 - smoothstep(0.12, 0.72, vigDist2) * 0.28;
  outputCol *= vignette;

  // 6. dither to remove banding in smooth gradients.
  // Use texCoord scaled to approximate pixel space for the noise pattern.
  vec2 ditherCoord = texCoord * 1000.0;
  outputCol += (interleavedGradientNoise(ditherCoord) - 0.5) / 255.0;

  fragmentColor = vec4(clamp(outputCol, 0.0, 1.0), 1.0);
}
