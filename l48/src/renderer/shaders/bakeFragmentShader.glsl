#version 300 es

precision highp float;
precision highp sampler3D;

in vec2 vTexCoord;
in vec3 vVoxelPos;

layout(location = 0) out vec4 irradianceOutput;

uniform sampler3D uVoxelTexture;
uniform vec3 uVoxelGridCenter;
uniform vec3 uVoxelGridSize;
uniform float uVoxelResolution;

uniform int uLightCount;
uniform vec3 uLightPositions[8];
uniform vec3 uLightColors[8];
uniform float uLightIntensities[8];
uniform float uLightRadii[8];
uniform int uLightTypes[8];
uniform vec3 uLightDirections[8];

uniform float uConeStepSize;
uniform int uConeMaxSteps;
uniform float uConeAperture;
uniform int uConeCount;

uniform float uIndirectIntensity;
uniform float uAOIntensity;

const float PI = 3.14159265359;

const vec3 HEMISPHERE_SAMPLES[9] = vec3[9](
    vec3(0.0, 0.0, 1.0),
    vec3(0.7071, 0.0, 0.7071),
    vec3(-0.7071, 0.0, 0.7071),
    vec3(0.0, 0.7071, 0.7071),
    vec3(0.0, -0.7071, 0.7071),
    vec3(0.5774, 0.5774, 0.5774),
    vec3(-0.5774, 0.5774, 0.5774),
    vec3(0.5774, -0.5774, 0.5774),
    vec3(-0.5774, -0.5774, 0.5774)
);

const float HEMISPHERE_WEIGHTS[9] = float[9](
    1.0 / 6.0,
    1.0 / 6.0,
    1.0 / 6.0,
    1.0 / 6.0,
    1.0 / 6.0,
    1.0 / 24.0,
    1.0 / 24.0,
    1.0 / 24.0,
    1.0 / 24.0
);

vec3 worldToVoxel(vec3 worldPos) {
    vec3 halfSize = uVoxelGridSize * 0.5;
    vec3 localPos = worldPos - uVoxelGridCenter + halfSize;
    vec3 voxelSize = uVoxelGridSize / uVoxelResolution;
    return localPos / voxelSize;
}

vec3 voxelToWorld(vec3 voxelPos) {
    vec3 voxelSize = uVoxelGridSize / uVoxelResolution;
    vec3 localPos = (voxelPos + 0.5) * voxelSize;
    vec3 halfSize = uVoxelGridSize * 0.5;
    return localPos - halfSize + uVoxelGridCenter;
}

vec4 sampleVoxelTrilinear(vec3 voxelPos) {
    vec3 texCoord = voxelPos / uVoxelResolution;

    if (any(lessThan(texCoord, vec3(0.0))) || any(greaterThan(texCoord, vec3(1.0)))) {
        return vec4(0.0);
    }

    return texture(uVoxelTexture, texCoord);
}

vec4 sampleVoxelAnisotropic(vec3 voxelPos, vec3 direction) {
    vec3 absDir = abs(direction);
    vec3 texCoord = voxelPos / uVoxelResolution;

    if (any(lessThan(texCoord, vec3(0.0))) || any(greaterThan(texCoord, vec3(1.0)))) {
        return vec4(0.0);
    }

    float maxComp = max(absDir.x, max(absDir.y, absDir.z));
    if (maxComp < 0.001) {
        return sampleVoxelTrilinear(voxelPos);
    }

    vec3 footprint;
    if (absDir.x == maxComp) {
        footprint = vec3(1.0, absDir.y / absDir.x, absDir.z / absDir.x);
    } else if (absDir.y == maxComp) {
        footprint = vec3(absDir.x / absDir.y, 1.0, absDir.z / absDir.y);
    } else {
        footprint = vec3(absDir.x / absDir.z, absDir.y / absDir.z, 1.0);
    }

    footprint = clamp(footprint * 0.5, 0.5, 2.0);

    vec3 mipLevel = log2(footprint);
    float mip = max(mipLevel.x, max(mipLevel.y, mipLevel.z));

    vec3 baseCoord = texCoord - 0.5 / uVoxelResolution;
    vec4 sample0 = textureLod(uVoxelTexture, baseCoord, floor(mip));
    vec4 sample1 = textureLod(uVoxelTexture, baseCoord, ceil(mip));
    float t = fract(mip);

    return mix(sample0, sample1, t);
}

