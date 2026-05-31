#version 300 es

precision highp float;
precision highp sampler3D;

in vec3 vWorldPosition;
in vec3 vNormal;
in vec2 vTexCoord;
in vec4 vColor;
in vec3 vViewPosition;

out vec4 fragColor;

uniform sampler3D uVoxelTexture;
uniform vec3 uVoxelGridCenter;
uniform vec3 uVoxelGridSize;
uniform float uVoxelResolution;

uniform vec3 uCameraPosition;
uniform vec3 uBackgroundColor;
uniform float uAmbientIntensity;
uniform float uExposure;
uniform float uGamma;

uniform int uLightCount;
uniform vec3 uLightPositions[8];
uniform vec3 uLightColors[8];
uniform float uLightIntensities[8];
uniform float uLightRadii[8];
uniform int uLightTypes[8];
uniform vec3 uLightDirections[8];
uniform float uLightInnerAngles[8];
uniform float uLightOuterAngles[8];

uniform float uConeStepSize;
uniform int uConeMaxSteps;
uniform float uConeAperture;
uniform float uIndirectIntensity;
uniform float uAOIntensity;

uniform vec3 uAlbedo;
uniform float uMetallic;
uniform float uRoughness;
uniform vec3 uEmissive;

const float PI = 3.14159265359;

vec3 worldToVoxel(vec3 worldPos) {
    vec3 halfSize = uVoxelGridSize * 0.5;
    vec3 localPos = worldPos - uVoxelGridCenter + halfSize;
    vec3 voxelSize = uVoxelGridSize / uVoxelResolution;
    return localPos / voxelSize;
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
    vec3 footprint = vec3(0.0);
    
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
    
    for (int i = 0; i < 128; i++) {
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

vec3 getHemisphereSampleDir(vec3 normal, int sampleIndex) {
    float phi = float(sampleIndex) * (2.399963229728653);
    float cosTheta = 1.0 - (float(sampleIndex) + 0.5) / float(64);
    float sinTheta = sqrt(1.0 - cosTheta * cosTheta);
    
    vec3 tangent = normalize(cross(normal, abs(normal.y) < 0.999 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 bitangent = cross(normal, tangent);
    
    vec3 localDir = vec3(
        cos(phi) * sinTheta,
        sin(phi) * sinTheta,
        cosTheta
    );
    
    return normalize(
        tangent * localDir.x +
        bitangent * localDir.y +
        normal * localDir.z
    );
}

vec4 computeIndirectLight(vec3 position, vec3 normal, vec3 albedo) {
    vec3 accIndirect = vec3(0.0);
    float accAO = 0.0;
    int sampleCount = 6;
    
    vec3 origin = position + normal * 0.02;
    
    for (int i = 0; i < 8; i++) {
        if (i >= sampleCount) break;
        
        vec3 coneDir = getHemisphereSampleDir(normal, i);
        float ndotd = max(dot(normal, coneDir), 0.0);
        
        if (ndotd > 0.001) {
            vec4 coneResult = coneTrace(origin, coneDir, uConeAperture);
            
            accIndirect += coneResult.rgb * ndotd;
            accAO += coneResult.a * ndotd;
        }
    }
    
    float invSamples = 1.0 / float(sampleCount);
    accIndirect *= invSamples * uIndirectIntensity;
    accAO = 1.0 - (accAO * invSamples * uAOIntensity);
    
    return vec4(accIndirect * albedo, accAO);
}

float distributionGGX(vec3 N, vec3 H, float roughness) {
    float a = roughness * roughness;
    float a2 = a * a;
    float NdotH = max(dot(N, H), 0.0);
    float NdotH2 = NdotH * NdotH;
    
    float nom = a2;
    float denom = (NdotH2 * (a2 - 1.0) + 1.0);
    denom = PI * denom * denom;
    
    return nom / denom;
}

float geometrySchlickGGX(float NdotV, float roughness) {
    float r = (roughness + 1.0);
    float k = (r * r) / 8.0;
    
    float nom = NdotV;
    float denom = NdotV * (1.0 - k) + k;
    
    return nom / denom;
}

float geometrySmith(vec3 N, vec3 V, vec3 L, float roughness) {
    float NdotV = max(dot(N, V), 0.0);
    float NdotL = max(dot(N, L), 0.0);
    float ggx2 = geometrySchlickGGX(NdotV, roughness);
    float ggx1 = geometrySchlickGGX(NdotL, roughness);
    
    return ggx1 * ggx2;
}

vec3 fresnelSchlick(float cosTheta, vec3 F0) {
    return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

vec3 fresnelSchlickRoughness(float cosTheta, vec3 F0, float roughness) {
    return F0 + (max(vec3(1.0 - roughness), F0) - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(uCameraPosition - vWorldPosition);
    vec3 R = reflect(-V, N);
    
    vec3 albedo = uAlbedo * vColor.rgb;
    float metallic = uMetallic;
    float roughness = max(uRoughness, 0.04);
    vec3 emissive = uEmissive;
    
    vec3 F0 = vec3(0.04);
    F0 = mix(F0, albedo, metallic);
    
    vec3 Lo = vec3(0.0);
    
    for (int i = 0; i < 8; i++) {
        if (i >= uLightCount) break;
        
        vec3 L;
        float attenuation = 1.0;
        
        if (uLightTypes[i] == 0) {
            L = normalize(-uLightDirections[i]);
        } else {
            L = normalize(uLightPositions[i] - vWorldPosition);
            float distance = length(uLightPositions[i] - vWorldPosition);
            attenuation = 1.0 / (1.0 + distance * distance / (uLightRadii[i] * uLightRadii[i]));
            
            if (uLightTypes[i] == 2) {
                float theta = dot(normalize(-uLightDirections[i]), L);
                float epsilon = uLightInnerAngles[i] - uLightOuterAngles[i];
                attenuation *= clamp((theta - uLightOuterAngles[i]) / epsilon, 0.0, 1.0);
            }
        }
        
        vec3 H = normalize(V + L);
        float NdotL = max(dot(N, L), 0.0);
        float NdotV = max(dot(N, V), 0.0);
        float NdotH = max(dot(N, H), 0.0);
        float HdotV = max(dot(H, V), 0.0);
        
        float D = distributionGGX(N, H, roughness);
        float G = geometrySmith(N, V, L, roughness);
        vec3 F = fresnelSchlick(HdotV, F0);
        
        vec3 specular = D * G * F / max(4.0 * NdotV * NdotL, 0.0001);
        
        vec3 kS = F;
        vec3 kD = vec3(1.0) - kS;
        kD *= 1.0 - metallic;
        
        vec3 radiance = uLightColors[i] * uLightIntensities[i] * attenuation;
        Lo += (kD * albedo / PI + specular) * radiance * NdotL;
    }
    
    vec3 F = fresnelSchlickRoughness(max(dot(N, V), 0.0), F0, roughness);
    vec3 kS = F;
    vec3 kD = 1.0 - kS;
    kD *= 1.0 - metallic;
    
    vec3 ambient = uBackgroundColor * uAmbientIntensity * albedo;
    
    vec4 indirectResult = computeIndirectLight(vWorldPosition, N, albedo);
    vec3 indirectDiffuse = indirectResult.rgb * kD;
    
    float ao = indirectResult.a;
    
    vec3 color = ambient * ao + Lo + indirectDiffuse + emissive;
    
    color = vec3(1.0) - exp(-color * uExposure);
    color = pow(color, vec3(1.0 / uGamma));
    
    fragColor = vec4(color, vColor.a);
}
