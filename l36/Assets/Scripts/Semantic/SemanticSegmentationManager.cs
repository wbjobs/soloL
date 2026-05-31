using System;
using System.Collections.Generic;
using UnityEngine;
using LiDARFurniturePlacer.Core;

namespace LiDARFurniturePlacer.Semantic
{
    public class SemanticSegmentationManager : MonoBehaviour
    {
        [SerializeField] private ComputeShader pointNetShader;
        [SerializeField] private bool useGPUInference = true;
        [SerializeField] private float confidenceThreshold = 0.3f;
        [SerializeField] private bool enablePostProcessing = true;
        [SerializeField] private int postProcessKNN = 20;
        [SerializeField] private float postProcessRadius = 0.5f;

        private PointNetPlusPlusInference inferenceEngine;
        private PointCloudData currentData;
        private SemanticLabel[] currentLabels;
        private bool isSegmented;

        public bool IsSegmented => isSegmented;
        public SemanticLabel[] CurrentLabels => currentLabels;
        public PointCloudData CurrentData => currentData;

        public event Action<SemanticLabel[]> OnSegmentationComplete;
        public event Action<float> OnSegmentationProgress;
        public event Action<Dictionary<SemanticLabel, int>> OnStatisticsUpdated;

        private void Awake()
        {
            InitializeEngine();
        }

        private void InitializeEngine()
        {
            if (useGPUInference && pointNetShader != null)
            {
                inferenceEngine = new PointNetPlusPlusInference(pointNetShader);
                if (!inferenceEngine.IsInitialized)
                {
                    Debug.LogWarning("GPU inference failed to initialize, using geometry-based fallback");
                    useGPUInference = false;
                }
            }
            else
            {
                useGPUInference = false;
            }
        }

        public SemanticLabel[] SegmentPointCloud(PointCloudData pointCloud)
        {
            if (pointCloud == null || pointCloud.PointCount == 0)
            {
                Debug.LogError("Cannot segment null or empty point cloud");
                return null;
            }

            currentData = pointCloud;
            OnSegmentationProgress?.Invoke(0f);

            SemanticLabel[] labels;

            if (useGPUInference && inferenceEngine != null && inferenceEngine.IsInitialized)
            {
                inferenceEngine.OnProgress += HandleProgress;
                labels = inferenceEngine.RunInference(pointCloud);
                inferenceEngine.OnProgress -= HandleProgress;
            }
            else
            {
                OnSegmentationProgress?.Invoke(0.2f);
                PointNetPlusPlusInference fallbackEngine = new PointNetPlusPlusInference(null);
                labels = fallbackEngine.RunGeometryBasedFallback(pointCloud);
                fallbackEngine.Dispose();
            }

            if (labels == null)
            {
                Debug.LogError("Segmentation failed");
                return null;
            }

            OnSegmentationProgress?.Invoke(0.8f);

            if (enablePostProcessing)
            {
                labels = PostProcessLabels(pointCloud, labels);
            }

            currentLabels = labels;
            pointCloud.EnsureSemanticLabels();
            for (int i = 0; i < labels.Length; i++)
            {
                pointCloud.SemanticLabels[i] = labels[i];
            }

            isSegmented = true;

            Dictionary<SemanticLabel, int> stats = pointCloud.GetSemanticStatistics();
            OnStatisticsUpdated?.Invoke(stats);
            OnSegmentationComplete?.Invoke(labels);
            OnSegmentationProgress?.Invoke(1f);

            return labels;
        }

        private SemanticLabel[] PostProcessLabels(PointCloudData pointCloud, SemanticLabel[] labels)
        {
            int n = labels.Length;
            SemanticLabel[] processed = (SemanticLabel[])labels.Clone();
            Vector3[] points = pointCloud.Vertices;

            SemanticLabel[] tempLabels = new SemanticLabel[n];

            for (int i = 0; i < n; i++)
            {
                Dictionary<SemanticLabel, int> neighborLabels = new Dictionary<SemanticLabel, int>();
                int totalNeighbors = 0;

                Vector3 p = points[i];
                float r2 = postProcessRadius * postProcessRadius;

                int startJ = Mathf.Max(0, i - postProcessKNN * 10);
                int endJ = Mathf.Min(n, i + postProcessKNN * 10);

                for (int j = startJ; j < endJ; j++)
                {
                    if (j == i) continue;
                    float dx = points[j].x - p.x;
                    if (dx * dx > r2) continue;
                    float dy = points[j].y - p.y;
                    if (dy * dy > r2) continue;
                    float dz = points[j].z - p.z;
                    if (dz * dz > r2) continue;

                    float d2 = dx * dx + dy * dy + dz * dz;
                    if (d2 <= r2)
                    {
                        SemanticLabel nl = labels[j];
                        if (neighborLabels.ContainsKey(nl))
                            neighborLabels[nl]++;
                        else
                            neighborLabels[nl] = 1;
                        totalNeighbors++;

                        if (totalNeighbors >= postProcessKNN) break;
                    }
                }

                if (totalNeighbors == 0)
                {
                    tempLabels[i] = labels[i];
                    continue;
                }

                SemanticLabel majorityLabel = labels[i];
                int majorityCount = 0;
                foreach (var kvp in neighborLabels)
                {
                    if (kvp.Value > majorityCount)
                    {
                        majorityCount = kvp.Value;
                        majorityLabel = kvp.Key;
                    }
                }

                if (majorityCount > totalNeighbors * 0.5f)
                {
                    tempLabels[i] = majorityLabel;
                }
                else
                {
                    tempLabels[i] = labels[i];
                }
            }

            return tempLabels;
        }

        public List<int> GetPointsByLabel(SemanticLabel label)
        {
            if (currentLabels == null || currentData == null) return new List<int>();

            List<int> indices = new List<int>();
            for (int i = 0; i < currentLabels.Length; i++)
            {
                if (currentLabels[i] == label)
                    indices.Add(i);
            }
            return indices;
        }

        public PointCloudData ExtractSemanticRegion(SemanticLabel label)
        {
            if (!isSegmented || currentData == null) return null;

            List<int> indices = GetPointsByLabel(label);
            if (indices.Count == 0) return null;

            return currentData.ExtractSubset(indices.ToArray());
        }

        public Dictionary<SemanticLabel, int> GetStatistics()
        {
            if (currentData == null) return new Dictionary<SemanticLabel, int>();
            return currentData.GetSemanticStatistics();
        }

        public Color[] GetSemanticColors()
        {
            if (!isSegmented || currentData == null || currentLabels == null) return null;

            Color[] colors = new Color[currentData.PointCount];
            for (int i = 0; i < currentData.PointCount; i++)
            {
                colors[i] = SemanticColors.GetColor(currentLabels[i]);
            }
            return colors;
        }

        public void SetConfidenceThreshold(float threshold)
        {
            confidenceThreshold = Mathf.Clamp01(threshold);
        }

        public void SetUseGPU(bool useGPU)
        {
            useGPUInference = useGPU;
            if (useGPU && inferenceEngine == null)
            {
                InitializeEngine();
            }
        }

        private void HandleProgress(float progress)
        {
            OnSegmentationProgress?.Invoke(progress);
        }

        public void ClearSegmentation()
        {
            currentLabels = null;
            isSegmented = false;
            inferenceEngine?.Dispose();
            inferenceEngine = null;
            if (useGPUInference && pointNetShader != null)
            {
                InitializeEngine();
            }
        }

        private void OnDestroy()
        {
            inferenceEngine?.Dispose();
        }
    }
}
