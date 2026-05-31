using System;
using System.Collections.Generic;
using UnityEngine;

namespace LiDARFurniturePlacer.Feature
{
    public class ISSKeypointDetector
    {
        public struct Keypoint
        {
            public Vector3 Position;
            public int OriginalIndex;
            public float Response;
            public Vector3 Normal;
            public float Eigenvalue1;
            public float Eigenvalue2;
            public float Eigenvalue3;
        }

        private float salientRadius;
        private float nonMaxRadius;
        private float gamma21 = 0.975f;
        private float gamma32 = 0.975f;
        private int minNeighbors = 5;
        private float normalEstimationRadius;
        private int maxKeypoints = 5000;

        public ISSKeypointDetector(float salientRadius = 0.1f, float nonMaxRadius = 0.1f)
        {
            this.salientRadius = salientRadius;
            this.nonMaxRadius = nonMaxRadius;
            this.normalEstimationRadius = salientRadius * 2f;
        }

        public float SalientRadius
        {
            get => salientRadius;
            set
            {
                salientRadius = value;
                normalEstimationRadius = value * 2f;
            }
        }

        public float NonMaxRadius
        {
            get => nonMaxRadius;
            set => nonMaxRadius = value;
        }

        public int MaxKeypoints
        {
            get => maxKeypoints;
            set => maxKeypoints = value;
        }

        public List<Keypoint> DetectKeypoints(Vector3[] points)
        {
            KDTree tree = new KDTree(points);

            Vector3[] normals = EstimateNormals(points, tree);

            List<Keypoint> candidates = new List<Keypoint>();

            for (int i = 0; i < points.Length; i++)
            {
                int[] neighborIndices = tree.FindRadius(points[i], salientRadius, out double[] _);

                if (neighborIndices.Length < minNeighbors)
                    continue;

                float e1, e2, e3;
                if (!ComputeEigenvalues(points, neighborIndices, out e1, out e2, out e3))
                    continue;

                if (e1 < 1e-10f)
                    continue;

                float ratio21 = e2 / e1;
                float ratio32 = e3 / e2;

                if (ratio21 < gamma21 && ratio32 < gamma32)
                {
                    Keypoint kp = new Keypoint
                    {
                        Position = points[i],
                        OriginalIndex = i,
                        Response = e3,
                        Normal = normals[i],
                        Eigenvalue1 = e1,
                        Eigenvalue2 = e2,
                        Eigenvalue3 = e3
                    };
                    candidates.Add(kp);
                }
            }

            List<Keypoint> filtered = NonMaximumSuppression(candidates, tree);

            if (filtered.Count > maxKeypoints)
            {
                filtered.Sort((a, b) => b.Response.CompareTo(a.Response));
                filtered = filtered.GetRange(0, maxKeypoints);
            }

            Debug.Log($"ISS: {candidates.Count} candidates, {filtered.Count} keypoints after NMS");
            return filtered;
        }

        public List<Keypoint> DetectKeypoints(Vector3[] points, KDTree tree)
        {
            Vector3[] normals = EstimateNormals(points, tree);

            List<Keypoint> candidates = new List<Keypoint>();

            for (int i = 0; i < points.Length; i++)
            {
                int[] neighborIndices = tree.FindRadius(points[i], salientRadius, out double[] _);

                if (neighborIndices.Length < minNeighbors)
                    continue;

                float e1, e2, e3;
                if (!ComputeEigenvalues(points, neighborIndices, out e1, out e2, out e3))
                    continue;

                if (e1 < 1e-10f)
                    continue;

                float ratio21 = e2 / e1;
                float ratio32 = e3 / e2;

                if (ratio21 < gamma21 && ratio32 < gamma32)
                {
                    Keypoint kp = new Keypoint
                    {
                        Position = points[i],
                        OriginalIndex = i,
                        Response = e3,
                        Normal = normals[i],
                        Eigenvalue1 = e1,
                        Eigenvalue2 = e2,
                        Eigenvalue3 = e3
                    };
                    candidates.Add(kp);
                }
            }

            List<Keypoint> filtered = NonMaximumSuppression(candidates, tree);

            if (filtered.Count > maxKeypoints)
            {
                filtered.Sort((a, b) => b.Response.CompareTo(a.Response));
                filtered = filtered.GetRange(0, maxKeypoints);
            }

            return filtered;
        }

