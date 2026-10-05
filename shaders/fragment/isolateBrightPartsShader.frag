#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 texCoord;     // this
in vec2 texCoordXmY0; // left
in vec2 texCoordX0Ym; // down
in vec2 texCoordXpY0; // right
in vec2 texCoordX0Yp; // up

uniform sampler2D hdrTex;
out vec3 fragmentColor;

void main()
{
  vec3 outputCol = texture(hdrTex, texCoord).rgb;

  // Simple bright extraction: scale down and threshold. Cheaper than soft-knee
  // but still produces a natural-looking bloom without hard edges.
  float lum = dot(outputCol, vec3(0.2126, 0.7152, 0.0722));

  // Smooth threshold: fade in from zero over a range above the threshold
  float knee = lum - 0.5; // threshold = 0.5
  knee = knee * knee * 6.0; // smooth quadratic ramp, squared for softness
  knee = clamp(knee / max(lum, 0.001), 0.0, 1.0);

  fragmentColor = vec3(outputCol * knee * 3.0);
}
