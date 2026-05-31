using System;
using System.Collections.Generic;
using UnityEngine;
using LiDARFurniturePlacer.Core;

namespace LiDARFurniturePlacer.Semantic
{
    public class PointNetPlusPlusInference : IDisposable
    {
        private ComputeShader semanticShader;
        private int saKernel;
        private int fpKernel;
        private int clsKernel;
        private bool isInitialized;

        private ComputeBuffer pointsBuffer;
        private ComputeBuffer normalsBuffer;
        private ComputeBuffer sampledPointsBuffer;
        private ComputeBuffer sampledFeaturesBuffer;
        private ComputeBuffer neighborIndicesBuffer;
        private ComputeBuffer neighborCountsBuffer;
        private ComputeBuffer propagatedFeaturesBuffer;
        private ComputeBuffer classPredictionsBuffer;
        private ComputeBuffer classProbabilitiesBuffer;

        private int[] classPredictions;
        private float[] classProbabilities;

        public bool IsInitialized => isInitialized;

        public int[] ClassPredictions => classPredictions;
        public float[] ClassProbabilities => classProbabilities;

        public event Action<float> OnProgress;

        public PointNetPlusPlusInference(ComputeShader shader)
        {
            semanticShader = shader;
            if (semanticShader != null)
            {
                saKernel = semanticShader.FindKernel("PointNetSAModule");
                fpKernel = semanticShader.FindKernel("FeaturePropagation");
                clsKernel = semanticShader.FindKernel("ClassificationHead");
                isInitialized = true;
            }
        }

