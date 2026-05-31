using System;
using System.Collections.Generic;
using UnityEngine;

namespace LiDARFurniturePlacer.Feature
{
    public class RANSACInitialEstimator
    {
        public class RANSACResult
        {
            public Matrix4x4 Transform;
            public int InlierCount;
            public float InlierRatio;
            public float RMSE;
            public int Iterations;
            public List<SIFTLikeDescriptor.FeatureMatch> InlierMatches;
        }

        private int maxIterations = 10000;
        private float inlierThreshold = 0.1f;
        private float confidence = 0.99f;
        private int minSampleSize = 3;

        public int MaxIterations
        {
            get => maxIterations;
            set => maxIterations = value;
        }

        public float InlierThreshold
        {
            get => inlierThreshold;
            set => inlierThreshold = value;
        }

        public float Confidence
        {
            get => confidence;
            set => confidence = Mathf.Clamp01(value);
        }

        public RANSACResult Estimate(List<SIFTLikeDescriptor.FeatureMatch> matches)
        {
            if (matches == null || matches.Count < minSampleSize)
            {
                Debug.LogWarning($"Not enough matches for RANSAC: {matches?.Count ?? 0}");
                return null;
            }

            RANSACResult bestResult = null;
            int bestInlierCount = 0;
            int adaptiveMaxIter = maxIterations;

            for (int iter = 0; iter < adaptiveMaxIter; iter++)
            {
                int[] sampleIndices = RandomSample(matches.Count, minSampleSize);

                List<Tuple<Vector3, Vector3>> samplePairs = new List<Tuple<Vector3, Vector3>>();
                bool validSample = true;

                for (int i = 0; i < sampleIndices.Length; i++)
                {
                    Vector3 src = matches[sampleIndices[i]].Source.Keypoint.Position;
                    Vector3 tgt = matches[sampleIndices[i]].Target.Keypoint.Position;
                    samplePairs.Add(Tuple.Create(src, tgt));
                }

                if (!IsSampleGeometricallyValid(samplePairs))
                    continue;

                Matrix4x4 candidateTransform = EstimateTransformFromPairs(samplePairs);

                int inlierCount = 0;
                float errorSum = 0;
                List<SIFTLikeDescriptor.FeatureMatch> inlierMatches = new List<SIFTLikeDescriptor.FeatureMatch>();

                for (int i = 0; i < matches.Count; i++)
                {
                    Vector3 transformed = candidateTransform.MultiplyPoint(matches[i].Source.Keypoint.Position);
                    float error = Vector3.Distance(transformed, matches[i].Target.Keypoint.Position);

                    if (error < inlierThreshold)
                    {
                        inlierCount++;
                        errorSum += error * error;
                        inlierMatches.Add(matches[i]);
                    }
                }

                if (inlierCount > bestInlierCount)
                {
                    bestInlierCount = inlierCount;

                    float inlierRatio = (float)inlierCount / matches.Count;
                    float rmse = inlierCount > 0 ? Mathf.Sqrt(errorSum / inlierCount) : float.MaxValue;

                    bestResult = new RANSACResult
                    {
                        Transform = candidateTransform,
                        InlierCount = inlierCount,
                        InlierRatio = inlierRatio,
                        RMSE = rmse,
                        Iterations = iter + 1,
                        InlierMatches = inlierMatches
                    };

                    if (inlierRatio > 0)
                    {
                        double w = (double)inlierRatio;
                        double pNoOutlier = 1.0 - Math.Pow(w, minSampleSize);
                        if (pNoOutlier > 0)
                        {
                            int newMaxIter = (int)(Math.Log(1.0 - confidence) / Math.Log(pNoOutlier));
                            adaptiveMaxIter = Mathf.Min(newMaxIter, maxIterations);
                        }
                    }

                    if (inlierRatio >= confidence)
                        break;
                }
            }

            if (bestResult != null && bestResult.InlierMatches.Count >= minSampleSize)
            {
                Matrix4x4 refinedTransform = RefineWithInliers(bestResult.InlierMatches);
                bestResult.Transform = refinedTransform;
                bestResult.RMSE = RecalculateRMSE(refinedTransform, bestResult.InlierMatches);
            }

            return bestResult;
        }

