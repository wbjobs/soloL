using System.Collections.Generic;
using System.IO;
using UnityEngine;
using LiDARFurniturePlacer.Core;
using LiDARFurniturePlacer.Floor;

namespace LiDARFurniturePlacer.PointCloud
{
    public class PointCloudManager : MonoBehaviour
    {
        [SerializeField] private PointCloudRenderer pointCloudRendererPrefab;
        [SerializeField] private Material pointCloudMaterial;

        private PointCloudRenderer activePointCloud;
        private PointCloudData activeData;
        private Dictionary<int, PointCloudRenderer> floorPointCloudRenderers = new Dictionary<int, PointCloudRenderer>();

        public PointCloudRenderer ActivePointCloud => activePointCloud;
        public PointCloudData ActiveData => activeData;
        public IReadOnlyDictionary<int, PointCloudRenderer> FloorRenderers => floorPointCloudRenderers;

        public bool LoadPointCloud(string filePath)
        {
            if (!File.Exists(filePath))
            {
                Debug.LogError($"File not found: {filePath}");
                return false;
            }

            string extension = Path.GetExtension(filePath).ToLower();
            PointCloudData data = null;

            switch (extension)
            {
                case ".ply":
                    PLYLoader plyLoader = new PLYLoader();
                    data = plyLoader.Load(filePath);
                    break;
                default:
                    Debug.LogError($"Unsupported file format: {extension}");
                    return false;
            }

            if (data == null || data.PointCount == 0)
            {
                Debug.LogError("Failed to load point cloud data");
                return false;
            }

            activeData = data;
            CreatePointCloudRenderer(data);
            return true;
        }

        private void CreatePointCloudRenderer(PointCloudData data)
        {
            if (activePointCloud != null)
            {
                Destroy(activePointCloud.gameObject);
            }

            GameObject obj = new GameObject("PointCloud");
            obj.transform.SetParent(transform, false);

            activePointCloud = obj.AddComponent<PointCloudRenderer>();

            MeshRenderer meshRenderer = obj.GetComponent<MeshRenderer>();
            meshRenderer.material = pointCloudMaterial;

            activePointCloud.LoadPointCloud(data);

            Debug.Log($"Loaded point cloud with {data.PointCount} points");
        }

        public void CreateFloorRenderers(List<FloorData> floors)
        {
            ClearFloorRenderers();

            for (int i = 0; i < floors.Count; i++)
            {
                if (floors[i].PointCloud == null) continue;

                GameObject obj = new GameObject($"Floor_{floors[i].FloorIndex}_PointCloud");
                obj.transform.SetParent(transform, false);

                PointCloudRenderer renderer = obj.AddComponent<PointCloudRenderer>();
                MeshRenderer meshRenderer = obj.GetComponent<MeshRenderer>();
                meshRenderer.material = pointCloudMaterial;

                renderer.LoadPointCloud(floors[i].PointCloud);
                renderer.gameObject.SetActive(floors[i].IsVisible);

                floorPointCloudRenderers[floors[i].FloorIndex] = renderer;
            }
        }

        public void ShowFloor(int floorIndex)
        {
            if (floorPointCloudRenderers.TryGetValue(floorIndex, out PointCloudRenderer renderer))
            {
                renderer.gameObject.SetActive(true);
            }
        }

        public void HideFloor(int floorIndex)
        {
            if (floorPointCloudRenderers.TryGetValue(floorIndex, out PointCloudRenderer renderer))
            {
                renderer.gameObject.SetActive(false);
            }
        }

        public void ShowAllFloors()
        {
            foreach (var kvp in floorPointCloudRenderers)
            {
                kvp.Value.gameObject.SetActive(true);
            }
        }

        public void ApplySemanticLabels(SemanticLabel[] labels)
        {
            if (activeData == null || labels == null) return;

            activeData.EnsureSemanticLabels();
            for (int i = 0; i < activeData.PointCount; i++)
            {
                activeData.SemanticLabels[i] = labels[i];
            }

            if (activePointCloud != null)
            {
                activePointCloud.ColoringMode = PointCloudColoringMode.Semantic;
            }
        }

        public void SetFloorPointSize(int floorIndex, float size)
        {
            if (floorPointCloudRenderers.TryGetValue(floorIndex, out PointCloudRenderer renderer))
            {
                renderer.PointSize = size;
            }
        }

        public void SetFloorColoringMode(int floorIndex, PointCloudColoringMode mode)
        {
            if (floorPointCloudRenderers.TryGetValue(floorIndex, out PointCloudRenderer renderer))
            {
                renderer.ColoringMode = mode;
            }
        }

        public void SetAllFloorColoringMode(PointCloudColoringMode mode)
        {
            foreach (var kvp in floorPointCloudRenderers)
            {
                kvp.Value.ColoringMode = mode;
            }
        }

        public void ApplyTransformation(Matrix4x4 transform)
        {
            if (activePointCloud != null)
            {
                activePointCloud.ApplyTransform(transform);
            }
        }

        public void SetPointSize(float size)
        {
            if (activePointCloud != null)
            {
                activePointCloud.PointSize = size;
            }
        }

        public void SetColoringMode(PointCloudColoringMode mode)
        {
            if (activePointCloud != null)
            {
                activePointCloud.ColoringMode = mode;
            }
        }

        public Bounds GetPointCloudBounds()
        {
            if (activeData != null)
            {
                return activeData.GetBounds();
            }
            return new Bounds(Vector3.zero, Vector3.zero);
        }

        public PointCloudData ExtractSemanticRegion(SemanticLabel label)
        {
            if (activeData == null || !activeData.HasSemanticLabels) return null;

            List<int> indices = new List<int>();
            for (int i = 0; i < activeData.PointCount; i++)
            {
                if (activeData.SemanticLabels[i] == label)
                    indices.Add(i);
            }

            if (indices.Count == 0) return null;
            return activeData.ExtractSubset(indices.ToArray());
        }

        private void ClearFloorRenderers()
        {
            foreach (var kvp in floorPointCloudRenderers)
            {
                if (kvp.Value != null)
                {
                    Destroy(kvp.Value.gameObject);
                }
            }
            floorPointCloudRenderers.Clear();
        }

        public void ClearPointCloud()
        {
            if (activePointCloud != null)
            {
                Destroy(activePointCloud.gameObject);
                activePointCloud = null;
            }
            activeData = null;
            ClearFloorRenderers();
        }
    }
}
