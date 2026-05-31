using System;
using System.Collections.Generic;
using UnityEngine;
using LiDARFurniturePlacer.Core;

namespace LiDARFurniturePlacer.ICP
{
    public class ICPRegistration
    {
        public class RegistrationResult
        {
            public Matrix4x4 Transform;
            public double Fitness;
            public double InlierRMSE;
            public int Iterations;
            public bool Converged;
        }

        private int maxIterations = 100;
        private double convergenceThreshold = 1e-8;
        private double maxCorrespondenceDistance = double.MaxValue;
        private double outlierThreshold = 0.05;

        public int MaxIterations
        {
            get => maxIterations;
            set => maxIterations = value;
        }

        public double ConvergenceThreshold
        {
            get => convergenceThreshold;
            set => convergenceThreshold = value;
        }

        public double MaxCorrespondenceDistance
        {
            get => maxCorrespondenceDistance;
            set => maxCorrespondenceDistance = value;
        }

        public double OutlierThreshold
        {
            get => outlierThreshold;
            set => outlierThreshold = value;
        }

        public RegistrationResult Register(PointCloudData source, PointCloudData target, Matrix4x4 initialGuess)
        {
            return Register(source.Vertices, target.Vertices, initialGuess);
        }

        public RegistrationResult Register(Vector3[] source, Vector3[] target, Matrix4x4 initialGuess)
        {
            RegistrationResult result = new RegistrationResult
            {
                Transform = initialGuess,
                Iterations = 0,
                Converged = false
            };

            Vector3[] transformedSource = (Vector3[])source.Clone();
            ApplyTransform(transformedSource, initialGuess);

            KDTree targetTree = new KDTree(target);

            double previousFitness = double.MaxValue;

            for (int iteration = 0; iteration < maxIterations; iteration++)
            {
                result.Iterations = iteration + 1;

                List<Tuple<Vector3, Vector3>> correspondences = FindCorrespondences(
                    transformedSource, target, targetTree);

                if (correspondences.Count < 3)
                {
                    Debug.LogWarning("Not enough correspondences found");
                    break;
                }

                List<Tuple<Vector3, Vector3>> inliers = RejectOutliers(correspondences);

                if (inliers.Count < 3)
                {
                    Debug.LogWarning("Not enough inliers after outlier rejection");
                    break;
                }

                Matrix4x4 deltaTransform = EstimateRigidTransformation(inliers);

                ApplyTransform(transformedSource, deltaTransform);

                result.Transform = deltaTransform * result.Transform;

                double fitness = CalculateFitness(inliers);
                result.Fitness = fitness;
                result.InlierRMSE = Math.Sqrt(fitness);

                double improvement = Math.Abs(previousFitness - fitness);
                if (improvement < convergenceThreshold && iteration > 2)
                {
                    result.Converged = true;
                    break;
                }

                previousFitness = fitness;
            }

            return result;
        }

        private List<Tuple<Vector3, Vector3>> FindCorrespondences(
            Vector3[] source, Vector3[] target, KDTree targetTree)
        {
            List<Tuple<Vector3, Vector3>> correspondences = new List<Tuple<Vector3, Vector3>>();
            double maxDistSq = maxCorrespondenceDistance * maxCorrespondenceDistance;

            for (int i = 0; i < source.Length; i++)
            {
                Vector3 sourcePoint = source[i];
                int nearestIndex = targetTree.FindNearest(sourcePoint, out double distanceSq);

                if (distanceSq <= maxDistSq)
                {
                    correspondences.Add(Tuple.Create(sourcePoint, target[nearestIndex]));
                }
            }

            return correspondences;
        }

        private List<Tuple<Vector3, Vector3>> RejectOutliers(
            List<Tuple<Vector3, Vector3>> correspondences)
        {
            List<double> distances = new List<double>();
            foreach (var pair in correspondences)
            {
                distances.Add(Vector3.Distance(pair.Item1, pair.Item2));
            }

            distances.Sort();
            double median = distances[distances.Count / 2];
            double threshold = median * 3.0;

            List<Tuple<Vector3, Vector3>> inliers = new List<Tuple<Vector3, Vector3>>();
            foreach (var pair in correspondences)
            {
                double dist = Vector3.Distance(pair.Item1, pair.Item2);
                if (dist < threshold)
                {
                    inliers.Add(pair);
                }
            }

            return inliers;
        }