        private bool IsSampleGeometricallyValid(List<Tuple<Vector3, Vector3>> pairs)
        {
            if (pairs.Count < 3)
                return true;

            for (int i = 0; i < pairs.Count; i++)
            {
                for (int j = i + 1; j < pairs.Count; j++)
                {
                    float srcDist = Vector3.Distance(pairs[i].Item1, pairs[j].Item1);
                    float tgtDist = Vector3.Distance(pairs[i].Item2, pairs[j].Item2);

                    if (srcDist < 0.001f || tgtDist < 0.001f)
                        return false;

                    float ratio = srcDist / tgtDist;
                    if (ratio < 0.5f || ratio > 2f)
                        return false;
                }
            }

            return true;
        }

        private Matrix4x4 EstimateTransformFromPairs(List<Tuple<Vector3, Vector3>> pairs)
        {
            Vector3 srcCentroid = Vector3.zero;
            Vector3 tgtCentroid = Vector3.zero;

            foreach (var pair in pairs)
            {
                srcCentroid += pair.Item1;
                tgtCentroid += pair.Item2;
            }

            float invCount = 1.0f / pairs.Count;
            srcCentroid *= invCount;
            tgtCentroid *= invCount;

            double[,] H = new double[3, 3];
            foreach (var pair in pairs)
            {
                Vector3 s = pair.Item1 - srcCentroid;
                Vector3 t = pair.Item2 - tgtCentroid;

                H[0, 0] += s.x * t.x; H[0, 1] += s.x * t.y; H[0, 2] += s.x * t.z;
                H[1, 0] += s.y * t.x; H[1, 1] += s.y * t.y; H[1, 2] += s.y * t.z;
                H[2, 0] += s.z * t.x; H[2, 1] += s.z * t.y; H[2, 2] += s.z * t.z;
            }

            double[,] U, Vt;
            SVD3x3(H, out U, out Vt);

            double[,] R = MultiplyMatrices(Vt, TransposeMatrix(U));

            if (Determinant3x3(R) < 0)
            {
                for (int i = 0; i < 3; i++)
                    Vt[2, i] *= -1;
                R = MultiplyMatrices(Vt, TransposeMatrix(U));
            }

            Vector3 t_vec = tgtCentroid - MultiplyMatrixVector(R, srcCentroid);

            Matrix4x4 result = Matrix4x4.identity;
            result[0, 0] = (float)R[0, 0]; result[0, 1] = (float)R[0, 1]; result[0, 2] = (float)R[0, 2];
            result[1, 0] = (float)R[1, 0]; result[1, 1] = (float)R[1, 1]; result[1, 2] = (float)R[1, 2];
            result[2, 0] = (float)R[2, 0]; result[2, 1] = (float)R[2, 1]; result[2, 2] = (float)R[2, 2];
            result[0, 3] = t_vec.x; result[1, 3] = t_vec.y; result[2, 3] = t_vec.z;

            return result;
        }

        private Matrix4x4 RefineWithInliers(List<SIFTLikeDescriptor.FeatureMatch> inlierMatches)
        {
            List<Tuple<Vector3, Vector3>> pairs = new List<Tuple<Vector3, Vector3>>();
            foreach (var match in inlierMatches)
            {
                pairs.Add(Tuple.Create(match.Source.Keypoint.Position, match.Target.Keypoint.Position));
            }
            return EstimateTransformFromPairs(pairs);
        }

        private float RecalculateRMSE(Matrix4x4 transform, List<SIFTLikeDescriptor.FeatureMatch> matches)
        {
            double sum = 0;
            foreach (var match in matches)
            {
                Vector3 transformed = transform.MultiplyPoint(match.Source.Keypoint.Position);
                sum += (transformed - match.Target.Keypoint.Position).sqrMagnitude;
            }
            return (float)Math.Sqrt(sum / matches.Count);
        }

