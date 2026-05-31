Shader "LiDARFurniturePlacer/PointCloud"
{
    Properties
    {
        _PointSize ("Point Size", Float) = 0.02
        _PointScaleMin ("Min Point Size", Float) = 0.5
        _PointScaleMax ("Max Point Size", Float) = 10.0
        _ColorTint ("Color Tint", Color) = (1,1,1,1)
        _Emission ("Emission", Range(0, 1)) = 0
    }
    SubShader
    {
        Tags
        {
            "RenderType" = "Opaque"
            "Queue" = "Geometry"
            "RenderPipeline" = "UniversalPipeline"
        }

        Pass
        {
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma target 4.5

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            struct Attributes
            {
                float4 positionOS   : POSITION;
                float4 color        : COLOR;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct Varyings
            {
                float4 positionHCS  : SV_POSITION;
                float4 color        : COLOR;
                float pointSize     : PSIZE;
                float3 positionWS   : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            CBUFFER_START(UnityPerMaterial)
                float _PointSize;
                float _PointScaleMin;
                float _PointScaleMax;
                float4 _ColorTint;
                float _Emission;
            CBUFFER_END

            Varyings vert(Attributes input)
            {
                Varyings output = (Varyings)0;

                UNITY_SETUP_INSTANCE_ID(input);
                UNITY_TRANSFER_INSTANCE_ID(input, output);

                float3 positionWS = TransformObjectToWorld(input.positionOS.xyz);
                output.positionWS = positionWS;

                float3 viewDir = _WorldSpaceCameraPos - positionWS;
                float distance = length(viewDir);

                float scaleFactor = distance > 0.01f ? (1.0f / distance) : 1.0f;
                scaleFactor = clamp(scaleFactor * 5.0f, _PointScaleMin, _PointScaleMax);
                output.pointSize = _PointSize * scaleFactor * _ScreenParams.y * 0.05f;

                output.positionHCS = TransformWorldToHClip(positionWS);
                output.color = input.color * _ColorTint;

                return output;
            }

            half4 frag(Varyings input) : SV_Target
            {
                UNITY_SETUP_INSTANCE_ID(input);

                float2 center = float2(0.5, 0.5);
                float2 uv = (float2)input.positionHCS.xy / input.pointSize + center;
                float dist = length(uv - center);

                if (dist > 0.5)
                {
                    discard;
                }

                float alpha = 1.0f - smoothstep(0.4, 0.5, dist);

                half3 albedo = input.color.rgb;

                Light mainLight = GetMainLight();
                half3 lighting = mainLight.color * mainLight.distanceAttenuation;

                half3 diffuse = albedo * (lighting * 0.5 + 0.5);
                half3 emission = albedo * _Emission;

                half3 finalColor = diffuse + emission;

                return half4(finalColor, alpha * input.color.a);
            }
            ENDHLSL
        }
    }
    FallBack "Hidden/Universal Render Pipeline/FallbackError"
}