        public SemanticLabel[] RunInference(PointCloudData pointCloud)
        {
            if (!isInitialized || pointCloud == null || pointCloud.PointCount == 0)
                return null;

            int numPoints = pointCloud.PointCount;
            OnProgress?.Invoke(0.1f);

            Vector3[] points = pointCloud.Vertices;
            Vector3[] normals = EstimateNormals(points);

            OnProgress?.Invoke(0.2f);

            int[] centroidIndices = FarthestPointSampling(points, Mathf.Min(numPoints, 1024));
            OnProgress?.Invoke(0.3f);

            ReleaseBuffers();

            pointsBuffer = new ComputeBuffer(numPoints, 12);
            normalsBuffer = new ComputeBuffer(numPoints, 12);

            Vector3[] pointsData = points;
            Vector3[] normalsData = normals;

            pointsBuffer.SetData(pointsData);
            normalsBuffer.SetData(normalsData);

            int numCentroids = centroidIndices.Length;
            Vector3[] centroidPoints = new Vector3[numCentroids];
            for (int i = 0; i < numCentroids; i++)
            {
                centroidPoints[i] = points[centroidIndices[i]];
            }

            sampledPointsBuffer = new ComputeBuffer(numCentroids, 12);
            sampledPointsBuffer.SetData(centroidPoints);

            sampledFeaturesBuffer = new ComputeBuffer(numCentroids * 3, 4);
            neighborIndicesBuffer = new ComputeBuffer(numCentroids * 64, 4);
            neighborCountsBuffer = new ComputeBuffer(numCentroids, 4);

            int[] neighborInit = new int[numCentroids * 64];
            int[] countInit = new int[numCentroids];
            neighborIndicesBuffer.SetData(neighborInit);
            neighborCountsBuffer.SetData(countInit);

            semanticShader.SetBuffer(saKernel, "_Points", pointsBuffer);
            semanticShader.SetBuffer(saKernel, "_Normals", normalsBuffer);
            semanticShader.SetBuffer(saKernel, "_SampledPoints", sampledPointsBuffer);
            semanticShader.SetBuffer(saKernel, "_SampledFeatures", sampledFeaturesBuffer);
            semanticShader.SetBuffer(saKernel, "_NeighborIndices", neighborIndicesBuffer);
            semanticShader.SetBuffer(saKernel, "_NeighborCounts", neighborCountsBuffer);

            Bounds bounds = pointCloud.GetBounds();
            float radius = Mathf.Max(bounds.size.x, bounds.size.z) * 0.1f;
            semanticShader.SetFloat("_Radius", radius);
            semanticShader.SetInt("_NumPoints", numPoints);
            semanticShader.SetInt("_NumCentroids", numCentroids);
            semanticShader.SetInt("_KNN", 64);

            int groups = Mathf.CeilToInt(numCentroids / 256f);
            semanticShader.Dispatch(saKernel, groups, 1, 1);

            OnProgress?.Invoke(0.5f);

            propagatedFeaturesBuffer = new ComputeBuffer(numPoints * 3, 4);
            semanticShader.SetBuffer(fpKernel, "_Points", pointsBuffer);
            semanticShader.SetBuffer(fpKernel, "_Normals", normalsBuffer);
            semanticShader.SetBuffer(fpKernel, "_SampledPoints", sampledPointsBuffer);
            semanticShader.SetBuffer(fpKernel, "_SampledFeatures", sampledFeaturesBuffer);
            semanticShader.SetBuffer(fpKernel, "_PropagatedFeatures", propagatedFeaturesBuffer);
            semanticShader.SetInt("_NumPoints", numPoints);
            semanticShader.SetInt("_NumSampled", numCentroids);

            groups = Mathf.CeilToInt(numPoints / 256f);
            semanticShader.Dispatch(fpKernel, groups, 1, 1);

            OnProgress?.Invoke(0.7f);

            classPredictionsBuffer = new ComputeBuffer(numPoints, 4);
            classProbabilitiesBuffer = new ComputeBuffer(numPoints * 11, 4);

            semanticShader.SetBuffer(clsKernel, "_Points", pointsBuffer);
            semanticShader.SetBuffer(clsKernel, "_Normals", normalsBuffer);
            semanticShader.SetBuffer(clsKernel, "_PropagatedFeatures", propagatedFeaturesBuffer);
            semanticShader.SetBuffer(clsKernel, "_ClassPredictions", classPredictionsBuffer);
            semanticShader.SetBuffer(clsKernel, "_ClassProbabilities", classProbabilitiesBuffer);
            semanticShader.SetInt("_NumPoints", numPoints);

            groups = Mathf.CeilToInt(numPoints / 256f);
            semanticShader.Dispatch(clsKernel, groups, 1, 1);

            OnProgress?.Invoke(0.85f);

            classPredictions = new int[numPoints];
            classProbabilities = new float[numPoints * 11];
            classPredictionsBuffer.GetData(classPredictions);
            classProbabilitiesBuffer.GetData(classProbabilities);

            OnProgress?.Invoke(0.9f);

            SemanticLabel[] labels = new SemanticLabel[numPoints];
            for (int i = 0; i < numPoints; i++)
            {
                labels[i] = (SemanticLabel)Mathf.Clamp(classPredictions[i], 0, 10);
            }

            float confidenceThreshold = 0.3f;
            for (int i = 0; i < numPoints; i++)
            {
                float maxProb = 0f;
                int bestClass = 0;
                for (int c = 0; c < 11; c++)
                {
                    float prob = classProbabilities[i * 11 + c];
                    if (prob > maxProb)
                    {
                        maxProb = prob;
                        bestClass = c;
                    }
                }
                if (maxProb < confidenceThreshold)
                {
                    labels[i] = SemanticLabel.Unlabeled;
                }
                else
                {
                    labels[i] = (SemanticLabel)bestClass;
                }
            }

            OnProgress?.Invoke(1.0f);
            return labels;
        }