        private Vector3[] EstimateNormals(Vector3[] points, KDTree tree)
        {
            Vector3[] normals = new Vector3[points.Length];

            for (int i = 0; i < points.Length; i++)
            {
                int[] neighbors = tree.FindRadius(points[i], normalEstimationRadius, out double[] _);

                if (neighbors.Length < 3)
                {
                    normals[i] = Vector3.up;
                    continue;
                }

                Vector3 centroid = Vector3.zero;
                for (int j = 0; j < neighbors.Length; j++)
                {
                    centroid += points[neighbors[j]];
                }
                centroid /= neighbors.Length;

                double xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
                for (int j = 0; j < neighbors.Length; j++)
                {
                    Vector3 p = points[neighbors[j]] - centroid;
                    xx += p.x * p.x;
                    xy += p.x * p.y;
                    xz += p.x * p.z;
                    yy += p.y * p.y;
                    yz += p.y * p.z;
                    zz += p.z * p.z;
                }

                float e1, e2, e3;
                Eigen3x3(xx, xy, xz, yy, yz, zz, out e1, out e2, out e3, out Vector3 n1, out Vector3 _, out Vector3 __);
                normals[i] = n1.normalized;
            }

            return normals;
        }

        private bool ComputeEigenvalues(Vector3[] points, int[] neighborIndices, out float e1, out float e2, out float e3)
        {
            e1 = e2 = e3 = 0;

            Vector3 centroid = Vector3.zero;
            for (int i = 0; i < neighborIndices.Length; i++)
            {
                centroid += points[neighborIndices[i]];
            }
            centroid /= neighborIndices.Length;

            double xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
            double totalWeight = 0;

            for (int i = 0; i < neighborIndices.Length; i++)
            {
                Vector3 p = points[neighborIndices[i]] - centroid;
                float distSq = p.sqrMagnitude;
                float w = (float)Math.Exp(-distSq / (salientRadius * salientRadius));

                xx += w * p.x * p.x;
                xy += w * p.x * p.y;
                xz += w * p.x * p.z;
                yy += w * p.y * p.y;
                yz += w * p.y * p.z;
                zz += w * p.z * p.z;
                totalWeight += w;
            }

            if (totalWeight > 1e-10)
            {
                float invW = (float)(1.0 / totalWeight);
                xx *= invW; xy *= invW; xz *= invW;
                yy *= invW; yz *= invW; zz *= invW;
            }

            Vector3 v1, v2, v3;
            Eigen3x3(xx, xy, xz, yy, yz, zz, out e1, out e2, out e3, out v1, out v2, out v3);

            return e1 >= e2 && e2 >= e3;
        }

        private void Eigen3x3(double m00, double m01, double m02, double m11, double m12, double m22,
            out float e1, out float e2, out float e3,
            out Vector3 v1, out Vector3 v2, out Vector3 v3)
        {
            double a = m00;
            double b = m01;
            double c = m02;
            double d = m11;
            double e = m12;
            double f = m22;

            double p1 = b * b + c * c + e * e;
            e1 = e2 = e3 = 0;
            v1 = Vector3.right;
            v2 = Vector3.up;
            v3 = Vector3.forward;

            if (p1 < 1e-14)
            {
                e1 = (float)a;
                e2 = (float)d;
                e3 = (float)f;
                return;
            }

            double q = (a + d + f) / 3.0;
            double p2 = (a - q) * (a - q) + (d - q) * (d - q) + (f - q) * (f - q) + 2.0 * p1;
            double p = Math.Sqrt(p2 / 6.0);

            double invP = 1.0 / p;
            double[,] B = new double[3, 3];
            B[0, 0] = (a - q) * invP; B[0, 1] = b * invP; B[0, 2] = c * invP;
            B[1, 0] = b * invP; B[1, 1] = (d - q) * invP; B[1, 2] = e * invP;
            B[2, 0] = c * invP; B[2, 1] = e * invP; B[2, 2] = (f - q) * invP;

            double detB = B[0, 0] * (B[1, 1] * B[2, 2] - B[1, 2] * B[2, 1])
                        - B[0, 1] * (B[1, 0] * B[2, 2] - B[1, 2] * B[2, 0])
                        + B[0, 2] * (B[1, 0] * B[2, 1] - B[1, 1] * B[2, 0]);

            double r = detB / 2.0;
            double phi;
            if (r <= -1)
                phi = Math.PI / 3.0;
            else if (r >= 1)
                phi = 0;
            else
                phi = Math.Acos(r) / 3.0;

            double eig1 = q + 2.0 * p * Math.Cos(phi);
            double eig3 = q + 2.0 * p * Math.Cos(phi + 2.0 * Math.PI / 3.0);
            double eig2 = 3.0 * q - eig1 - eig3;

            e1 = (float)eig1;
            e2 = (float)eig2;
            e3 = (float)eig3;

            v1 = EstimateEigenvector(m00, m01, m02, m11, m12, m22, eig1);
            v2 = EstimateEigenvector(m00, m01, m02, m11, m12, m22, eig2);
            v3 = EstimateEigenvector(m00, m01, m02, m11, m12, m22, eig3);
        }

