Shader "LiDARFurniturePlacer/Wireframe"
{
    Properties
    {
        _WireColor ("Wireframe Color", Color) = (0, 1, 0, 1)
        _FillColor ("Fill Color", Color) = (0, 0, 0, 0.1)
        _LineWidth ("Line Width", Float) = 0.01
        _Alpha ("Alpha", Range(0, 1)) = 1.0
        _Emission ("Emission", Range(0, 1)) = 0
    }
    SubShader
    {
        Tags
        {
            "RenderType" = "Transparent"
            "Queue" = "Transparent"
            "RenderPipeline" = "UniversalPipeline"
        }

        Pass
        {
            ZWrite Off
            Blend SrcAlpha OneMinusSrcAlpha

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma geometry geom
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
                float3 positionWS   : TEXCOORD0;
                float3 barycentric  : TEXCOORD1;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct GeomOutput
            {
                float4 positionHCS  : SV_POSITION;
                float4 color        : COLOR;
                float3 barycentric  : TEXCOORD0;
                float3 positionWS   : TEXCOORD1;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            CBUFFER_START(UnityPerMaterial)
                float4 _WireColor;
                float4 _FillColor;
                float _LineWidth;
                float _Alpha;
                float _Emission;
            CBUFFER_END

            Varyings vert(Attributes input)
            {
                Varyings output = (Varyings)0;

                UNITY_SETUP_INSTANCE_ID(input);
                UNITY_TRANSFER_INSTANCE_ID(input, output);

                float3 positionWS = TransformObjectToWorld(input.positionOS.xyz);
                output.positionWS = positionWS;
                output.positionHCS = TransformWorldToHClip(positionWS);
                output.color = input.color;

                return output;
            }

            [maxvertexcount(3)]
            void geom(triangle Varyings input[3], inout TriangleStream<GeomOutput> stream)
            {
                GeomOutput output;

                float3 barycentric[3] = {
                    float3(1, 0, 0),
                    float3(0, 1, 0),
                    float3(0, 0, 1)
                };

                for (int i = 0; i < 3; i++)
                {
                    UNITY_SETUP_INSTANCE_ID(input[i]);
                    UNITY_TRANSFER_INSTANCE_ID(input[i], output);

                    output.positionHCS = input[i].positionHCS;
                    output.color = input[i].color;
                    output.positionWS = input[i].positionWS;
                    output.barycentric = barycentric[i];
                    stream.Append(output);
                }
                stream.RestartStrip();
            }

            half4 frag(GeomOutput input) : SV_Target
            {
                UNITY_SETUP_INSTANCE_ID(input);

                float3 bary = input.barycentric;
                float minBary = min(bary.x, min(bary.y, bary.z));

                float width = _LineWidth * 0.1f;
                float edgeFactor = smoothstep(0.0, width, minBary);

                half3 wireColor = _WireColor.rgb;
                half3 fillColor = _FillColor.rgb;

                half3 finalColor = lerp(wireColor, fillColor, edgeFactor);
                float finalAlpha = lerp(_WireColor.a, _FillColor.a, edgeFactor);
                finalAlpha *= _Alpha;

                Light mainLight = GetMainLight();
                half3 lighting = mainLight.color * mainLight.distanceAttenuation;

                finalColor = finalColor * (lighting * 0.5 + 0.5);
                finalColor += wireColor * _Emission * (1 - edgeFactor);

                return half4(finalColor, finalAlpha);
            }
            ENDHLSL
        }
    }
    FallBack "Hidden/Universal Render Pipeline/FallbackError"
}
