#version 300 es
// Bright pass for the screen bloom.
//
// The frame is rendered into an HDR buffer, so "bright" means a value well above 1. Lightning is
// by far the brightest thing in this scene — a return stroke is drawn at a peak of ~14 — which is
// why the bloom is mostly about the bolt: the glow that spreads off a flash is the flash as the
// eye (and a camera lens) actually sees it, and without it a bolt is just a thin white line.
//
// The pass runs at a quarter of the canvas resolution. Sampling with the fragment's own uv is
// enough of a downsample: bilinear filtering of the source at quarter size averages a 4x4 block.
precision highp float;
precision highp sampler2D;

in vec2 texCoord;

uniform sampler2D hdrTex;
uniform float threshold; // linear HDR value above which light starts to bloom
uniform float knee;      // width of the soft ramp above the threshold

out vec4 fragmentColor;

void main()
{
  vec3 c = texture(hdrTex, texCoord).rgb;

  // Only the part of the brightness that is above the threshold blooms, and the ramp is smooth
  // so a gradient across the threshold does not leave a visible edge in the glow.
  float brightness = max(max(c.r, c.g), c.b);
  float over = max(brightness - threshold, 0.0);
  float soft = over * over / (over + knee); // 0 at the threshold, -> over for very bright pixels

  fragmentColor = vec4(c * (soft / max(brightness, 1e-4)), 1.0);
}
