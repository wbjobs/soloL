using System;
using System.Collections.Generic;
using UnityEngine;
using LiDARFurniturePlacer.Core;

namespace LiDARFurniturePlacer.Furniture
{
    public class WallDetector : MonoBehaviour
    {
        [SerializeField] private float distanceThreshold = 0.05f;
        [SerializeField] private int minInliers = 1000;
        [SerializeField] private int maxIterations = 1000;
        [SerializeField] private float normalTolerance = 0.8f;
        [SerializeField] private float wallHeightMin = 0.5f;
        [SerializeField] private float wallHeightMax = 5f;

        public class DetectedWall
        {
            public Vector3 Normal;
            public float Distance;
            public Vector3[] InlierPoints;
            public Bounds Bounds;
            public Vector3 Center;
            public Vector3 Size;
            public Plane Plane;
            public GameObject Visualizer;
        }

        private List<DetectedWall> detectedWalls = new List<DetectedWall>();

        public IReadOnlyList<DetectedWall> DetectedWalls => detectedWalls;
        public event Action<IReadOnlyList<DetectedWall>> OnWallsDetected;

        public List<DetectedWall> DetectWalls(PointCloudData pointCloud)
        {
            ClearDetectedWalls();

            if (pointCloud == null || pointCloud.PointCount < minInliers)
            {
                Debug.LogWarning("Insufficient points for wall detection");
                return detectedWalls;
            }

            Vector3[] points = (Vector3[])pointCloud.Vertices.Clone();
            List<int> remainingIndices = new List<int>();
            for (int i = 0; i < points.Length; i++)
            {
                remainingIndices.Add(i);
            }

            int wallCount = 0;
            while (remainingIndices.Count >= minInliers && wallCount < 20)
            {
                DetectedWall wall = DetectSingleWall(points, remainingIndices);
                if (wall != null && IsValidWall(wall))
                {
                    detectedWalls.Add(wall);
                    CreateWallVisualizer(wall);
                    wallCount++;
                }
                else
                {
                    break;
                }
            }

            MergeOverlappingWalls();
            OnWallsDetected?.Invoke(detectedWalls);

            Debug.Log($"Detected {detectedWalls.Count} walls");
            return detectedWalls;
        }

        private DetectedWall DetectSingleWall(Vector3[] points, List<int> remainingIndices)
        {
            int bestInlierCount = 0;
            Vector3 bestNormal = Vector3.zero;
            float bestDistance = 0;
            List<int> bestInlierIndices = new List<int>();

            for (int iter = 0; iter < maxIterations; iter++)
            {
                if (remainingIndices.Count < 3)
                    break;

                int idx1 = remainingIndices[UnityEngine.Random.Range(0, remainingIndices.Count)];
                int idx2 = remainingIndices[UnityEngine.Random.Range(0, remainingIndices.Count)];
                int idx3 = remainingIndices[UnityEngine.Random.Range(0, remainingIndices.Count)];

                if (idx1 == idx2 || idx2 == idx3 || idx1 == idx3)
                    continue;

                Vector3 p1 = points[idx1];
                Vector3 p2 = points[idx2];
                Vector3 p3 = points[idx3];

                Vector3 normal = Vector3.Cross(p2 - p1, p3 - p1).normalized;

                if (Mathf.Abs(Vector3.Dot(normal, Vector3.up)) > 0.5f)
                    continue;

                if (normal.y < 0)
                    normal = -normal;

                float distance = -Vector3.Dot(normal, p1);

                List<int> inlierIndices = new List<int>();
                for (int i = 0; i < remainingIndices.Count; i++)
                {
                    int idx = remainingIndices[i];
                    Vector3 p = points[idx];
                    float dist = Math.Abs(Vector3.Dot(normal, p) + distance);

                    if (dist < distanceThreshold)
                    {
                        inlierIndices.Add(idx);
                    }
                }

                if (inlierIndices.Count > bestInlierCount)
                {
                    bestInlierCount = inlierIndices.Count;
                    bestNormal = normal;
                    bestDistance = distance;
                    bestInlierIndices = inlierIndices;
                }

                if (bestInlierCount > remainingIndices.Count * 0.5)
                    break;
            }

            if (bestInlierCount < minInliers)
                return null;

            RefinePlane(points, bestInlierIndices, ref bestNormal, ref bestDistance);

            Vector3[] inlierPoints = new Vector3[bestInlierIndices.Count];
            for (int i = 0; i < bestInlierIndices.Count; i++)
            {
                inlierPoints[i] = points[bestInlierIndices[i]];
            }

            Bounds bounds = CalculateBounds(inlierPoints, bestNormal);

            for (int i = remainingIndices.Count - 1; i >= 0; i--)
            {
                if (bestInlierIndices.Contains(remainingIndices[i]))
                {
                    remainingIndices.RemoveAt(i);
                }
            }

            return new DetectedWall
            {
                Normal = bestNormal,
                Distance = bestDistance,
                InlierPoints = inlierPoints,
                Bounds = bounds,
                Center = bounds.center,
                Size = bounds.size,
                Plane = new Plane(bestNormal, -bestDistance)
            };
        }

