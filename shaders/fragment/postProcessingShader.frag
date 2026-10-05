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
uniform sampler2D bloomTex;
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
  vec3 outputCol = texture(hdrTex, texCoord).rgb;

  vec3 bloom = texture(bloomTex, texCoord).rgb;

  // Bloom: blend in the bright glow. Slightly stronger than before for more
  // cinematic feel, but still restrained so it doesn't wash out the image.
  outputCol += bloom * 0.35;

  outputCol *= exposure;

  // 1. ACES filmic tone mapping: natural highlight rolloff with good saturation
  outputCol = ACESFilm(outputCol);

  // 2. gamma correction
  outputCol = pow(outputCol, ONE_OVER_GAMMA);

  // 3. gentle S-curve for contrast
  outputCol = mix(outputCol, outputCol * outputCol * (3.0 - 2.0 * outputCol), 0.22);

  // 4. saturation boost: give back saturation the tone curve removes from bright areas
  float luma = dot(outputCol, vec3(0.2126, 0.7152, 0.0722));
  outputCol = clamp(mix(vec3(luma), outputCol, 1.18), 0.0, 1.0);

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
