#version 300 es

precision highp float;

in vec3 vWorldPosition;
in float vViewDepth;

layout(location = 0) out vec4 fragColor;

uniform float uNear;
uniform float uFar;
uniform vec3 uObjectId;

float linearizeDepth(float depth, float near, float far) {
    return (2.0 * near) / (far + near - depth * (far - near));
}

void main() {
    float linearDepth = linearizeDepth(gl_FragCoord.z, uNear, uFar);

    fragColor = vec4(
        linearDepth,
        vViewDepth / uFar,
        uObjectId.r,
        uObjectId.g
    );
}