        private Vector3[] EstimateNormals(Vector3[] points)
        {
            int n = points.Length;
            Vector3[] normals = new Vector3[n];

            int k = Mathf.Min(30, n - 1);
            float searchRadius = EstimateNormalRadius(points);

            for (int i = 0; i < n; i++)
            {
                List<int> neighbors = FindNeighbors(points, i, k, searchRadius);
                if (neighbors.Count < 3)
                {
                    normals[i] = Vector3.up;
                    continue;
                }

                Vector3 centroid = Vector3.zero;
                for (int j = 0; j < neighbors.Count; j++)
                {
                    centroid += points[neighbors[j]];
                }
                centroid /= neighbors.Count;

                float cxx = 0, cxy = 0, cxz = 0, cyy = 0, cyz = 0, czz = 0;
                for (int j = 0; j < neighbors.Count; j++)
                {
                    Vector3 d = points[neighbors[j]] - centroid;
                    cxx += d.x * d.x;
                    cxy += d.x * d.y;
                    cxz += d.x * d.z;
                    cyy += d.y * d.y;
                    cyz += d.y * d.z;
                    czz += d.z * d.z;
                }

                Vector3 normal = SmallestEigenvector3x3(cxx, cxy, cxz, cyy, cyz, czz);

                if (normal.y < 0) normal = -normal;
                if (normal.sqrMagnitude < 1e-8f) normal = Vector3.up;
                normals[i] = normal.normalized;
            }

            return normals;
        }

        private float EstimateNormalRadius(Vector3[] points)
        {
            if (points.Length < 10) return 1f;

            Bounds b = new Bounds(points[0], Vector3.zero);
            for (int i = 1; i < points.Length; i++)
                b.Encapsulate(points[i]);

            float diagonal = (b.max - b.min).magnitude;
            float density = points.Length / (b.size.x * b.size.y * b.size.z + 1e-10f);
            return Mathf.Clamp(diagonal * 0.02f / Mathf.Pow(density + 1, 0.33f), 0.1f, 2f);
        }

        private List<int> FindNeighbors(Vector3[] points, int centerIdx, int k, float radius)
        {
            List<int> result = new List<int>();
            Vector3 center = points[centerIdx];
            float r2 = radius * radius;

            for (int i = 0; i < points.Length; i++)
            {
                if (i == centerIdx) continue;
                float dx = points[i].x - center.x;
                if (dx * dx > r2) continue;
                float dy = points[i].y - center.y;
                if (dy * dy > r2) continue;
                float dz = points[i].z - center.z;
                if (dz * dz > r2) continue;

                float d2 = dx * dx + dy * dy + dz * dz;
                if (d2 <= r2)
                {
                    result.Add(i);
                    if (result.Count >= k * 2) break;
                }
            }

            return result;
        }

        private Vector3 SmallestEigenvector3x3(float cxx, float cxy, float cxz, float cyy, float cyz, float czz)
        {
            float a = cxx, b = cxy, c = cxz, d = cyy, e = cyz, f = czz;

            float p1 = b * b + c * c + e * e;
            if (p1 < 1e-12f) return new Vector3(1, 0, 0);

            float q = (a + d + f) / 3f;
            float p2 = (a - q) * (a - q) + (d - q) * (d - q) + (f - q) * (f - q) + 2f * p1;
            float p = Mathf.Sqrt(p2 / 6f);

            float invP = 1f / (p + 1e-10f);
            float[,] B = new float[3, 3];
            B[0, 0] = (a - q) * invP; B[0, 1] = b * invP; B[0, 2] = c * invP;
            B[1, 0] = b * invP; B[1, 1] = (d - q) * invP; B[1, 2] = e * invP;
            B[2, 0] = c * invP; B[2, 1] = e * invP; B[2, 2] = (f - q) * invP;

            float det = B[0, 0] * (B[1, 1] * B[2, 2] - B[1, 2] * B[2, 1])
                      - B[0, 1] * (B[1, 0] * B[2, 2] - B[1, 2] * B[2, 0])
                      + B[0, 2] * (B[1, 0] * B[2, 1] - B[1, 1] * B[2, 0]);

            float r = det / 2f;
            float phi;
            if (r <= -1f) phi = Mathf.PI / 3f;
            else if (r >= 1f) phi = 0f;
            else phi = Mathf.Acos(r) / 3f;

            float eig1 = q + 2f * p * Mathf.Cos(phi);
            float eig3 = q + 2f * p * Mathf.Cos(phi + 2f * Mathf.PI / 3f);
            float minEig = Mathf.Min(eig1, eig3);

            float lam = minEig;
            float nx = (b * (f - lam) - c * e);
            float ny = (c * b - (a - lam) * e);
            float nz = ((a - lam) * (f - lam) - b * b);

            Vector3 v = new Vector3(nx, ny, nz);
            if (v.sqrMagnitude < 1e-12f)
            {
                float m11 = d - lam, m12 = e, m22 = f - lam;
                float m00 = a - lam;
                if (Mathf.Abs(m00) > Mathf.Abs(m11) && Mathf.Abs(m00) > Mathf.Abs(m22))
                    v = new Vector3(m11 * m22 - m12 * m12, -b * m22 + c * m12, b * m12 - c * m11);
                else if (Mathf.Abs(m11) > Mathf.Abs(m22))
                    v = new Vector3(-b * m22 + c * m12, m00 * m22 - c * c, -m00 * m12 + b * c);
                else
                    v = new Vector3(-b * m12 + c * m11, -m00 * m12 + b * c, m00 * m11 - b * b);
            }

            return v.normalized;
        }

