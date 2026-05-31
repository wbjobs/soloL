#version 300 es

precision highp float;

in vec2 vTexCoord;

layout(location = 0) out vec4 fragColor;

uniform sampler2D uBakedLightTexture;
uniform sampler2D uDepthTexture;
uniform sampler2D uDynamicDepthTexture;
uniform sampler2D uOcclusionMaskTexture;

uniform mat4 uInverseProjection;
uniform mat4 uInverseView;
uniform vec3 uCameraPosition;
uniform float uNear;
uniform float uFar;
uniform float uOcclusionStrength;
uniform float uBakedLightIntensity;

uniform vec2 uResolution;

float linearizeDepth(float depth, float near, float far) {
    return (2.0 * near) / (far + near - depth * (far - near));
}

vec3 reconstructWorldPosition(vec2 uv, float depth) {
    vec4 clipPosition = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 viewPosition = uInverseProjection * clipPosition;
    viewPosition /= viewPosition.w;
    vec4 worldPosition = uInverseView * viewPosition;
    return worldPosition.xyz;
}

float computeDynamicOcclusion(float staticDepth, float dynamicDepth, float bias) {
    if (dynamicDepth >= 1.0) return 1.0;

    float staticLinear = linearizeDepth(staticDepth, uNear, uFar);
    float dynamicLinear = linearizeDepth(dynamicDepth, uNear, uFar);

    float depthDiff = dynamicLinear - staticLinear;

    if (depthDiff < -bias) {
        return 0.0;
    } else if (depthDiff < bias) {
        return smoothstep(-bias, bias, depthDiff);
    }

    return 1.0;
}

float computeSoftShadow(vec2 uv, float depth) {
    float shadow = 0.0;
    float radius = 2.0 / uResolution.x;
    int samples = 9;

    for (int x = -1; x <= 1; x++) {
        for (int y = -1; y <= 1; y++) {
            vec2 offset = vec2(float(x), float(y)) * radius;
            float sampleDepth = texture(uDynamicDepthTexture, uv + offset).r;
            float occlusion = computeDynamicOcclusion(depth, sampleDepth, 0.001);
            shadow += occlusion;
        }
    }

    return shadow / float(samples);
}

void main() {
    vec2 uv = vTexCoord;

    vec4 bakedLight = texture(uBakedLightTexture, uv);
    float staticDepth = texture(uDepthTexture, uv).r;
    float dynamicDepth = texture(uDynamicDepthTexture, uv).r;
    float occlusionMask = texture(uOcclusionMaskTexture, uv).r;

    float visibility = computeDynamicOcclusion(staticDepth, dynamicDepth, 0.002);
    float softVisibility = computeSoftShadow(uv, staticDepth);

    float finalOcclusion = mix(visibility, softVisibility, 0.5);
    finalOcclusion = pow(finalOcclusion, uOcclusionStrength);

    vec3 worldPos = reconstructWorldPosition(uv, staticDepth);
    float viewDistance = length(worldPos - uCameraPosition);
    float distanceFade = 1.0 - smoothstep(uFar * 0.5, uFar, viewDistance);
    finalOcclusion = mix(finalOcclusion, 1.0, 1.0 - distanceFade);

    vec3 bakedLighting = bakedLight.rgb * uBakedLightIntensity;
    vec3 occludedLighting = bakedLighting * finalOcclusion;

    float dynamicObjectMask = step(dynamicDepth, 0.999);
    vec3 dynamicObjectColor = vec3(0.8, 0.85, 0.9) * (0.3 + 0.7 * finalOcclusion);

    vec3 finalColor = mix(occludedLighting, dynamicObjectColor, dynamicObjectMask);

    float alpha = bakedLight.a;

    fragColor = vec4(finalColor, alpha);
}