vec4 coneTrace(vec3 origin, vec3 direction, float aperture) {
    vec3 voxelOrigin = worldToVoxel(origin);
    vec3 accColor = vec3(0.0);
    float accAlpha = 0.0;

    float stepSize = uConeStepSize;
    float dist = stepSize * 0.5;

    for (int i = 0; i < 256; i++) {
        if (i >= uConeMaxSteps || accAlpha >= 0.95) break;

        float coneRadius = dist * tan(aperture * 0.5);
        vec3 samplePos = voxelOrigin + direction * dist;

        vec4 voxelSample = sampleVoxelAnisotropic(samplePos, direction);

        if (voxelSample.a > 0.001) {
            vec3 sampleColor = voxelSample.rgb * voxelSample.a;
            float weight = voxelSample.a * (1.0 - accAlpha);
            accColor += sampleColor * weight;
            accAlpha += weight;
        }

        dist += max(stepSize, coneRadius * 2.0);
    }

    return vec4(accColor, accAlpha);
}

vec3 transformHemisphereDirection(vec3 localDir, vec3 normal) {
    vec3 tangent = normalize(cross(normal, abs(normal.y) < 0.999 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 bitangent = cross(normal, tangent);

    return normalize(
        tangent * localDir.x +
        bitangent * localDir.y +
        normal * localDir.z
    );
}

vec3 estimateNormal(vec3 voxelPos) {
    float delta = 1.0;

    float c0 = sampleVoxelTrilinear(voxelPos + vec3(delta, 0.0, 0.0)).a;
    float c1 = sampleVoxelTrilinear(voxelPos - vec3(delta, 0.0, 0.0)).a;
    float c2 = sampleVoxelTrilinear(voxelPos + vec3(0.0, delta, 0.0)).a;
    float c3 = sampleVoxelTrilinear(voxelPos - vec3(0.0, delta, 0.0)).a;
    float c4 = sampleVoxelTrilinear(voxelPos + vec3(0.0, 0.0, delta)).a;
    float c5 = sampleVoxelTrilinear(voxelPos - vec3(0.0, 0.0, delta)).a;

    vec3 gradient = vec3(c1 - c0, c3 - c2, c5 - c4);
    float len = length(gradient);

    if (len < 0.001) {
        return vec3(0.0, 1.0, 0.0);
    }

    return normalize(gradient);
}

vec4 computeIndirectLight(vec3 position, vec3 normal, vec3 albedo) {
    vec3 accIndirect = vec3(0.0);
    float accAO = 0.0;

    vec3 origin = position + normal * 0.02;

    float totalWeight = 0.0;

    for (int i = 0; i < 9; i++) {
        if (i >= uConeCount) break;

        vec3 localDir = HEMISPHERE_SAMPLES[i];
        float weight = HEMISPHERE_WEIGHTS[i];

        vec3 coneDir = transformHemisphereDirection(localDir, normal);
        float ndotd = max(dot(normal, coneDir), 0.0);

        if (ndotd > 0.001) {
            vec4 coneResult = coneTrace(origin, coneDir, uConeAperture);

            accIndirect += coneResult.rgb * ndotd * weight;
            accAO += coneResult.a * ndotd * weight;
            totalWeight += ndotd * weight;
        }
    }

    if (totalWeight > 0.0) {
        accIndirect /= totalWeight;
        accAO /= totalWeight;
    }

    accIndirect *= uIndirectIntensity;
    accAO = 1.0 - accAO * uAOIntensity;

    return vec4(accIndirect * albedo, accAO);
}

float computeDirectLight(vec3 position, vec3 normal, vec3 albedo) {
    float direct = 0.0;

    for (int i = 0; i < 8; i++) {
        if (i >= uLightCount) break;

        vec3 L;
        float attenuation = 1.0;

        if (uLightTypes[i] == 0) {
            L = normalize(-uLightDirections[i]);
        } else {
            L = normalize(uLightPositions[i] - position);
            float distance = length(uLightPositions[i] - position);
            attenuation = 1.0 / (1.0 + distance * distance / (uLightRadii[i] * uLightRadii[i]));
        }

        float ndotl = max(dot(normal, L), 0.0);
        direct += ndotl * attenuation * uLightIntensities[i];
    }

    return direct;
}

void main() {
    vec3 voxelPos = vVoxelPos;

    if (any(lessThan(voxelPos, vec3(0.0))) || any(greaterThanEqual(voxelPos, vec3(uVoxelResolution)))) {
        irradianceOutput = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    vec4 voxelSample = sampleVoxelTrilinear(voxelPos);

    if (voxelSample.a < 0.5) {
        irradianceOutput = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    vec3 worldPos = voxelToWorld(voxelPos);
    vec3 normal = estimateNormal(voxelPos);
    vec3 albedo = voxelSample.rgb;

    vec4 indirectResult = computeIndirectLight(worldPos, normal, albedo);
    float direct = computeDirectLight(worldPos, normal, albedo);

    vec3 irradiance = indirectResult.rgb + albedo * direct * 0.1;
    float ao = indirectResult.a;

    irradianceOutput = vec4(irradiance, ao);
}
