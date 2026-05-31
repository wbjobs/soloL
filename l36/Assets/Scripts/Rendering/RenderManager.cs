using UnityEngine;
using LiDARFurniturePlacer.Core;
using LiDARFurniturePlacer.Furniture;
using LiDARFurniturePlacer.PointCloud;

namespace LiDARFurniturePlacer.Rendering
{
    public class RenderManager : MonoBehaviour
    {
        [SerializeField] private PointCloudManager pointCloudManager;
        [SerializeField] private FurnitureManager furnitureManager;
        [SerializeField] private Camera mainCamera;

        [SerializeField] private Material pointCloudMaterial;
        [SerializeField] private Material pointCloudWireframeMaterial;
        [SerializeField] private Material furnitureWireframeMaterial;

        [SerializeField] private RenderMode currentRenderMode = RenderMode.Realistic;
        [SerializeField] private PointCloudColoringMode coloringMode = PointCloudColoringMode.Original;

        [SerializeField] private float pointSize = 0.02f;
        [SerializeField] private float lineWidth = 0.01f;
        [SerializeField] private Color wireframeColor = Color.green;
        [SerializeField] private bool showFurnitureWireframe = true;
        [SerializeField] private bool showPointCloud = true;
        [SerializeField] private bool showWalls = true;
        [SerializeField] private bool showFurniture = true;

        public RenderMode CurrentRenderMode => currentRenderMode;
        public PointCloudColoringMode ColoringMode => coloringMode;

        public event System.Action<RenderMode> OnRenderModeChanged;
        public event System.Action<PointCloudColoringMode> OnColoringModeChanged;

        private void Awake()
        {
            if (mainCamera == null)
            {
                mainCamera = Camera.main;
            }
        }

        public void SetRenderMode(RenderMode mode)
        {
            if (currentRenderMode == mode) return;

            currentRenderMode = mode;

            UpdatePointCloudRenderMode();
            UpdateFurnitureRenderMode();
            UpdateCameraSettings();

            OnRenderModeChanged?.Invoke(mode);
        }

        public void SetColoringMode(PointCloudColoringMode mode)
        {
            if (coloringMode == mode) return;

            coloringMode = mode;
            pointCloudManager.SetColoringMode(mode);
            OnColoringModeChanged?.Invoke(mode);
        }

        public void SetPointSize(float size)
        {
            pointSize = Mathf.Clamp(size, 0.001f, 0.5f);
            pointCloudManager.SetPointSize(pointSize);
        }

        public void SetWireframeColor(Color color)
        {
            wireframeColor = color;
            if (pointCloudWireframeMaterial != null)
            {
                pointCloudWireframeMaterial.SetColor("_WireColor", color);
            }
            if (furnitureWireframeMaterial != null)
            {
                furnitureWireframeMaterial.SetColor("_WireColor", color);
            }
        }

        public void SetLineWidth(float width)
        {
            lineWidth = Mathf.Clamp(width, 0.001f, 0.1f);
            if (pointCloudWireframeMaterial != null)
            {
                pointCloudWireframeMaterial.SetFloat("_LineWidth", lineWidth);
            }
            if (furnitureWireframeMaterial != null)
            {
                furnitureWireframeMaterial.SetFloat("_LineWidth", lineWidth);
            }
        }

        public void TogglePointCloud(bool show)
        {
            showPointCloud = show;
            if (pointCloudManager.ActivePointCloud != null)
            {
                pointCloudManager.ActivePointCloud.GetComponent<Renderer>().enabled = show;
            }
        }

        public void ToggleWalls(bool show)
        {
            showWalls = show;
            WallDetector[] wallDetectors = FindObjectsOfType<WallDetector>();
            foreach (var detector in wallDetectors)
            {
                foreach (var wall in detector.DetectedWalls)
                {
                    if (wall.Visualizer != null)
                    {
                        Renderer renderer = wall.Visualizer.GetComponent<Renderer>();
                        if (renderer != null)
                        {
                            renderer.enabled = show;
                        }
                        Collider collider = wall.Visualizer.GetComponent<Collider>();
                        if (collider != null)
                        {
                            collider.enabled = show;
                        }
                    }
                }
            }
        }