        private int[] RandomSample(int count, int sampleSize)
        {
            int[] indices = new int[sampleSize];
            for (int i = 0; i < sampleSize; i++)
            {
                int idx;
                bool duplicate;
                do
                {
                    idx = UnityEngine.Random.Range(0, count);
                    duplicate = false;
                    for (int j = 0; j < i; j++)
                    {
                        if (indices[j] == idx)
                        {
                            duplicate = true;
                            break;
                        }
                    }
                } while (duplicate);
                indices[i] = idx;
            }
            return indices;
        }

        private void SVD3x3(double[,] A, out double[,] U, out double[,] Vt)
        {
            int n = 3;
            U = new double[n, n];
            Vt = new double[n, n];

            for (int i = 0; i < n; i++)
                for (int j = 0; j < n; j++)
                    U[i, j] = A[i, j];

            for (int i = 0; i < n; i++)
                for (int j = 0; j < n; j++)
                    Vt[i, j] = (i == j) ? 1.0 : 0.0;

            for (int iter = 0; iter < 50; iter++)
            {
                double offDiag = 0;
                for (int p = 0; p < n; p++)
                    for (int q = p + 1; q < n; q++)
                        offDiag += Math.Abs(U[p, q]);

                if (offDiag < 1e-10) break;

                for (int p = 0; p < n; p++)
                {
                    for (int q = p + 1; q < n; q++)
                    {
                        double apq = U[p, q];
                        if (Math.Abs(apq) < 1e-12) continue;

                        double app = U[p, p];
                        double aqq = U[q, q];
                        double theta = (aqq - app) / (2 * apq);

                        double t;
                        if (Math.Abs(theta) > 1e10)
                            t = 1 / (2 * theta);
                        else
                        {
                            double sign = theta >= 0 ? 1 : -1;
                            t = sign / (Math.Abs(theta) + Math.Sqrt(theta * theta + 1));
                        }

                        double c = 1 / Math.Sqrt(1 + t * t);
                        double s = t * c;

                        for (int i = 0; i < n; i++)
                        {
                            double uip = U[i, p]; double uiq = U[i, q];
                            U[i, p] = c * uip - s * uiq;
                            U[i, q] = s * uip + c * uiq;
                        }

                        for (int i = 0; i < n; i++)
                        {
                            double vpi = Vt[p, i]; double vqi = Vt[q, i];
                            Vt[p, i] = c * vpi - s * vqi;
                            Vt[q, i] = s * vpi + c * vqi;
                        }

                        for (int i = 0; i < n; i++)
                        {
                            double upi = U[p, i]; double uqi = U[q, i];
                            U[p, i] = c * upi - s * uqi;
                            U[q, i] = s * upi + c * uqi;
                        }
                    }
                }
            }
        }

        private double[,] MultiplyMatrices(double[,] A, double[,] B)
        {
            int n = A.GetLength(0);
            int m = B.GetLength(1);
            int k = B.GetLength(0);
            double[,] result = new double[n, m];
            for (int i = 0; i < n; i++)
                for (int j = 0; j < m; j++)
                {
                    double sum = 0;
                    for (int l = 0; l < k; l++)
                        sum += A[i, l] * B[l, j];
                    result[i, j] = sum;
                }
            return result;
        }

        private double[,] TransposeMatrix(double[,] A)
        {
            int n = A.GetLength(0);
            int m = A.GetLength(1);
            double[,] result = new double[m, n];
            for (int i = 0; i < n; i++)
                for (int j = 0; j < m; j++)
                    result[j, i] = A[i, j];
            return result;
        }

        private double Determinant3x3(double[,] m)
        {
            return m[0, 0] * (m[1, 1] * m[2, 2] - m[1, 2] * m[2, 1])
                 - m[0, 1] * (m[1, 0] * m[2, 2] - m[1, 2] * m[2, 0])
                 + m[0, 2] * (m[1, 0] * m[2, 1] - m[1, 1] * m[2, 0]);
        }

        private Vector3 MultiplyMatrixVector(double[,] R, Vector3 v)
        {
            return new Vector3(
                (float)(R[0, 0] * v.x + R[0, 1] * v.y + R[0, 2] * v.z),
                (float)(R[1, 0] * v.x + R[1, 1] * v.y + R[1, 2] * v.z),
                (float)(R[2, 0] * v.x + R[2, 1] * v.y + R[2, 2] * v.z)
            );
        }
    }
}
