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
// The scene is rendered in linear light into a float texture, and the sun, bright water and
// the lit tops of clouds are all far above 1.0. Without a tone curve everything above 1.0
// simply clips to white, which is what made daylight look flat and washed out: terrain, clouds
// and sky all ended up in the same narrow band near white.
//
// The old line here was `x / (x + 1) * 1.1`, a Reinhard curve with its white point at the bottom
// of the range. It is not a curve anybody shoots with: it starts compressing at black, so it
// darkens the whole image to buy highlight range nobody was using, and it is currently
// commented out, so the image clips instead.
//
// This is the extended Reinhard operator (Reinhard et al. 2005, "Photographic Tone
// Reproduction for Digital Images"). The white point W says what scene value counts as white,
// and the mapping is arranged so x = W lands exactly on 1.0:
//     f(x) = x (1 + x / W^2) / (1 + x)
// Below the toe it is very close to the identity, so shadows and midtones keep the exposure
// they had, and everything above ~1 rolls off smoothly into the display range instead of
// clipping to a flat white blob. The same curve desaturates nothing on its own, so bright
// water and cloud still keep their colour as they approach white.
vec3 reinhardToneMap(vec3 x)
{
  const float whitePoint = 2.2; // scene value that should read as pure white
  return clamp(x * (1.0 + x / (whitePoint * whitePoint)) / (1.0 + x), 0.0, 1.0);
}

// Interleaved gradient noise: a cheap, very evenly distributed dither pattern. A smooth
// gradient like the sky turns into visible bands as soon as the frame buffer only has 8 bits
// per channel, and banding is the single most obvious "this is not a real photograph" cue.
// Adding about one least significant bit of noise before the gamma correction removes it.
float interleavedGradientNoise(vec2 pixel)
{
  return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
}

void main()
{
  vec3 outputCol = texture(hdrTex, texCoord).rgb;

  vec3 bloom = texture(bloomTex, texCoord).rgb;

  // The bloom texture is a blurred copy of the whole frame, so adding all of it lifts the
  // shadows as well and turns the sky milky. Keeping it at a fraction keeps the glow around
  // the sun and bright water without washing out the rest of the image.
  outputCol += bloom * 0.30;

  outputCol *= exposure;

  // 1. filmic highlight rolloff in linear light: the sun, bright water and lit cloud tops come
  //    down smoothly instead of pinning at pure white
  outputCol = reinhardToneMap(outputCol);

  // 2. gamma correction
  outputCol = pow(outputCol, ONE_OVER_GAMMA);

  // 3. gentle S-curve around the middle grey, so the scene does not look flat and hazy once
  //    the highlights have been compressed into a narrower range
  outputCol = mix(outputCol, outputCol * outputCol * (3.0 - 2.0 * outputCol), 0.18);

  // 4. give back a little of the saturation the tone curve takes out of the bright areas, never
  //    past what the display can show
  float luma = dot(outputCol, vec3(0.2126, 0.7152, 0.0722));
  outputCol = clamp(mix(vec3(luma), outputCol, 1.12), 0.0, 1.0);

  // 5. dither, in display space where the 8 bit quantisation actually happens. A smooth sky
  //    otherwise shows hard bands, the most obvious "this is not a photograph" cue there is.
  outputCol += (interleavedGradientNoise(fragCoord) - 0.5) / 255.0;

  fragmentColor = vec4(clamp(outputCol, 0.0, 1.0), 1.0);
}
