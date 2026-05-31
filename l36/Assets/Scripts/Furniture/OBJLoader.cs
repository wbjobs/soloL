using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using UnityEngine;

namespace LiDARFurniturePlacer.Furniture
{
    public class OBJLoader
    {
        private struct OBJFace
        {
            public int[] VertexIndices;
            public int[] NormalIndices;
            public int[] UVIndices;
        }

        private class OBJMaterial
        {
            public string Name;
            public Color DiffuseColor = Color.white;
            public Color AmbientColor = Color.white;
            public Color SpecularColor = Color.black;
            public float Shininess = 0;
            public string DiffuseTexture;
        }

        public struct LoadResult
        {
            public Mesh Mesh;
            public Material Material;
            public Vector3 OriginalSize;
            public Vector3 Center;
        }

        public LoadResult Load(string filePath)
        {
            if (!File.Exists(filePath))
            {
                Debug.LogError($"OBJ file not found: {filePath}");
                return default;
            }

            string mtlDir = Path.GetDirectoryName(filePath);
            string[] lines = File.ReadAllLines(filePath);

            List<Vector3> vertices = new List<Vector3>();
            List<Vector3> normals = new List<Vector3>();
            List<Vector2> uvs = new List<Vector2>();
            List<OBJFace> faces = new List<OBJFace>();
            Dictionary<string, OBJMaterial> materials = new Dictionary<string, OBJMaterial>();
            OBJMaterial currentMaterial = null;

            vertices.Add(Vector3.zero);
            normals.Add(Vector3.zero);
            uvs.Add(Vector2.zero);

            foreach (string line in lines)
            {
                if (string.IsNullOrWhiteSpace(line) || line.StartsWith("#"))
                    continue;

                string[] parts = line.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length == 0)
                    continue;

                switch (parts[0])
                {
                    case "mtllib":
                        if (parts.Length >= 2)
                        {
                            string mtlPath = Path.Combine(mtlDir, parts[1]);
                            LoadMaterials(mtlPath, materials);
                        }
                        break;

                    case "usemtl":
                        if (parts.Length >= 2)
                        {
                            materials.TryGetValue(parts[1], out currentMaterial);
                        }
                        break;

                    case "v":
                        if (parts.Length >= 4)
                        {
                            float x = ParseFloat(parts[1]);
                            float y = ParseFloat(parts[2]);
                            float z = ParseFloat(parts[3]);
                            vertices.Add(new Vector3(x, y, z));
                        }
                        break;

                    case "vn":
                        if (parts.Length >= 4)
                        {
                            float x = ParseFloat(parts[1]);
                            float y = ParseFloat(parts[2]);
                            float z = ParseFloat(parts[3]);
                            normals.Add(new Vector3(x, y, z));
                        }
                        break;

                    case "vt":
                        if (parts.Length >= 3)
                        {
                            float u = ParseFloat(parts[1]);
                            float v = ParseFloat(parts[2]);
                            uvs.Add(new Vector2(u, v));
                        }
                        break;

                    case "f":
                        OBJFace face = new OBJFace();
                        List<int> vertIndices = new List<int>();
                        List<int> normIndices = new List<int>();
                        List<int> uvIndices = new List<int>();

                        for (int i = 1; i < parts.Length; i++)
                        {
                            string[] faceParts = parts[i].Split('/');
                            if (faceParts.Length >= 1 && int.TryParse(faceParts[0], out int vi))
                            {
                                vertIndices.Add(vi > 0 ? vi : vertices.Count + vi);
                            }
                            if (faceParts.Length >= 2 && !string.IsNullOrEmpty(faceParts[1]) && int.TryParse(faceParts[1], out int ui))
                            {
                                uvIndices.Add(ui > 0 ? ui : uvs.Count + ui);
                            }
                            if (faceParts.Length >= 3 && !string.IsNullOrEmpty(faceParts[2]) && int.TryParse(faceParts[2], out int ni))
                            {
                                normIndices.Add(ni > 0 ? ni : normals.Count + ni);
                            }
                        }

                        if (vertIndices.Count >= 3)
                        {
                            for (int i = 1; i < vertIndices.Count - 1; i++)
                            {
                                face.VertexIndices = new[] { vertIndices[0], vertIndices[i], vertIndices[i + 1] };
                                if (normIndices.Count >= 3)
                                {
                                    face.NormalIndices = new[] { normIndices[0], normIndices[i], normIndices[i + 1] };
                                }
                                if (uvIndices.Count >= 3)
                                {
                                    face.UVIndices = new[] { uvIndices[0], uvIndices[i], uvIndices[i + 1] };
                                }
                                faces.Add(face);
                            }
                        }
                        break;
                }
            }

            Mesh mesh = BuildMesh(vertices, normals, uvs, faces);
            Material material = BuildMaterial(currentMaterial);

