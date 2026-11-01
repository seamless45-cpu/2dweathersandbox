#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 fragCoord;
in vec2 texCoord;

in vec2 texCoordX0Yp; // up
in vec2 texCoordX0Ym; // down

uniform sampler2D precipFeedbackTex;

uniform vec2 resolution;
uniform vec2 texelSize;
uniform float iterNum;
uniform float timeSeconds; // strike clock, seconds (see realisticDisplayShader.frag)

out vec4 lightningLocation;

uniform float dryLapse;

#include "common.glsl"

void main()
{
  // lightningLocation = vec4(0.5, 0.5, 150, 0); // test
  // return;

  vec4 newLightningLocation = texelFetch(precipFeedbackTex, ivec2(1, 0), 0); // read pixel 1, 0 where the lightning location was written to by a precipitation particle


  // The record has to be from this iteration: older than that and it is a leftover from an
  // earlier strike, newer than that and two droplets wrote a strike in the same iteration, which
  // doubles the stored timestamp and is not a valid record either. The comparison is against the
  // strike clock in seconds, which is what the precipitation shader writes.
  if (newLightningLocation[START_ITERNUM] < timeSeconds - 0.05 || newLightningLocation[START_ITERNUM] > timeSeconds + 0.001) {
    discard; // no new lightning strike, so no update
  }

  lightningLocation = newLightningLocation;
}
