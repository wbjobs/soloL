#version 300 es

precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aTexCoord;
layout(location = 3) in vec4 aColor;

uniform mat4 uModelMatrix;
uniform mat4 uViewMatrix;
uniform mat4 uProjectionMatrix;
uniform mat4 uNormalMatrix;

out vec3 vWorldPosition;
out vec3 vNormal;
out vec2 vTexCoord;
out vec4 vColor;
out vec3 vViewPosition;

void main() {
    vec4 worldPos = uModelMatrix * vec4(aPosition, 1.0);
    vWorldPosition = worldPos.xyz;
    
    vec4 viewPos = uViewMatrix * worldPos;
    vViewPosition = viewPos.xyz;
    
    vNormal = normalize((uNormalMatrix * vec4(aNormal, 0.0)).xyz);
    vTexCoord = aTexCoord;
    vColor = aColor;
    
    gl_Position = uProjectionMatrix * viewPos;
}
