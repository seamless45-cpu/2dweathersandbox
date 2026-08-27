#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 fragCoord;

in vec2 texCoord;     // this
in vec2 texCoordXmY0; // left
in vec2 texCoordX0Ym; // down
in vec2 texCoordXpY0; // right
in vec2 texCoordX0Yp; // up

uniform sampler2D baseTex;
uniform sampler2D waterTex;
uniform sampler2D vortForceTex;
uniform isampler2D wallTex;
uniform sampler2D lightTex;
uniform sampler2D precipFeedbackTex;
uniform sampler2D precipDepositionTex;

uniform float dryLapse;
uniform float evapHeat;
uniform vec2 resolution;
uniform vec2 texelSize;
uniform float vorticity;
uniform float waterEvaporation;
uniform float landEvaporation;
uniform float waterWeight;
uniform vec4 initial_Tv[126];
uniform bool allowCaves;

float getInitialT(int y) { return initial_Tv[y / 4][y % 4]; }

uniform float sunAngle;

uniform float iterNum; // used as seed for random function

uniform float dynamicWaterTemperature;

layout(location = 0) out vec4 base;
layout(location = 1) out vec4 water;
layout(location = 2) out ivec4 wall;

#include "common.glsl"

#define minimalFireVegetation 20

#define minimalFireIntensity 0.002

#define wallVerticalInfluence 1 // 2 How many cells above the wall surface effects like heating and evaporation are applied


// #define wallManhattanInfluence 2 // 2 How many cells from the nearest wall effects like smoothing and drag are applied
#define exchangeRate 0.015       // Rate of smoothing near surface

void exchangeWith(vec2 texCoord) // exchange temperature and water
{
  // base[TEMPERATURE] -= (base[TEMPERATURE] - texture(baseTex, texCoord)[TEMPERATURE]) * exchangeRate;
  // water[0] -= (water[0] - texture(waterTex, texCoord)[0]) * exchangeRate;

  base[VX] -= (base[VX] - texture(baseTex, texCoord)[VX]) * exchangeRate;
}


float calcEvaporation(float T, float W, float V, float M)                                             // temperature, total water, vegetation, soil moisture
{
  float maxW = maxWater(T);
  float deficit = max(maxW - W, 0.0) / maxW;
  float vegFactor = V / 127.0 + 0.1;
  float moistureFactor = M / 50.0 + 0.1;
  return maxW * deficit * landEvaporation * vegFactor * moistureFactor;
}