        private int[] FarthestPointSampling(Vector3[] points, int numSamples)
        {
            int n = points.Length;
            if (numSamples >= n)
            {
                int[] allIndices = new int[n];
                for (int i = 0; i < n; i++) allIndices[i] = i;
                return allIndices;
            }

            int[] sampledIndices = new int[numSamples];
            float[] minDistances = new float[n];
            for (int i = 0; i < n; i++) minDistances[i] = float.MaxValue;

            int currentIdx = 0;
            sampledIndices[0] = currentIdx;

            for (int i = 1; i < numSamples; i++)
            {
                Vector3 currentPoint = points[currentIdx];
                float maxDist = -1f;
                int nextIdx = 0;

                for (int j = 0; j < n; j++)
                {
                    float dist = Vector3.SqrDistance(points[j], currentPoint);
                    if (dist < minDistances[j])
                    {
                        minDistances[j] = dist;
                    }
                    if (minDistances[j] > maxDist)
                    {
                        maxDist = minDistances[j];
                        nextIdx = j;
                    }
                }

                sampledIndices[i] = nextIdx;
                currentIdx = nextIdx;
            }

            return sampledIndices;
        }

        public SemanticLabel[] RunGeometryBasedFallback(PointCloudData pointCloud)
        {
            if (pointCloud == null || pointCloud.PointCount == 0) return null;

            int n = pointCloud.PointCount;
            SemanticLabel[] labels = new SemanticLabel[n];
            Vector3[] points = pointCloud.Vertices;
            Bounds bounds = pointCloud.GetBounds();

            float floorY = bounds.min.y;
            float ceilY = bounds.max.y;
            float floorThresh = (ceilY - floorY) * 0.08f;
            float ceilThresh = (ceilY - floorY) * 0.08f;
            float wallMinY = floorY + floorThresh;
            float wallMaxY = ceilY - ceilThresh;

            Vector3[] normals = EstimateNormals(points);

            for (int i = 0; i < n; i++)
            {
                float y = points[i].y;
                float ny = normals[i].y;

                if (y <= floorY + floorThresh && ny > 0.7f)
                {
                    labels[i] = SemanticLabel.Floor;
                }
                else if (y >= ceilY - ceilThresh && ny < -0.7f)
                {
                    labels[i] = SemanticLabel.Ceiling;
                }
                else if (Mathf.Abs(ny) < 0.3f)
                {
                    if (y - floorY < 2.2f && y - floorY > 0.0f)
                    {
                        labels[i] = SemanticLabel.Wall;
                    }
                    else
                    {
                        labels[i] = SemanticLabel.Beam;
                    }
                }
                else
                {
                    labels[i] = SemanticLabel.Unlabeled;
                }
            }

            DetectDoorWindowRegions(points, normals, labels, bounds, floorY);

            return labels;
        }

