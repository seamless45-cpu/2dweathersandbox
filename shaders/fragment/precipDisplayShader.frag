#version 300 es
precision highp float;

in vec2 position_out;
in vec2 mass_out;
in float density_out;
in vec2 quadCoord_out; // [-1,1] within the sprite

out vec4 fragmentColor;

// Precipitation mass:
#define WATER 0
#define ICE 1

void main()
{
  // Inactive droplets carry a negative water mass.
  if (mass_out[WATER] < 0.)
    discard;

  // Soft round drop instead of a square quad.
  float r2 = dot(quadCoord_out, quadCoord_out);
  if (r2 > 1.0)
    discard;

  // Edge feather so overlapping drops blend smoothly.
  float edge = 1.0 - smoothstep(0.55, 1.0, sqrt(r2));

  float totalMass = max(mass_out[WATER] + mass_out[ICE], 0.0);
  float opacity = totalMass * 0.10 * edge;

  if (mass_out[ICE] > 0.) {                           // has ice
    if (mass_out[WATER] == 0.) {                      // pure ice
      if (density_out < 1.0)                           // snow
        fragmentColor = vec4(1.0, 1.0, 1.0, opacity); // white
      else
        fragmentColor = vec4(1.0, 1.0, 0.0, opacity); // hail
    } else {                                          // mix of ice and water
      fragmentColor = vec4(0.5, 1.0, 1.0, opacity);   // light blue
    }
  } else {                                            // rain
    fragmentColor = vec4(0.0, 0.5, 1.0, opacity);     // dark blue
  }
}