        private Matrix4x4 EstimateRigidTransformation(List<Tuple<Vector3, Vector3>> correspondences)
        {
            Vector3 sourceCentroid = Vector3.zero;
            Vector3 targetCentroid = Vector3.zero;

            foreach (var pair in correspondences)
            {
                sourceCentroid += pair.Item1;
                targetCentroid += pair.Item2;
            }

            float count = 1.0f / correspondences.Count;
            sourceCentroid *= count;
            targetCentroid *= count;

            double[,] H = new double[3, 3];
            for (int i = 0; i < correspondences.Count; i++)
            {
                Vector3 s = correspondences[i].Item1 - sourceCentroid;
                Vector3 t = correspondences[i].Item2 - targetCentroid;

                H[0, 0] += s.x * t.x;
                H[0, 1] += s.x * t.y;
                H[0, 2] += s.x * t.z;
                H[1, 0] += s.y * t.x;
                H[1, 1] += s.y * t.y;
                H[1, 2] += s.y * t.z;
                H[2, 0] += s.z * t.x;
                H[2, 1] += s.z * t.y;
                H[2, 2] += s.z * t.z;
            }

            double[,] U, Vt;
            SingularValueDecomposition(H, out U, out Vt);

            double[,] R = MultiplyMatrices(Vt, TransposeMatrix(U));

            if (Determinant3x3(R) < 0)
            {
                for (int i = 0; i < 3; i++)
                {
                    Vt[2, i] *= -1;
                }
                R = MultiplyMatrices(Vt, TransposeMatrix(U));
            }

            Vector3 t = targetCentroid - MultiplyMatrixVector(R, sourceCentroid);

            Matrix4x4 result = Matrix4x4.identity;
            result[0, 0] = (float)R[0, 0];
            result[0, 1] = (float)R[0, 1];
            result[0, 2] = (float)R[0, 2];
            result[1, 0] = (float)R[1, 0];
            result[1, 1] = (float)R[1, 1];
            result[1, 2] = (float)R[1, 2];
            result[2, 0] = (float)R[2, 0];
            result[2, 1] = (float)R[2, 1];
            result[2, 2] = (float)R[2, 2];
            result[0, 3] = t.x;
            result[1, 3] = t.y;
            result[2, 3] = t.z;

            return result;
        }

        private void SingularValueDecomposition(double[,] A, out double[,] U, out double[,] Vt)
        {
            int n = 3;
            U = new double[n, n];
            Vt = new double[n, n];
            double[] S = new double[n];

            for (int i = 0; i < n; i++)
            {
                for (int j = 0; j < n; j++)
                {
                    U[i, j] = A[i, j];
                }
            }

            for (int i = 0; i < n; i++)
            {
                for (int j = 0; j < n; j++)
                {
                    Vt[i, j] = (i == j) ? 1.0 : 0.0;
                }
            }

            for (int iter = 0; iter < 50; iter++)
            {
                double offDiagonal = 0;
                for (int p = 0; p < n; p++)
                {
                    for (int q = p + 1; q < n; q++)
                    {
                        offDiagonal += Math.Abs(U[p, q]);
                    }
                }

                if (offDiagonal < 1e-10)
                    break;

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
                        {
                            t = 1 / (2 * theta);
                        }
                        else
                        {
                            double sign = theta >= 0 ? 1 : -1;
                            t = sign / (Math.Abs(theta) + Math.Sqrt(theta * theta + 1));
                        }

                        double c = 1 / Math.Sqrt(1 + t * t);
                        double s = t * c;

                        for (int i = 0; i < n; i++)
                        {
                            double uip = U[i, p];
                            double uiq = U[i, q];
                            U[i, p] = c * uip - s * uiq;
                            U[i, q] = s * uip + c * uiq;
                        }

                        for (int i = 0; i < n; i++)
                        {
                            double vpi = Vt[p, i];
                            double vqi = Vt[q, i];
                            Vt[p, i] = c * vpi - s * vqi;
                            Vt[q, i] = s * vpi + c * vqi;
                        }

                        for (int i = 0; i < n; i++)
                        {
                            double upi = U[p, i];
                            double uqi = U[q, i];
                            U[p, i] = c * upi - s * uqi;
                            U[q, i] = s * upi + c * uqi;
                        }
                    }
                }
            }

            for (int i = 0; i < n; i++)
            {
                S[i] = U[i, i];
            }
        }

        private double[,] MultiplyMatrices(double[,] A, double[,] B)
        {
            int n = A.GetLength(0);
            int m = B.GetLength(1);
            int k = B.GetLength(0);
            double[,] result = new double[n, m];

            for (int i = 0; i < n; i++)
            {
                for (int j = 0; j < m; j++)
                {
                    double sum = 0;
                    for (int l = 0; l < k; l++)
                    {
                        sum += A[i, l] * B[l, j];
                    }
                    result[i, j] = sum;
                }
            }

            return result;
        }

        private double[,] TransposeMatrix(double[,] A)
        {
            int n = A.GetLength(0);
            int m = A.GetLength(1);
            double[,] result = new double[m, n];

            for (int i = 0; i < n; i++)
            {
                for (int j = 0; j < m; j++)
                {
                    result[j, i] = A[i, j];
                }
            }

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

        private void ApplyTransform(Vector3[] points, Matrix4x4 transform)
        {
            for (int i = 0; i < points.Length; i++)
            {
                points[i] = transform.MultiplyPoint(points[i]);
            }
        }

        private double CalculateFitness(List<Tuple<Vector3, Vector3>> correspondences)
        {
            double sum = 0;
            foreach (var pair in correspondences)
            {
                sum += (pair.Item1 - pair.Item2).sqrMagnitude;
            }
            return sum / correspondences.Count;
        }
    }
}
