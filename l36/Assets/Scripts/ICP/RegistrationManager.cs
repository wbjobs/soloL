using System;
using System.IO;
using UnityEngine;
using LiDARFurniturePlacer.Core;
using LiDARFurniturePlacer.Feature;
using LiDARFurniturePlacer.PointCloud;

namespace LiDARFurniturePlacer.ICP
{
    public class RegistrationManager : MonoBehaviour
    {
        public enum InitialEstimationMode
        {
            BoundingBox,
            FeatureBased,
            Manual
        }

        [SerializeField] private PointCloudManager pointCloudManager;
        [SerializeField] private bool autoDownsample = true;
        [SerializeField] private int maxPointsForRegistration = 50000;
        [SerializeField] private int icpIterations = 100;
        [SerializeField] private float convergenceThreshold = 0.0000001f;
        [SerializeField] private float maxCorrespondenceDistance = 1.0f;
        [SerializeField] private InitialEstimationMode initialEstimationMode = InitialEstimationMode.FeatureBased;
        [SerializeField] private int maxFeatureKeypoints = 3000;
        [SerializeField] private int maxRANSACIterations = 10000;
        [SerializeField] private float ransacInlierThreshold = 0.1f;
        [SerializeField] private bool useFeaturePipelineOnFallback = true;

        private PointCloudData cadData;
        private ICPRegistration icp;
        private FeatureRegistrationPipeline featurePipeline;
        private Matrix4x4 lastTransform = Matrix4x4.identity;
        private FeatureRegistrationPipeline.PipelineResult lastFeatureResult;

        public event Action<float> OnRegistrationProgress;
        public event Action<ICPRegistration.RegistrationResult> OnRegistrationComplete;
        public event Action<FeatureRegistrationPipeline.PipelineResult> OnFeatureRegistrationProgress;

        public PointCloudData CADData => cadData;
        public Matrix4x4 LastTransform => lastTransform;
        public InitialEstimationMode EstimationMode => initialEstimationMode;
        public FeatureRegistrationPipeline.PipelineResult LastFeatureResult => lastFeatureResult;

        private void Awake()
        {
            icp = new ICPRegistration
            {
                MaxIterations = icpIterations,
                ConvergenceThreshold = convergenceThreshold,
                MaxCorrespondenceDistance = maxCorrespondenceDistance
            };

            featurePipeline = new FeatureRegistrationPipeline
            {
                MaxKeypoints = maxFeatureKeypoints,
                RANSACInlierThreshold = ransacInlierThreshold
            };

            featurePipeline.OnProgress += (progress, message) =>
            {
                float mappedProgress = 0.05f + progress * 0.45f;
                OnRegistrationProgress?.Invoke(mappedProgress);
                OnFeatureRegistrationProgress?.Invoke(lastFeatureResult);
                Debug.Log($"[FeaturePipeline] {progress:P0} - {message}");
            };
        }

        public bool LoadCADModel(string filePath)
        {
            if (!File.Exists(filePath))
            {
                Debug.LogError($"CAD file not found: {filePath}");
                return false;
            }

            string extension = Path.GetExtension(filePath).ToLower();

            switch (extension)
            {
                case ".ply":
                    PLYLoader plyLoader = new PLYLoader();
                    cadData = plyLoader.Load(filePath);
                    break;
                case ".obj":
                    cadData = LoadOBJasPointCloud(filePath);
                    break;
                default:
                    Debug.LogError($"Unsupported CAD format: {extension}");
                    return false;
            }

            if (cadData == null || cadData.PointCount == 0)
            {
                Debug.LogError("Failed to load CAD data");
                return false;
            }

            Debug.Log($"Loaded CAD model with {cadData.PointCount} points");
            return true;
        }

        private PointCloudData LoadOBJasPointCloud(string filePath)
        {
            try
            {
                string[] lines = File.ReadAllLines(filePath);
                System.Collections.Generic.List<Vector3> vertices = new System.Collections.Generic.List<Vector3>();
                System.Collections.Generic.List<Color> colors = new System.Collections.Generic.List<Color>();

                foreach (string line in lines)
                {
                    if (line.StartsWith("v "))
                    {
                        string[] parts = line.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                        if (parts.Length >= 4)
                        {
                            float x = float.Parse(parts[1]);
                            float y = float.Parse(parts[2]);
                            float z = float.Parse(parts[3]);
                            vertices.Add(new Vector3(x, y, z));
                            colors.Add(Color.white);
                        }
                    }
                }

                PointCloudData data = new PointCloudData(vertices.Count);
                for (int i = 0; i < vertices.Count; i++)
                {
                    data.Vertices[i] = vertices[i];
                    data.Colors[i] = colors[i];
                }

                return data;
            }
            catch (Exception e)
            {
                Debug.LogError($"Failed to load OBJ: {e.Message}");
                return null;
            }
        }