        private void RefinePlane(Vector3[] points, List<int> inlierIndices, ref Vector3 normal, ref float distance)
        {
            Vector3 centroid = Vector3.zero;
            foreach (int idx in inlierIndices)
            {
                centroid += points[idx];
            }
            centroid /= inlierIndices.Count;

            double xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
            foreach (int idx in inlierIndices)
            {
                Vector3 p = points[idx] - centroid;
                xx += p.x * p.x;
                xy += p.x * p.y;
                xz += p.x * p.z;
                yy += p.y * p.y;
                yz += p.y * p.z;
                zz += p.z * p.z;
            }

            double[,] cov = { { xx, xy, xz }, { xy, yy, yz }, { xz, yz, zz } };

            double[] eigenvalues;
            double[,] eigenvectors;
            EigenDecomposition(cov, out eigenvalues, out eigenvectors);

            int minIndex = 0;
            double minEigenvalue = eigenvalues[0];
            for (int i = 1; i < 3; i++)
            {
                if (eigenvalues[i] < minEigenvalue)
                {
                    minEigenvalue = eigenvalues[i];
                    minIndex = i;
                }
            }

            Vector3 newNormal = new Vector3(
                (float)eigenvectors[0, minIndex],
                (float)eigenvectors[1, minIndex],
                (float)eigenvectors[2, minIndex]
            ).normalized;

            if (Vector3.Dot(newNormal, normal) < 0)
            {
                newNormal = -newNormal;
            }

            normal = newNormal;
            distance = -Vector3.Dot(normal, centroid);
        }

        private void EigenDecomposition(double[,] matrix, out double[] eigenvalues, out double[,] eigenvectors)
        {
            int n = 3;
            eigenvalues = new double[n];
            eigenvectors = (double[,])matrix.Clone();

            for (int p = 0; p < n - 1; p++)
            {
                for (int q = p + 1; q < n; q++)
                {
                    double theta = (eigenvalues[q] - eigenvalues[p]) / (2 * eigenvectors[p, q]);
                    double t = 1 / (Math.Abs(theta) + Math.Sqrt(theta * theta + 1));
                    if (theta < 0) t = -t;

                    double c = 1 / Math.Sqrt(1 + t * t);
                    double s = t * c;

                    double tau = s / (1 + c);
                    double a_pq = eigenvectors[p, q];

                    eigenvalues[p] -= t * a_pq;
                    eigenvalues[q] += t * a_pq;

                    eigenvectors[p, q] = 0;

                    for (int i = 0; i < p; i++)
                    {
                        double a_ip = eigenvectors[i, p];
                        double a_iq = eigenvectors[i, q];
                        eigenvectors[i, p] = a_ip - s * (a_iq + tau * a_ip);
                        eigenvectors[i, q] = a_iq + s * (a_ip - tau * a_iq);
                    }

                    for (int i = p + 1; i < q; i++)
                    {
                        double a_pi = eigenvectors[p, i];
                        double a_iq = eigenvectors[i, q];
                        eigenvectors[p, i] = a_pi - s * (a_iq + tau * a_pi);
                        eigenvectors[i, q] = a_iq + s * (a_pi - tau * a_iq);
                    }

                    for (int i = q + 1; i < n; i++)
                    {
                        double a_pi = eigenvectors[p, i];
                        double a_qi = eigenvectors[q, i];
                        eigenvectors[p, i] = a_pi - s * (a_qi + tau * a_pi);
                        eigenvectors[q, i] = a_qi + s * (a_pi - tau * a_qi);
                    }

                    for (int i = 0; i < n; i++)
                    {
                        double v_ip = eigenvectors[i, p];
                        double v_iq = eigenvectors[i, q];
                        eigenvectors[i, p] = v_ip - s * (v_iq + tau * v_ip);
                        eigenvectors[i, q] = v_iq + s * (v_ip - tau * v_iq);
                    }
                }
            }

            for (int i = 0; i < n; i++)
            {
                eigenvalues[i] = matrix[i, i];
            }
        }

