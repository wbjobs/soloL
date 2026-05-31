using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;
using LiDARFurniturePlacer.Core;
using LiDARFurniturePlacer.Furniture;
using LiDARFurniturePlacer.PointCloud;

namespace LiDARFurniturePlacer.Export
{
    public class ExportManager : MonoBehaviour
    {
        [SerializeField] private FurnitureManager furnitureManager;
        [SerializeField] private PointCloudManager pointCloudManager;
        [SerializeField] private Camera mainCamera;

        private PDFExporter pdfExporter;

        public event Action<string> OnExportComplete;
        public event Action<string> OnExportFailed;

        private void Awake()
        {
            pdfExporter = new PDFExporter();
            if (mainCamera == null)
            {
                mainCamera = Camera.main;
            }
        }

        public bool ExportFurnitureLayoutPDF(string outputPath)
        {
            try
            {
                List<FurnitureData> furnitureList = furnitureManager.GetFurnitureDataList();
                Bounds roomBounds = pointCloudManager.GetPointCloudBounds();

                if (furnitureList.Count == 0)
                {
                    Debug.LogWarning("No furniture to export");
                }

                string title = $"Furniture Layout - {DateTime.Now:yyyy-MM-dd}";
                bool success = pdfExporter.ExportFurnitureLayout(outputPath, furnitureList, roomBounds, title);

                if (success)
                {
                    OnExportComplete?.Invoke(outputPath);
                    Debug.Log($"Layout exported to: {outputPath}");
                }
                else
                {
                    OnExportFailed?.Invoke("Failed to generate PDF");
                }

                return success;
            }
            catch (Exception e)
            {
                OnExportFailed?.Invoke(e.Message);
                Debug.LogError($"Export failed: {e.Message}");
                return false;
            }
        }

        public bool ExportScreenshotPDF(string outputPath)
        {
            try
            {
                Texture2D screenshot = CaptureScreenshot();
                if (screenshot == null)
                {
                    OnExportFailed?.Invoke("Failed to capture screenshot");
                    return false;
                }

                List<FurnitureData> furnitureList = furnitureManager.GetFurnitureDataList();
                bool success = pdfExporter.ExportScreenshotWithLayout(outputPath, screenshot, furnitureList);

                Destroy(screenshot);

                if (success)
                {
                    OnExportComplete?.Invoke(outputPath);
                    Debug.Log($"Screenshot PDF exported to: {outputPath}");
                }
                else
                {
                    OnExportFailed?.Invoke("Failed to generate screenshot PDF");
                }

                return success;
            }
            catch (Exception e)
            {
                OnExportFailed?.Invoke(e.Message);
                Debug.LogError($"Screenshot export failed: {e.Message}");
                return false;
            }
        }

        public bool ExportFurnitureDataJSON(string outputPath)
        {
            try
            {
                List<FurnitureData> furnitureList = furnitureManager.GetFurnitureDataList();

                FurnitureLayout layout = new FurnitureLayout
                {
                    ExportTime = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
                    FurnitureCount = furnitureList.Count,
                    Furniture = furnitureList,
                    RoomBounds = new BoundsData(pointCloudManager.GetPointCloudBounds())
                };

                string json = JsonUtility.ToJson(layout, true);
                File.WriteAllText(outputPath, json);

                OnExportComplete?.Invoke(outputPath);
                Debug.Log($"Furniture data exported to: {outputPath}");
                return true;
            }
            catch (Exception e)
            {
                OnExportFailed?.Invoke(e.Message);
                Debug.LogError($"JSON export failed: {e.Message}");
                return false;
            }
        }

