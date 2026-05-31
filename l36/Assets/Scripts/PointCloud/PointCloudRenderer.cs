using UnityEngine;
using LiDARFurniturePlacer.Core;

namespace LiDARFurniturePlacer.PointCloud
{
    [RequireComponent(typeof(MeshFilter), typeof(MeshRenderer))]
    public class PointCloudRenderer : MonoBehaviour
    {
        [SerializeField] private Material pointCloudMaterial;
        [SerializeField] private float pointSize = 0.02f;
        [SerializeField] private PointCloudColoringMode coloringMode = PointCloudColoringMode.Original;

        private Mesh pointCloudMesh;
        private PointCloudData currentData;
        private MeshFilter meshFilter;
        private MeshRenderer meshRenderer;
        private MaterialPropertyBlock propertyBlock;

        public float PointSize
        {
            get => pointSize;
            set
            {
                pointSize = value;
                UpdatePointSize();
            }
        }

        public PointCloudColoringMode ColoringMode
        {
            get => coloringMode;
            set
            {
                coloringMode = value;
                UpdateColoring();
            }
        }

        public PointCloudData Data => currentData;

        private void Awake()
        {
            meshFilter = GetComponent<MeshFilter>();
            meshRenderer = GetComponent<MeshRenderer>();
            propertyBlock = new MaterialPropertyBlock();
        }

        public void LoadPointCloud(PointCloudData data)
        {
            currentData = data;
            CreateMesh(data);
            UpdatePointSize();
            UpdateColoring();
        }

        private void CreateMesh(PointCloudData data)
        {
            if (pointCloudMesh == null)
            {
                pointCloudMesh = new Mesh();
                pointCloudMesh.indexFormat = UnityEngine.Rendering.IndexFormat.UInt32;
            }
            else
            {
                pointCloudMesh.Clear();
            }

            pointCloudMesh.vertices = data.Vertices;
            pointCloudMesh.colors = data.Colors;
            pointCloudMesh.SetIndices(data.Indices, MeshTopology.Points, 0);
            pointCloudMesh.RecalculateBounds();

            meshFilter.mesh = pointCloudMesh;

            if (TryGetComponent(out MeshCollider collider))
            {
                Destroy(collider);
            }

            MeshCollider meshCollider = gameObject.AddComponent<MeshCollider>();
            meshCollider.sharedMesh = pointCloudMesh;
            meshCollider.convex = false;
        }

        public void ApplyTransform(Matrix4x4 transform)
        {
            if (currentData == null) return;

            currentData.ApplyTransform(transform);
            CreateMesh(currentData);
        }

        private void UpdatePointSize()
        {
            if (propertyBlock == null)
                propertyBlock = new MaterialPropertyBlock();

            propertyBlock.SetFloat("_PointSize", pointSize);
            meshRenderer.SetPropertyBlock(propertyBlock);
        }

        private void UpdateColoring()
        {
            if (currentData == null) return;

            Color[] colors = new Color[currentData.PointCount];
            Bounds bounds = currentData.GetBounds();

            for (int i = 0; i < currentData.PointCount; i++)
            {
                switch (coloringMode)
                {
                    case PointCloudColoringMode.Original:
                        colors[i] = currentData.Colors[i];
                        break;
                    case PointCloudColoringMode.Height:
                        colors[i] = ColorExtensions.HeightGradient(
                            currentData.Vertices[i].y,
                            bounds.min.y,
                            bounds.max.y
                        );
                        break;
                    case PointCloudColoringMode.Normal:
                        colors[i] = Color.white;
                        break;
                    case PointCloudColoringMode.Semantic:
                        colors[i] = GetSemanticColor(i, bounds);
                        break;
                }
            }

            pointCloudMesh.colors = colors;
        }

        private Color GetSemanticColor(int index, Bounds bounds)
        {
            if (currentData.HasSemanticLabels)
            {
                return SemanticColors.GetColor(currentData.SemanticLabels[index]);
            }

            Vector3 point = currentData.Vertices[index];
            float heightRatio = Mathf.InverseLerp(bounds.min.y, bounds.max.y, point.y);

            if (heightRatio < 0.05f)
                return SemanticColors.Floor;
            else if (heightRatio > 0.95f)
                return SemanticColors.Ceiling;
            else
                return SemanticColors.Wall;
        }

        public void SetRenderMode(RenderMode mode)
        {
            if (meshRenderer == null) return;

            switch (mode)
            {
                case RenderMode.Realistic:
                    meshRenderer.material = pointCloudMaterial;
                    break;
                case RenderMode.Wireframe:
                    break;
            }
        }

        private void OnDestroy()
        {
            if (pointCloudMesh != null)
            {
                Destroy(pointCloudMesh);
            }
        }
    }
}