        private void DetectDoorWindowRegions(Vector3[] points, Vector3[] normals, SemanticLabel[] labels, Bounds bounds, float floorY)
        {
            int n = points.Length;
            Dictionary<int, List<int>> wallBuckets = new Dictionary<int, List<int>>();

            for (int i = 0; i < n; i++)
            {
                if (labels[i] != SemanticLabel.Wall) continue;

                int angleBucket = Mathf.RoundToInt(Mathf.Atan2(normals[i].x, normals[i].z) * 12f / Mathf.PI);
                if (!wallBuckets.ContainsKey(angleBucket))
                    wallBuckets[angleBucket] = new List<int>();
                wallBuckets[angleBucket].Add(i);
            }

            foreach (var kvp in wallBuckets)
            {
                List<int> wallPoints = kvp.Value;
                if (wallPoints.Count < 20) continue;

                float minY = float.MaxValue, maxY = float.MinValue;
                for (int j = 0; j < wallPoints.Count; j++)
                {
                    float y = points[wallPoints[j]].y;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }

                float wallHeight = maxY - minY;
                if (wallHeight < 0.5f) continue;

                int numVerticalBins = Mathf.CeilToInt(wallHeight / 0.2f);
                int[] densityBins = new int[numVerticalBins];
                for (int j = 0; j < wallPoints.Count; j++)
                {
                    float y = points[wallPoints[j]].y;
                    int bin = Mathf.Clamp(Mathf.FloorToInt((y - minY) / 0.2f), 0, numVerticalBins - 1);
                    densityBins[bin]++;
                }

                float avgDensity = (float)wallPoints.Count / numVerticalBins;

                for (int j = 0; j < wallPoints.Count; j++)
                {
                    float y = points[wallPoints[j]].y;
                    int bin = Mathf.Clamp(Mathf.FloorToInt((y - minY) / 0.2f), 0, numVerticalBins - 1);

                    if (densityBins[bin] < avgDensity * 0.3f)
                    {
                        if (y - floorY < 2.2f && y - floorY > 0.1f)
                        {
                            labels[wallPoints[j]] = SemanticLabel.Door;
                        }
                        else if (y - floorY > 0.8f && y - floorY < 2.5f)
                        {
                            labels[wallPoints[j]] = SemanticLabel.Window;
                        }
                    }
                }
            }
        }

        public float GetPointConfidence(int pointIndex)
        {
            if (classProbabilities == null || pointIndex < 0 || pointIndex * 11 + 10 >= classProbabilities.Length)
                return 0f;

            float maxProb = 0f;
            for (int c = 0; c < 11; c++)
            {
                float prob = classProbabilities[pointIndex * 11 + c];
                if (prob > maxProb) maxProb = prob;
            }
            return maxProb;
        }

        private void ReleaseBuffers()
        {
            pointsBuffer?.Release();
            normalsBuffer?.Release();
            sampledPointsBuffer?.Release();
            sampledFeaturesBuffer?.Release();
            neighborIndicesBuffer?.Release();
            neighborCountsBuffer?.Release();
            propagatedFeaturesBuffer?.Release();
            classPredictionsBuffer?.Release();
            classProbabilitiesBuffer?.Release();

            pointsBuffer = null;
            normalsBuffer = null;
            sampledPointsBuffer = null;
            sampledFeaturesBuffer = null;
            neighborIndicesBuffer = null;
            neighborCountsBuffer = null;
            propagatedFeaturesBuffer = null;
            classPredictionsBuffer = null;
            classProbabilitiesBuffer = null;
        }

        public void Dispose()
        {
            ReleaseBuffers();
            classPredictions = null;
            classProbabilities = null;
        }
    }
}