        public ICPRegistration.RegistrationResult RegisterPointCloudToCAD()
        {
            if (pointCloudManager.ActiveData == null)
            {
                Debug.LogError("No point cloud loaded");
                return null;
            }

            if (cadData == null)
            {
                Debug.LogError("No CAD model loaded");
                return null;
            }

            Vector3[] sourcePoints = DownsamplePoints(pointCloudManager.ActiveData.Vertices, maxPointsForRegistration);
            Vector3[] targetPoints = DownsamplePoints(cadData.Vertices, maxPointsForRegistration);

            Matrix4x4 initialGuess;

            switch (initialEstimationMode)
            {
                case InitialEstimationMode.FeatureBased:
                    initialGuess = ComputeFeatureBasedInitialTransform(sourcePoints, targetPoints);
                    break;
                case InitialEstimationMode.Manual:
                    initialGuess = lastTransform;
                    break;
                default:
                    initialGuess = ComputeInitialTransform(pointCloudManager.ActiveData, cadData);
                    break;
            }

            OnRegistrationProgress?.Invoke(0.55f);

            ICPRegistration.RegistrationResult result = icp.Register(sourcePoints, targetPoints, initialGuess);

            OnRegistrationProgress?.Invoke(0.95f);

            if (result.Converged)
            {
                lastTransform = result.Transform;
                pointCloudManager.ApplyTransformation(result.Transform);

                Debug.Log($"ICP converged after {result.Iterations} iterations. Fitness: {result.Fitness:F6}");
            }
            else
            {
                Debug.LogWarning($"ICP did not converge. Fitness: {result.Fitness:F6}");

                if (useFeaturePipelineOnFallback && initialEstimationMode != InitialEstimationMode.FeatureBased)
                {
                    Debug.Log("Attempting feature-based fallback initialization...");
                    Matrix4x4 featureGuess = ComputeFeatureBasedInitialTransform(sourcePoints, targetPoints);
                    ICPRegistration.RegistrationResult fallbackResult = icp.Register(sourcePoints, targetPoints, featureGuess);

                    if (fallbackResult.Converged && fallbackResult.Fitness < result.Fitness)
                    {
                        result = fallbackResult;
                        lastTransform = result.Transform;
                        pointCloudManager.ApplyTransformation(result.Transform);
                        Debug.Log($"Feature-based fallback succeeded! Fitness: {result.Fitness:F6}");
                    }
                }
            }

            OnRegistrationProgress?.Invoke(1.0f);
            OnRegistrationComplete?.Invoke(result);

            return result;
        }

        private Matrix4x4 ComputeFeatureBasedInitialTransform(Vector3[] sourcePoints, Vector3[] targetPoints)
        {
            Debug.Log("Running feature-based initial estimation (ISS + SIFT + RANSAC)...");

            Matrix4x4 fallbackGuess = ComputeInitialTransform(pointCloudManager.ActiveData, cadData);

            featurePipeline.MaxKeypoints = maxFeatureKeypoints;
            featurePipeline.RANSACInlierThreshold = ransacInlierThreshold;

            lastFeatureResult = featurePipeline.Run(sourcePoints, targetPoints, fallbackGuess);

            if (lastFeatureResult.Success)
            {
                Debug.Log($"Feature-based initial estimate successful: {lastFeatureResult.Message}");
                return lastFeatureResult.InitialTransform;
            }
            else
            {
                Debug.LogWarning($"Feature-based initial estimate failed: {lastFeatureResult.Message}. Using bounding box fallback.");
                return fallbackGuess;
            }
        }

        private Vector3[] DownsamplePoints(Vector3[] points, int maxCount)
        {
            if (!autoDownsample || points.Length <= maxCount)
                return points;

            float step = (float)points.Length / maxCount;
            Vector3[] result = new Vector3[maxCount];

            for (int i = 0; i < maxCount; i++)
            {
                int index = (int)(i * step);
                result[i] = points[Mathf.Min(index, points.Length - 1)];
            }

            return result;
        }

        private Matrix4x4 ComputeInitialTransform(PointCloudData source, PointCloudData target)
        {
            Bounds sourceBounds = source.GetBounds();
            Bounds targetBounds = target.GetBounds();

            Vector3 sourceCenter = sourceBounds.center;
            Vector3 targetCenter = targetBounds.center;

            Vector3 sourceSize = sourceBounds.size;
            Vector3 targetSize = targetBounds.size;

            float scaleFactor = Mathf.Min(
                targetSize.x / Mathf.Max(sourceSize.x, 0.001f),
                targetSize.y / Mathf.Max(sourceSize.y, 0.001f),
                targetSize.z / Mathf.Max(sourceSize.z, 0.001f)
            );

            Vector3 translation = targetCenter - sourceCenter * scaleFactor;

            Matrix4x4 scale = Matrix4x4.Scale(Vector3.one * scaleFactor);
            Matrix4x4 translate = Matrix4x4.Translate(translation);

            return translate * scale;
        }

        public void SetICPParameters(int iterations, float convergence, float maxDistance)
        {
            icpIterations = iterations;
            convergenceThreshold = convergence;
            maxCorrespondenceDistance = maxDistance;

            if (icp != null)
            {
                icp.MaxIterations = iterations;
                icp.ConvergenceThreshold = convergence;
                icp.MaxCorrespondenceDistance = maxDistance;
            }
        }

        public void SetFeatureParameters(int keypoints, int ransacIter, float ransacThreshold)
        {
            maxFeatureKeypoints = keypoints;
            maxRANSACIterations = ransacIter;
            ransacInlierThreshold = ransacThreshold;

            if (featurePipeline != null)
            {
                featurePipeline.MaxKeypoints = keypoints;
                featurePipeline.RANSACInlierThreshold = ransacThreshold;
            }
        }

        public void SetEstimationMode(InitialEstimationMode mode)
        {
            initialEstimationMode = mode;
        }

        public void ResetTransform()
        {
            if (lastTransform != Matrix4x4.identity)
            {
                Matrix4x4 inverse = lastTransform.inverse;
                pointCloudManager.ApplyTransformation(inverse);
                lastTransform = Matrix4x4.identity;
            }
        }

        public void ApplyManualTransform(Vector3 translation, Vector3 rotation, float scale)
        {
            Matrix4x4 t = Matrix4x4.Translate(translation);
            Matrix4x4 r = Matrix4x4.Rotate(Quaternion.Euler(rotation));
            Matrix4x4 s = Matrix4x4.Scale(Vector3.one * scale);

            Matrix4x4 transform = t * r * s;
            pointCloudManager.ApplyTransformation(transform);
            lastTransform = transform * lastTransform;
        }
    }
}
