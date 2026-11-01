#version 300 es
// Bright pass for the screen bloom.
//
// The frame is rendered into an HDR buffer, so "bright" means a value well above 1. Lightning is
// by far the brightest thing in this scene — a return stroke is drawn at a peak of ~14 — which is
// why the bloom is mostly about the bolt: the glow that spreads off a flash is the flash as the
// eye (and a camera lens) actually sees it, and without it a bolt is just a thin white line.
//
// The pass runs at a sixth of the canvas resolution, so one texel of the target covers a 6x6
// block of the source. A single bilinear tap is *not* enough for that: bilinear only averages the
// 2x2 block around the sample point, so a feature that is one pixel wide - which is exactly what
// a lightning channel is - is either hit or missed depending on where the tap lands. That is what
// put a dashed grid of bright and dark squares into the glow: the bright pass kept the dashes and
// the blur turned each one into a soft tile. The 4x4 tap grid below averages the whole footprint.
precision highp float;
precision highp sampler2D;

in vec2 texCoord;

uniform sampler2D hdrTex;
uniform float threshold; // linear HDR value above which light starts to bloom
uniform float knee;      // width of the soft ramp above the threshold
uniform vec2 footprint;  // one texel of this target, in uv

out vec4 fragmentColor;

// Average the source over exactly one target texel. This target is a sixth of the canvas, so the
// block is 6x6 source pixels and the taps have to be one source pixel apart: a coarser grid leaves
// gaps that a one pixel wide channel can slip through, which is what brought the stripes back.
// The loop bounds are constant, so this unrolls to 36 bilinear fetches, which at 160x90 is cheap.
vec3 downsampled(vec2 uv)
{
  vec2 stepUV = footprint * (1.0 / 6.0);
  vec3 sum = vec3(0.0);
  for (int y = 0; y < 6; y++)
    for (int x = 0; x < 6; x++)
      sum += texture(hdrTex, uv + (vec2(float(x), float(y)) + 0.5) * stepUV - footprint * 0.5).rgb;
  return sum * (1.0 / 36.0);
}

void main()
{
  vec3 c = downsampled(texCoord);

  // Only the part of the brightness that is above the threshold blooms, and the ramp is smooth
  // so a gradient across the threshold does not leave a visible edge in the glow.
  float brightness = max(max(c.r, c.g), c.b);
  float over = max(brightness - threshold, 0.0);
  float soft = over * over / (over + knee); // 0 at the threshold, -> over for very bright pixels

  fragmentColor = vec4(c * (soft / max(brightness, 1e-4)), 1.0);
}
