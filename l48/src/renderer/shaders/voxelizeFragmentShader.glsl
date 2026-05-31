#version 300 es

precision highp float;
precision highp sampler3D;

in vec3 vWorldPosition;
in vec3 vNormal;
in vec3 vVoxelCoord;
in vec2 vTexCoord;

layout(location = 0) out vec4 voxelOutput;

uniform vec3 uVoxelGridCenter;
uniform vec3 uVoxelGridSize;
uniform float uVoxelResolution;

uniform vec3 uAlbedo;
uniform vec3 uEmissive;
uniform float uMetallic;
uniform float uRoughness;

uniform int uFaceIndex;

vec4 packVoxelData(vec3 color, float alpha, vec3 emissive, float roughness) {
    vec3 encodedColor = color;
    float encodedEmissive = dot(emissive, vec3(0.299, 0.587, 0.114));
    float encodedRoughness = roughness;

    return vec4(
        encodedColor.r,
        encodedColor.g,
        encodedColor.b,
        alpha
    );
}

void main() {
    vec3 voxelPos = floor(vVoxelCoord);

    if (any(lessThan(voxelPos, vec3(0.0))) || any(greaterThanEqual(voxelPos, vec3(uVoxelResolution)))) {
        discard;
    }

    vec3 normal = normalize(vNormal);
    vec3 viewDirs[6] = vec3[6](
        vec3(1.0, 0.0, 0.0),
        vec3(-1.0, 0.0, 0.0),
        vec3(0.0, 1.0, 0.0),
        vec3(0.0, -1.0, 0.0),
        vec3(0.0, 0.0, 1.0),
        vec3(0.0, 0.0, -1.0)
    );

    vec3 viewDir = viewDirs[uFaceIndex];
    float ndotv = dot(normal, viewDir);

    if (ndotv < 0.0) {
        discard;
    }

    vec3 color = uAlbedo;
    float alpha = 1.0;

    voxelOutput = packVoxelData(color, alpha, uEmissive, uRoughness);
}
