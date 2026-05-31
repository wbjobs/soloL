#version 300 es

precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aTexCoord;

uniform mat4 uModelMatrix;
uniform mat4 uViewMatrix;
uniform mat4 uProjectionMatrix;

uniform vec3 uVoxelGridCenter;
uniform vec3 uVoxelGridSize;
uniform float uVoxelResolution;

out vec3 vWorldPosition;
out vec3 vNormal;
out vec3 vVoxelCoord;
out vec2 vTexCoord;

void main() {
    vec4 worldPos = uModelMatrix * vec4(aPosition, 1.0);
    vWorldPosition = worldPos.xyz;
    vNormal = normalize(mat3(uModelMatrix) * aNormal);
    vTexCoord = aTexCoord;

    vec3 halfSize = uVoxelGridSize * 0.5;
    vec3 localPos = worldPos.xyz - uVoxelGridCenter + halfSize;
    vec3 voxelSize = uVoxelGridSize / uVoxelResolution;
    vVoxelCoord = localPos / voxelSize;

    gl_Position = uProjectionMatrix * uViewMatrix * worldPos;
}
