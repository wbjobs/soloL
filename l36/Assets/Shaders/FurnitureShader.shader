Shader "LiDARFurniturePlacer/Furniture"
{
    Properties
    {
        _BaseColor ("Base Color", Color) = (1, 1, 1, 1)
        _EmissionColor ("Emission Color", Color) = (0, 0, 0, 1)
        _Emission ("Emission", Range(0, 1)) = 0
        _Alpha ("Alpha", Range(0, 1)) = 1
        _Wireframe ("Wireframe", Range(0, 1)) = 0
        _WireColor ("Wireframe Color", Color) = (0, 1, 0, 1)
        _LineWidth ("Line Width", Float) = 0.01

        _Metallic ("Metallic", Range(0, 1)) = 0
        _Smoothness ("Smoothness", Range(0, 1)) = 0.5

        _MainTex ("Base Map", 2D) = "white" {}
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
            ZWrite On
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
                float3 normalOS     : NORMAL;
                float2 uv           : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct Varyings
            {
                float4 positionHCS  : SV_POSITION;
                float3 normalWS     : NORMAL;
                float2 uv           : TEXCOORD0;
                float3 positionWS   : TEXCOORD1;
                float3 barycentric  : TEXCOORD2;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct GeomOutput
            {
                float4 positionHCS  : SV_POSITION;
                float3 normalWS     : NORMAL;
                float2 uv           : TEXCOORD0;
                float3 positionWS   : TEXCOORD1;
                float3 barycentric  : TEXCOORD2;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseColor;
                float4 _EmissionColor;
                float _Emission;
                float _Alpha;
                float _Wireframe;
                float4 _WireColor;
                float _LineWidth;
                float _Metallic;
                float _Smoothness;
                float4 _MainTex_ST;
            CBUFFER_END

            TEXTURE2D(_MainTex);
            SAMPLER(sampler_MainTex);

            Varyings vert(Attributes input)
            {
                Varyings output = (Varyings)0;

                UNITY_SETUP_INSTANCE_ID(input);
                UNITY_TRANSFER_INSTANCE_ID(input, output);

                float3 positionWS = TransformObjectToWorld(input.positionOS.xyz);
                output.positionWS = positionWS;
                output.positionHCS = TransformWorldToHClip(positionWS);
                output.normalWS = TransformObjectToWorldNormal(input.normalOS);
                output.uv = TRANSFORM_TEX(input.uv, _MainTex);

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
                    output.normalWS = input[i].normalWS;
                    output.uv = input[i].uv;
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
                edgeFactor = lerp(0.0, edgeFactor, 1.0 - _Wireframe);

                half4 baseColor = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, input.uv) * _BaseColor;

                half3 normalWS = normalize(input.normalWS);

                Light mainLight = GetMainLight();
                half3 lightDir = normalize(mainLight.direction);
                half NdotL = saturate(dot(normalWS, lightDir));

                half3 diffuse = baseColor.rgb * mainLight.color * NdotL;
                half3 ambient = baseColor.rgb * 0.1f;

                half3 viewDir = normalize(_WorldSpaceCameraPos - input.positionWS);
                half3 halfDir = normalize(lightDir + viewDir);
                half NdotH = saturate(dot(normalWS, halfDir));

                half specular = pow(NdotH, 10.0 * _Smoothness + 1.0) * _Metallic;
                half3 specularColor = mainLight.color * specular;

                half3 emission = _EmissionColor.rgb * _Emission;

                half3 finalColor = diffuse + ambient + specularColor + emission;

                half3 wireColor = _WireColor.rgb;
                finalColor = lerp(wireColor, finalColor, edgeFactor);

                float finalAlpha = baseColor.a * _Alpha;
                finalAlpha = lerp(_WireColor.a, finalAlpha, edgeFactor);

                return half4(finalColor, finalAlpha);
            }
            ENDHLSL
        }
    }
    FallBack "Hidden/Universal Render Pipeline/FallbackError"
}