            Bounds bounds = mesh.bounds;
            LoadResult result = new LoadResult
            {
                Mesh = mesh,
                Material = material,
                OriginalSize = bounds.size,
                Center = bounds.center
            };

            return result;
        }

        private Mesh BuildMesh(List<Vector3> vertices, List<Vector3> normals, List<Vector2> uvs, List<OBJFace> faces)
        {
            Mesh mesh = new Mesh();
            mesh.name = "OBJMesh";

            List<Vector3> meshVertices = new List<Vector3>();
            List<Vector3> meshNormals = new List<Vector3>();
            List<Vector2> meshUVs = new List<Vector2>();
            List<int> meshTriangles = new List<int>();

            Dictionary<long, int> vertexMap = new Dictionary<long, int>();

            foreach (var face in faces)
            {
                for (int i = 0; i < 3; i++)
                {
                    int vi = face.VertexIndices != null && i < face.VertexIndices.Length ? face.VertexIndices[i] : 0;
                    int ni = face.NormalIndices != null && i < face.NormalIndices.Length ? face.NormalIndices[i] : 0;
                    int ui = face.UVIndices != null && i < face.UVIndices.Length ? face.UVIndices[i] : 0;

                    long key = ((long)vi << 40) | ((long)ni << 20) | (uint)ui;

                    if (!vertexMap.TryGetValue(key, out int index))
                    {
                        index = meshVertices.Count;
                        vertexMap[key] = index;

                        meshVertices.Add(vi > 0 && vi < vertices.Count ? vertices[vi] : Vector3.zero);
                        meshNormals.Add(ni > 0 && ni < normals.Count ? normals[ni] : Vector3.up);
                        meshUVs.Add(ui > 0 && ui < uvs.Count ? uvs[ui] : Vector2.zero);
                    }

                    meshTriangles.Add(index);
                }
            }

            mesh.vertices = meshVertices.ToArray();
            mesh.normals = meshNormals.ToArray();
            mesh.uv = meshUVs.ToArray();
            mesh.triangles = meshTriangles.ToArray();
            mesh.RecalculateBounds();
            mesh.RecalculateTangents();

            if (mesh.normals.Length == 0)
            {
                mesh.RecalculateNormals();
            }

            return mesh;
        }

        private Material BuildMaterial(OBJMaterial mtl)
        {
            Shader shader = Shader.Find("Universal Render Pipeline/Lit");
            if (shader == null)
            {
                shader = Shader.Find("Standard");
            }

            Material material = new Material(shader);

            if (mtl != null)
            {
                material.color = mtl.DiffuseColor;
                material.SetColor("_BaseColor", mtl.DiffuseColor);
                material.SetColor("_EmissionColor", mtl.AmbientColor * 0.1f);
            }
            else
            {
                material.color = Color.Lerp(Color.gray, Color.white, 0.5f);
            }

            return material;
        }

        private void LoadMaterials(string mtlPath, Dictionary<string, OBJMaterial> materials)
        {
            if (!File.Exists(mtlPath))
                return;

            string[] lines = File.ReadAllLines(mtlPath);
            OBJMaterial currentMtl = null;

            foreach (string line in lines)
            {
                if (string.IsNullOrWhiteSpace(line) || line.StartsWith("#"))
                    continue;

                string[] parts = line.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length == 0)
                    continue;

                switch (parts[0])
                {
                    case "newmtl":
                        if (parts.Length >= 2)
                        {
                            currentMtl = new OBJMaterial { Name = parts[1] };
                            materials[parts[1]] = currentMtl;
                        }
                        break;

                    case "Kd":
                        if (currentMtl != null && parts.Length >= 4)
                        {
                            currentMtl.DiffuseColor = new Color(
                                ParseFloat(parts[1]),
                                ParseFloat(parts[2]),
                                ParseFloat(parts[3])
                            );
                        }
                        break;

                    case "Ka":
                        if (currentMtl != null && parts.Length >= 4)
                        {
                            currentMtl.AmbientColor = new Color(
                                ParseFloat(parts[1]),
                                ParseFloat(parts[2]),
                                ParseFloat(parts[3])
                            );
                        }
                        break;

                    case "Ks":
                        if (currentMtl != null && parts.Length >= 4)
                        {
                            currentMtl.SpecularColor = new Color(
                                ParseFloat(parts[1]),
                                ParseFloat(parts[2]),
                                ParseFloat(parts[3])
                            );
                        }
                        break;

                    case "Ns":
                        if (currentMtl != null && parts.Length >= 2)
                        {
                            currentMtl.Shininess = ParseFloat(parts[1]);
                        }
                        break;

                    case "map_Kd":
                        if (currentMtl != null && parts.Length >= 2)
                        {
                            currentMtl.DiffuseTexture = parts[1];
                        }
                        break;
                }
            }
        }

        private float ParseFloat(string value)
        {
            if (float.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out float result))
            {
                return result;
            }
            return 0;
        }
    }
}
