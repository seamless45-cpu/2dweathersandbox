#version 300 es
// highp, not mediump: texelSize is a uniform shared with the vertex shader, which declares it
// highp. A stage that declares the same uniform at a different precision makes the link fail
// outright ("Precision qualifiers must match"), and the bloom pass then has no program at all.
precision highp float;
precision highp sampler2D;

// in vec2 texCoord;     // this
in vec2 texCoordXmY0; // left
in vec2 texCoordX0Ym; // down
in vec2 texCoordXpY0; // right
in vec2 texCoordX0Yp; // up

in vec2 texCoordXmYp; // left up
in vec2 texCoordXpYm; // right down

out vec4 fragmentColor;

uniform sampler2D bloomTexture;
uniform vec2 texelSize;

void main()
{
  // Kawase dual-filter blur: a cheap approximation of Gaussian blur that
  // produces very smooth, artifact-free results. Samples the 4 diagonal
  // neighbours at 1-texel offset, which gives a smooth kernel when applied
  // repeatedly at decreasing resolutions (the downsample chain).
  // The original 4-tap box blur on axis-aligned neighbours produced visible
  // square artifacts in the bloom halos.

  vec4 s1 = texture(bloomTexture, texCoordXmYp); // top-left
  vec4 s2 = texture(bloomTexture, texCoordXpYm); // bottom-right
  // Construct the missing diagonal corners from the axis-aligned offsets:
  // bottom-left = left offset + down offset
  vec4 s3 = texture(bloomTexture, texCoordXmY0 - vec2(0.0, texelSize.y));
  // top-right = right offset + up offset
  vec4 s4 = texture(bloomTexture, texCoordXpY0 + vec2(0.0, texelSize.y));

  fragmentColor = (s1 + s2 + s3 + s4) * 0.25;
}
