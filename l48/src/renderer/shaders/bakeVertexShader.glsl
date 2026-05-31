#version 300 es

precision highp float;

layout(location = 0) in vec2 aPosition;
layout(location = 1) in vec2 aTexCoord;

out vec2 vTexCoord;
out vec3 vVoxelPos;

uniform float uVoxelResolution;
uniform int uSliceIndex;
uniform int uSliceDirection;

void main() {
    vTexCoord = aTexCoord;

    vec3 voxelPos;
    if (uSliceDirection == 0) {
        voxelPos = vec3(float(uSliceIndex), aTexCoord.y * uVoxelResolution, aTexCoord.x * uVoxelResolution);
    } else if (uSliceDirection == 1) {
        voxelPos = vec3(aTexCoord.x * uVoxelResolution, float(uSliceIndex), aTexCoord.y * uVoxelResolution);
    } else {
        voxelPos = vec3(aTexCoord.x * uVoxelResolution, aTexCoord.y * uVoxelResolution, float(uSliceIndex));
    }

    vVoxelPos = voxelPos;

    gl_Position = vec4(aPosition, 0.0, 1.0);
}