        public void ToggleFurniture(bool show)
        {
            showFurniture = show;
            furnitureManager.SetAllRenderMode(show ? currentRenderMode : RenderMode.Realistic);

            foreach (var furniture in furnitureManager.PlacedFurniture)
            {
                if (furniture != null)
                {
                    Renderer[] renderers = furniture.GetComponentsInChildren<Renderer>();
                    foreach (var renderer in renderers)
                    {
                        renderer.enabled = show;
                    }
                }
            }

            if (furnitureManager.PreviewFurniture != null)
            {
                Renderer[] previewRenderers = furnitureManager.PreviewFurniture.GetComponentsInChildren<Renderer>();
                foreach (var renderer in previewRenderers)
                {
                    renderer.enabled = show;
                }
            }
        }

        private void UpdatePointCloudRenderMode()
        {
            if (pointCloudManager.ActivePointCloud == null) return;

            MeshRenderer renderer = pointCloudManager.ActivePointCloud.GetComponent<MeshRenderer>();

            switch (currentRenderMode)
            {
                case RenderMode.Realistic:
                    renderer.material = pointCloudMaterial;
                    break;
                case RenderMode.Wireframe:
                    renderer.material = pointCloudWireframeMaterial;
                    break;
            }

            UpdateMaterialProperties(renderer.material);
        }

        private void UpdateFurnitureRenderMode()
        {
            furnitureManager.SetAllRenderMode(currentRenderMode);
        }

        private void UpdateCameraSettings()
        {
            switch (currentRenderMode)
            {
                case RenderMode.Realistic:
                    mainCamera.clearFlags = CameraClearFlags.SolidColor;
                    mainCamera.backgroundColor = new Color(0.1f, 0.1f, 0.12f);
                    GL.wireframe = false;
                    break;
                case RenderMode.Wireframe:
                    mainCamera.clearFlags = CameraClearFlags.SolidColor;
                    mainCamera.backgroundColor = Color.black;
                    GL.wireframe = false;
                    break;
            }
        }

        private void UpdateMaterialProperties(Material material)
        {
            if (material == null) return;

            if (material.HasProperty("_PointSize"))
            {
                material.SetFloat("_PointSize", pointSize);
            }
            if (material.HasProperty("_WireColor"))
            {
                material.SetColor("_WireColor", wireframeColor);
            }
            if (material.HasProperty("_LineWidth"))
            {
                material.SetFloat("_LineWidth", lineWidth);
            }
        }

        public void CycleColoringMode()
        {
            int nextMode = ((int)coloringMode + 1) % System.Enum.GetValues(typeof(PointCloudColoringMode)).Length;
            SetColoringMode((PointCloudColoringMode)nextMode);
        }

        public void CycleRenderMode()
        {
            int nextMode = ((int)currentRenderMode + 1) % System.Enum.GetValues(typeof(RenderMode)).Length;
            SetRenderMode((RenderMode)nextMode);
        }

        public void ResetView()
        {
            if (pointCloudManager.ActiveData != null)
            {
                Bounds bounds = pointCloudManager.GetPointCloudBounds();
                Vector3 center = bounds.center;
                float maxExtent = Mathf.Max(bounds.extents.x, bounds.extents.y, bounds.extents.z);

                mainCamera.transform.position = center + Vector3.back * maxExtent * 2f + Vector3.up * maxExtent * 0.5f;
                mainCamera.transform.LookAt(center);
            }
        }

        public void SetBackgroundColor(Color color)
        {
            mainCamera.backgroundColor = color;
        }

        private void OnApplicationQuit()
        {
            GL.wireframe = false;
        }
    }
}
