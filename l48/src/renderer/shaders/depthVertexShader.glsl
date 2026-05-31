#version 300 es

precision highp float;

layout(location = 0) in vec3 aPosition;

uniform mat4 uModelMatrix;
uniform mat4 uViewMatrix;
uniform mat4 uProjectionMatrix;

out vec3 vWorldPosition;
out float vViewDepth;

void main() {
    vec4 worldPosition = uModelMatrix * vec4(aPosition, 1.0);
    vec4 viewPosition = uViewMatrix * worldPosition;
    vec4 clipPosition = uProjectionMatrix * viewPosition;

    vWorldPosition = worldPosition.xyz;
    vViewDepth = -viewPosition.z;

    gl_Position = clipPosition;
}
