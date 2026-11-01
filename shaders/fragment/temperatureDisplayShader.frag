#version 300 es
precision highp float;
precision highp isampler2D;

in vec2 texCoord;
in vec2 fragCoord;

uniform sampler2D baseTex;
uniform isampler2D wallTex;
uniform sampler2D colorScalesTex;

uniform vec2 resolution;
uniform vec2 texelSize;

uniform float dryLapse;

uniform float displayVectorField;

uniform vec3 view;   // Xpos  Ypos    Zoom
uniform vec4 cursor; // xpos   Ypos  Size   type

out vec4 fragmentColor;

#include "common.glsl"
#include "commonDisplay.glsl"


void main()
{
  // vec4 base = texture(baseTex, texCoord);
  //  vec4 base = bilerp(baseTex, fragCoord);
  vec4 base = bilerpWall(baseTex, wallTex, fragCoord);
  ivec2 wall = texture(wallTex, texCoord).xy;

  float realTempC = KtoC(potentialToRealT(base[3]));

  if (wall[1] == 0) {  // is wall
    switch (wall[0]) { // wall type
    case 0:
      fragmentColor = vec4(0, 0, 0, 1);
      break;
    case 1: // land wall
      fragmentColor = vec4(vec3(0.10), 1.0);
      break;
    case 2: // water wall
      // fragmentColor = vec4(0, 0.5, 0.99, 1);
      // Water stores its absolute temperature, so it uses the same kelvin ramp as the air.
      fragmentColor = vec4(temperatureRamp(base[3]), 1.0);
      break;
    case 3: // Fire wall
      fragmentColor = vec4(1.0, 0.5, 0.0, 1);
      break;
    }
  } else { // fluid

    // Potential temperature -> the real temperature at that height, in kelvin: the colour follows
    // the absolute temperature directly (see temperatureRamp in commonDisplay.glsl).
    fragmentColor = vec4(temperatureRamp(potentialToRealT(base[3])), 1.0);

    drawVectorField(base.xy, displayVectorField);
  }

  // drawDirLines(base.xy);
  // drawIsoLines(base[2]);
  drawCursor(cursor, view);
}