        public bool ImportFurnitureDataJSON(string inputPath)
        {
            try
            {
                if (!File.Exists(inputPath))
                {
                    OnExportFailed?.Invoke("File not found");
                    return false;
                }

                string json = File.ReadAllText(inputPath);
                FurnitureLayout layout = JsonUtility.FromJson<FurnitureLayout>(json);

                furnitureManager.ClearAllFurniture();

                PlacementController placementController = FindObjectOfType<PlacementController>();

                foreach (var furnitureData in layout.Furniture)
                {
                    if (placementController != null && !string.IsNullOrEmpty(furnitureData.ModelPath))
                    {
                        if (File.Exists(furnitureData.ModelPath))
                        {
                            placementController.StartPlacingMode(furnitureData.ModelPath);
                            furnitureManager.PlaceFurniture(
                                furnitureData.Position,
                                furnitureData.Rotation,
                                furnitureData.Scale
                            );
                        }
                    }
                }

                OnExportComplete?.Invoke(inputPath);
                Debug.Log($"Furniture data imported from: {inputPath}");
                return true;
            }
            catch (Exception e)
            {
                OnExportFailed?.Invoke(e.Message);
                Debug.LogError($"JSON import failed: {e.Message}");
                return false;
            }
        }

        public Texture2D CaptureScreenshot()
        {
            try
            {
                RenderTexture renderTexture = new RenderTexture(Screen.width, Screen.height, 24);
                mainCamera.targetTexture = renderTexture;
                mainCamera.Render();

                Texture2D screenshot = new Texture2D(Screen.width, Screen.height, TextureFormat.RGB24, false);
                RenderTexture.active = renderTexture;
                screenshot.ReadPixels(new Rect(0, 0, Screen.width, Screen.height), 0, 0);
                screenshot.Apply();

                mainCamera.targetTexture = null;
                RenderTexture.active = null;
                Destroy(renderTexture);

                return screenshot;
            }
            catch (Exception e)
            {
                Debug.LogError($"Failed to capture screenshot: {e.Message}");
                return null;
            }
        }

        public string GetDefaultExportPath(string prefix, string extension)
        {
            string directory = Path.Combine(Application.persistentDataPath, "Exports");
            Directory.CreateDirectory(directory);

            string fileName = $"{prefix}_{DateTime.Now:yyyyMMdd_HHmmss}.{extension}";
            return Path.Combine(directory, fileName);
        }

        public bool ExportPointCloudData(string outputPath)
        {
            try
            {
                if (pointCloudManager.ActiveData == null)
                {
                    OnExportFailed?.Invoke("No point cloud data loaded");
                    return false;
                }

                PointCloudData data = pointCloudManager.ActiveData;

                using (StreamWriter writer = new StreamWriter(outputPath))
                {
                    writer.WriteLine("ply");
                    writer.WriteLine("format ascii 1.0");
                    writer.WriteLine($"element vertex {data.PointCount}");
                    writer.WriteLine("property float x");
                    writer.WriteLine("property float y");
                    writer.WriteLine("property float z");
                    writer.WriteLine("property uchar red");
                    writer.WriteLine("property uchar green");
                    writer.WriteLine("property uchar blue");
                    writer.WriteLine("end_header");

                    for (int i = 0; i < data.PointCount; i++)
                    {
                        Vector3 v = data.Vertices[i];
                        Color c = data.Colors[i];
                        writer.WriteLine($"{v.x:F6} {v.y:F6} {v.z:F6} {c.r * 255:0} {c.g * 255:0} {c.b * 255:0}");
                    }
                }

                OnExportComplete?.Invoke(outputPath);
                Debug.Log($"Point cloud exported to: {outputPath}");
                return true;
            }
            catch (Exception e)
            {
                OnExportFailed?.Invoke(e.Message);
                Debug.LogError($"Point cloud export failed: {e.Message}");
                return false;
            }
        }

        [System.Serializable]
        private class FurnitureLayout
        {
            public string ExportTime;
            public int FurnitureCount;
            public List<FurnitureData> Furniture;
            public BoundsData RoomBounds;
        }

        [System.Serializable]
        private struct BoundsData
        {
            public Vector3 Center;
            public Vector3 Size;

            public BoundsData(Bounds bounds)
            {
                Center = bounds.center;
                Size = bounds.size;
            }
        }
    }
}