        private Vector3 EstimateEigenvector(double m00, double m01, double m02, double m11, double m12, double m22, double eigenvalue)
        {
            double[,] A = new double[3, 3];
            A[0, 0] = m00 - eigenvalue; A[0, 1] = m01; A[0, 2] = m02;
            A[1, 0] = m01; A[1, 1] = m11 - eigenvalue; A[1, 2] = m12;
            A[2, 0] = m02; A[2, 1] = m12; A[2, 2] = m22 - eigenvalue;

            Vector3[] testVectors = {
                new Vector3(1, 0, 0),
                new Vector3(0, 1, 0),
                new Vector3(0, 0, 1),
                new Vector3(1, 1, 0).normalized,
                new Vector3(1, 0, 1).normalized,
                new Vector3(0, 1, 1).normalized
            };

            Vector3 bestVec = Vector3.up;
            float minResidual = float.MaxValue;

            foreach (var v in testVectors)
            {
                for (int iter = 0; iter < 10; iter++)
                {
                    double x = A[0, 0] * v.x + A[0, 1] * v.y + A[0, 2] * v.z;
                    double y = A[1, 0] * v.x + A[1, 1] * v.y + A[1, 2] * v.z;
                    double z = A[2, 0] * v.x + A[2, 1] * v.y + A[2, 2] * v.z;

                    double mag = Math.Sqrt(x * x + y * y + z * z);
                    if (mag < 1e-14)
                        break;

                    Vector3 newV = new Vector3((float)(x / mag), (float)(y / mag), (float)(z / mag));
                    float residual = (float)mag;
                    if (residual < minResidual)
                    {
                        minResidual = residual;
                        bestVec = newV;
                    }
                }
            }

            return bestVec.normalized;
        }

        private List<Keypoint> NonMaximumSuppression(List<Keypoint> candidates, KDTree tree)
        {
            candidates.Sort((a, b) => b.Response.CompareTo(a.Response));

            HashSet<int> suppressed = new HashSet<int>();
            List<Keypoint> result = new List<Keypoint>();

            for (int i = 0; i < candidates.Count; i++)
            {
                if (suppressed.Contains(candidates[i].OriginalIndex))
                    continue;

                result.Add(candidates[i]);

                int[] neighbors = tree.FindRadius(candidates[i].Position, nonMaxRadius, out double[] _);
                for (int j = 0; j < neighbors.Length; j++)
                {
                    suppressed.Add(neighbors[j]);
                }
            }

            return result;
        }

        public static float EstimateSalientRadius(Vector3[] points)
        {
            if (points == null || points.Length == 0)
                return 0.1f;

            Bounds bounds = new Bounds(points[0], Vector3.zero);
            for (int i = 1; i < points.Length; i++)
            {
                bounds.Encapsulate(points[i]);
            }

            float diagonal = bounds.size.magnitude;

            int sampleCount = Math.Min(points.Length, 1000);
            double avgNeighborDist = 0;
            KDTree sampleTree = new KDTree(points);

            int sampleStep = Math.Max(1, points.Length / sampleCount);
            int samples = 0;

            for (int i = 0; i < points.Length && samples < sampleCount; i += sampleStep)
            {
                int[] kNearest = sampleTree.FindKNearest(points[i], 6, out double[] dists);
                if (kNearest.Length >= 2 && dists[1] > 0)
                {
                    avgNeighborDist += Math.Sqrt(dists[1]);
                    samples++;
                }
            }

            if (samples > 0)
            {
                avgNeighborDist /= samples;
                return (float)(avgNeighborDist * 5.0);
            }

            return diagonal * 0.01f;
        }
    }
}