        private Bounds CalculateBounds(Vector3[] points, Vector3 normal)
        {
            Vector3 up = Vector3.up;
            Vector3 right = Vector3.Cross(normal, up).normalized;
            if (right.magnitude < 0.1f)
            {
                right = Vector3.right;
            }
            Vector3 forward = Vector3.Cross(right, normal).normalized;

            float minY = float.MaxValue, maxY = float.MinValue;
            float minR = float.MaxValue, maxR = float.MinValue;
            float minF = float.MaxValue, maxF = float.MinValue;

            foreach (var p in points)
            {
                float y = Vector3.Dot(p, up);
                float r = Vector3.Dot(p, right);
                float f = Vector3.Dot(p, forward);

                minY = Mathf.Min(minY, y);
                maxY = Mathf.Max(maxY, y);
                minR = Mathf.Min(minR, r);
                maxR = Mathf.Max(maxR, r);
                minF = Mathf.Min(minF, f);
                maxF = Mathf.Max(maxF, f);
            }

            Vector3 center = (minY + maxY) / 2 * up +
                            (minR + maxR) / 2 * right +
                            (minF + maxF) / 2 * forward;

            Vector3 size = new Vector3(
                maxR - minR,
                maxY - minY,
                maxF - minF
            );

            return new Bounds(center, size);
        }

        private bool IsValidWall(DetectedWall wall)
        {
            float height = wall.Size.y;
            if (height < wallHeightMin || height > wallHeightMax)
                return false;

            float area = wall.Size.x * wall.Size.y;
            if (area < 1f)
                return false;

            return true;
        }

        private void MergeOverlappingWalls()
        {
            for (int i = 0; i < detectedWalls.Count; i++)
            {
                for (int j = i + 1; j < detectedWalls.Count; j++)
                {
                    if (AreWallsOverlapping(detectedWalls[i], detectedWalls[j]))
                    {
                        detectedWalls[i] = MergeWalls(detectedWalls[i], detectedWalls[j]);
                        if (detectedWalls[j].Visualizer != null)
                        {
                            Destroy(detectedWalls[j].Visualizer);
                        }
                        detectedWalls.RemoveAt(j);
                        j--;
                    }
                }
            }
        }

        private bool AreWallsOverlapping(DetectedWall a, DetectedWall b)
        {
            float normalDot = Vector3.Dot(a.Normal, b.Normal);
            if (Mathf.Abs(normalDot) < normalTolerance)
                return false;

            float distanceBetweenPlanes = Math.Abs(a.Distance - b.Distance);
            if (distanceBetweenPlanes > distanceThreshold * 5)
                return false;

            return a.Bounds.Intersects(b.Bounds);
        }

        private DetectedWall MergeWalls(DetectedWall a, DetectedWall b)
        {
            List<Vector3> mergedPoints = new List<Vector3>(a.InlierPoints);
            mergedPoints.AddRange(b.InlierPoints);

            Vector3 normal = (a.Normal + b.Normal).normalized;
            float distance = (a.Distance + b.Distance) / 2;

            Vector3[] inlierPoints = mergedPoints.ToArray();
            Bounds bounds = CalculateBounds(inlierPoints, normal);

            return new DetectedWall
            {
                Normal = normal,
                Distance = distance,
                InlierPoints = inlierPoints,
                Bounds = bounds,
                Center = bounds.center,
                Size = bounds.size,
                Plane = new Plane(normal, -distance)
            };
        }

