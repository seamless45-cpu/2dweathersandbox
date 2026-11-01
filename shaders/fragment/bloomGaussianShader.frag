#version 300 es
// Separable Gaussian pass for the screen bloom.
//
// The bloom chain used to run a 4-tap Kawase filter, which only averages the four diagonal
// neighbours: to reach a visible width it had to be applied again and again (up to six passes per
// level), and stacking box filters that way leaves the glow with a square, tiered outline. One
// real Gaussian, run once horizontally and once vertically per level, is the same amount of blur
// for two passes, and it falls off smoothly.
//
// The weights are a normalised sigma = 2 kernel, 9 taps per direction. Both directions use this
// shader; `direction` carries the step, so the caller decides how wide the glow is.
precision highp float;
precision highp sampler2D;

in vec2 texCoord;

uniform sampler2D inputTexture;
uniform vec2 direction; // one texel step (scaled by the radius) in each axis

out vec4 fragmentColor;

void main()
{
  vec4 sum = texture(inputTexture, texCoord) * 0.227027;

  sum += (texture(inputTexture, texCoord + direction) + texture(inputTexture, texCoord - direction)) * 0.1945946;
  sum += (texture(inputTexture, texCoord + direction * 2.0) + texture(inputTexture, texCoord - direction * 2.0)) * 0.1216216;
  sum += (texture(inputTexture, texCoord + direction * 3.0) + texture(inputTexture, texCoord - direction * 3.0)) * 0.0540541;
  sum += (texture(inputTexture, texCoord + direction * 4.0) + texture(inputTexture, texCoord - direction * 4.0)) * 0.0162162;

  fragmentColor = sum;
}
