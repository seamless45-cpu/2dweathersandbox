#version 300 es
// Separable Gaussian pass for the screen bloom.
//
// The bloom chain used to run a 4-tap Kawase filter, which only averages the four diagonal
// neighbours: to reach a visible width it had to be applied again and again (up to six passes per
// level), and stacking box filters that way leaves the glow with a square, tiered outline. One
// real Gaussian, run once horizontally and once vertically per level, is the same amount of blur
// for two passes, and it falls off smoothly.
//
// 13 taps at **one texel apart**, sigma 2.2. The spacing is the important part. The kernel used
// to be 9 taps two texels apart, and a lightning channel is one texel wide in the bright pass: a
// delta convolved with taps at even offsets only has energy at even offsets again, so every other
// column of the glow came out exactly zero. Six pixels apart on screen, that is a visible grid of
// stripes and squares around the bolt, and no amount of extra blur removed it because the gaps
// were in the geometry of the kernel rather than in how much it blurred. The step passed in from
// the caller is the texel size, so the reach here is six texels per direction.
precision highp float;
precision highp sampler2D;

in vec2 texCoord;

uniform sampler2D inputTexture;
uniform vec2 direction; // one texel step (scaled by the radius) in each axis

out vec4 fragmentColor;

void main()
{
  vec4 sum = texture(inputTexture, texCoord) * 0.1819;

  sum += (texture(inputTexture, texCoord + direction) + texture(inputTexture, texCoord - direction)) * 0.1640;
  sum += (texture(inputTexture, texCoord + direction * 2.0) + texture(inputTexture, texCoord - direction * 2.0)) * 0.1203;
  sum += (texture(inputTexture, texCoord + direction * 3.0) + texture(inputTexture, texCoord - direction * 3.0)) * 0.0718;
  sum += (texture(inputTexture, texCoord + direction * 4.0) + texture(inputTexture, texCoord - direction * 4.0)) * 0.0348;
  sum += (texture(inputTexture, texCoord + direction * 5.0) + texture(inputTexture, texCoord - direction * 5.0)) * 0.0137;
  sum += (texture(inputTexture, texCoord + direction * 6.0) + texture(inputTexture, texCoord - direction * 6.0)) * 0.0044;

  fragmentColor = sum;
}