        private void CreateWallVisualizer(DetectedWall wall)
        {
            GameObject wallObj = new GameObject($"Wall_{detectedWalls.Count}");
            wallObj.transform.SetParent(transform);
            wallObj.transform.position = wall.Center;

            MeshRenderer renderer = wallObj.AddComponent<MeshRenderer>();
            MeshFilter filter = wallObj.AddComponent<MeshFilter>();

            Mesh mesh = new Mesh();
            Vector3 up = Vector3.up;
            Vector3 right = Vector3.Cross(wall.Normal, up).normalized;
            Vector3 forward = Vector3.Cross(right, wall.Normal).normalized;

            Vector3 halfSize = wall.Size * 0.5f;

            Vector3[] vertices = new Vector3[4];
            vertices[0] = -right * halfSize.x - up * halfSize.y - forward * halfSize.z;
            vertices[1] = right * halfSize.x - up * halfSize.y - forward * halfSize.z;
            vertices[2] = right * halfSize.x + up * halfSize.y - forward * halfSize.z;
            vertices[3] = -right * halfSize.x + up * halfSize.y - forward * halfSize.z;

            int[] triangles = new int[] { 0, 2, 1, 0, 3, 2 };

            mesh.vertices = vertices;
            mesh.triangles = triangles;
            mesh.RecalculateNormals();

            filter.mesh = mesh;

            Material material = new Material(Shader.Find("Universal Render Pipeline/Lit"));
            material.color = new Color(0.8f, 0.8f, 0.9f, 0.3f);
            material.SetFloat("_Alpha", 0.3f);
            renderer.material = material;

            MeshCollider collider = wallObj.AddComponent<MeshCollider>();
            collider.sharedMesh = mesh;

            wall.Visualizer = wallObj;
        }

        public void ClearDetectedWalls()
        {
            foreach (var wall in detectedWalls)
            {
                if (wall.Visualizer != null)
                {
                    Destroy(wall.Visualizer);
                }
            }
            detectedWalls.Clear();
        }

        public DetectedWall FindNearestWall(Vector3 point, out float distance)
        {
            DetectedWall nearest = null;
            float minDist = float.MaxValue;

            foreach (var wall in detectedWalls)
            {
                float d = wall.Plane.GetDistanceToPoint(point);
                if (d < minDist)
                {
                    minDist = d;
                    nearest = wall;
                }
            }

            distance = minDist;
            return nearest;
        }

        public DetectedWall RaycastWall(Ray ray, out RaycastHit hit, float maxDistance = 100f)
        {
            hit = new RaycastHit();
            float bestDist = float.MaxValue;
            DetectedWall bestWall = null;

            foreach (var wall in detectedWalls)
            {
                float enter;
                if (wall.Plane.Raycast(ray, out enter) && enter < maxDistance)
                {
                    Vector3 hitPoint = ray.GetPoint(enter);
                    if (IsPointInWallBounds(hitPoint, wall) && enter < bestDist)
                    {
                        bestDist = enter;
                        bestWall = wall;
                        hit.point = hitPoint;
                        hit.normal = wall.Normal;
                    }
                }
            }

            return bestWall;
        }

        private bool IsPointInWallBounds(Vector3 point, DetectedWall wall)
        {
            Vector3 local = point - wall.Center;
            Vector3 right = Vector3.Cross(wall.Normal, Vector3.up).normalized;
            Vector3 up = Vector3.up;

            float x = Vector3.Dot(local, right);
            float y = Vector3.Dot(local, up);

            return Mathf.Abs(x) <= wall.Size.x * 0.5f &&
                   Mathf.Abs(y) <= wall.Size.y * 0.5f;
        }

        public Vector3 CalculateWallAlignedRotation(Vector3 wallNormal)
        {
            Vector3 forward = -wallNormal;
            Vector3 right = Vector3.Cross(Vector3.up, forward).normalized;

            if (right.magnitude < 0.1f)
            {
                right = Vector3.right;
            }

            Quaternion rotation = Quaternion.LookRotation(forward, Vector3.up);
            return rotation.eulerAngles;
        }

        private void OnDestroy()
        {
            ClearDetectedWalls();
        }
    }
}
