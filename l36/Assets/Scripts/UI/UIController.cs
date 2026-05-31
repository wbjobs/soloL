using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using TMPro;
using LiDARFurniturePlacer.Core;
using LiDARFurniturePlacer.Furniture;
using LiDARFurniturePlacer.ICP;
using LiDARFurniturePlacer.Rendering;

namespace LiDARFurniturePlacer.UI
{
    public class UIController : MonoBehaviour
    {
        [SerializeField] private ApplicationController appController;

        [Header("Main Panels")]
        [SerializeField] private GameObject mainMenuPanel;
        [SerializeField] private GameObject pointCloudPanel;
        [SerializeField] private GameObject furniturePanel;
        [SerializeField] private GameObject settingsPanel;
        [SerializeField] private GameObject infoPanel;

        [Header("Point Cloud Controls")]
        [SerializeField] private Button loadPointCloudBtn;
        [SerializeField] private Button loadCADBtn;
        [SerializeField] private Button runICPBt;
        [SerializeField] private Button detectWallsBtn;
        [SerializeField] private TMP_Text icpStatusText;
        [SerializeField] private Slider icpProgressSlider;

        [Header("Furniture Controls")]
        [SerializeField] private Button startPlacementBtn;
        [SerializeField] private Button stopPlacementBtn;
        [SerializeField] private Button exportPDFBtn;
        [SerializeField] private Button exportScreenshotBtn;
        [SerializeField] private Button exportJSONBtn;
        [SerializeField] private Button importJSONBtn;
        [SerializeField] private Button clearAllFurnitureBtn;
        [SerializeField] private TMP_Dropdown furnitureListDropdown;
        [SerializeField] private TMP_Text furnitureInfoText;
        [SerializeField] private Slider scaleSlider;
        [SerializeField] private TMP_Text scaleValueText;

        [Header("Render Controls")]
        [SerializeField] private TMP_Dropdown renderModeDropdown;
        [SerializeField] private TMP_Dropdown coloringModeDropdown;
        [SerializeField] private Slider pointSizeSlider;
        [SerializeField] private TMP_Text pointSizeValueText;
        [SerializeField] private Toggle showPointCloudToggle;
        [SerializeField] private Toggle showWallsToggle;
        [SerializeField] private Toggle showFurnitureToggle;

        [Header("Info Display")]
        [SerializeField] private TMP_Text statusText;
        [SerializeField] private TMP_Text infoText;
        [SerializeField] private TMP_Text placementInfoText;

        [Header("Furniture Models")]
        [SerializeField] private string[] furnitureModelPaths;

        private bool isPlacingMode = false;

        private void Awake()
        {
            if (appController == null)
            {
                appController = FindObjectOfType<ApplicationController>();
            }

            InitializeUI();
        }

        private void Start()
        {
            SetupEventListeners();
            PopulateFurnitureList();
            UpdateStatus("Ready");
        }

        private void InitializeUI()
        {
            if (icpProgressSlider != null)
            {
                icpProgressSlider.value = 0;
                icpProgressSlider.gameObject.SetActive(false);
            }

            if (renderModeDropdown != null)
            {
                renderModeDropdown.ClearOptions();
                renderModeDropdown.AddOptions(new List<string> { "Realistic", "Wireframe" });
            }

            if (coloringModeDropdown != null)
            {
                coloringModeDropdown.ClearOptions();
                coloringModeDropdown.AddOptions(new List<string> { "Original", "Height", "Normal", "Semantic" });
            }

            if (pointSizeSlider != null)
            {
                pointSizeSlider.minValue = 0.001f;
                pointSizeSlider.maxValue = 0.2f;
                pointSizeSlider.value = 0.02f;
            }

            if (scaleSlider != null)
            {
                scaleSlider.minValue = 0.1f;
                scaleSlider.maxValue = 5f;
                scaleSlider.value = 1f;
            }
        }

        private void SetupEventListeners()
        {
            if (loadPointCloudBtn != null)
                loadPointCloudBtn.onClick.AddListener(OnLoadPointCloudClicked);

            if (loadCADBtn != null)
                loadCADBtn.onClick.AddListener(OnLoadCADClicked);

            if (runICPBt != null)
                runICPBt.onClick.AddListener(OnRunICPClicked);

            if (detectWallsBtn != null)
                detectWallsBtn.onClick.AddListener(OnDetectWallsClicked);

            if (startPlacementBtn != null)
                startPlacementBtn.onClick.AddListener(OnStartPlacementClicked);

            if (stopPlacementBtn != null)
                stopPlacementBtn.onClick.AddListener(OnStopPlacementClicked);

            if (exportPDFBtn != null)
                exportPDFBtn.onClick.AddListener(OnExportPDFClicked);

            if (exportScreenshotBtn != null)
                exportScreenshotBtn.onClick.AddListener(OnExportScreenshotClicked);

            if (exportJSONBtn != null)
                exportJSONBtn.onClick.AddListener(OnExportJSONClicked);

            if (importJSONBtn != null)
                importJSONBtn.onClick.AddListener(OnImportJSONClicked);

            if (clearAllFurnitureBtn != null)
                clearAllFurnitureBtn.onClick.AddListener(OnClearAllFurnitureClicked);

            if (furnitureListDropdown != null)
                furnitureListDropdown.onValueChanged.AddListener(OnFurnitureSelected);

            if (renderModeDropdown != null)
                renderModeDropdown.onValueChanged.AddListener(OnRenderModeChanged);

            if (coloringModeDropdown != null)
                coloringModeDropdown.onValueChanged.AddListener(OnColoringModeChanged);

            if (pointSizeSlider != null)
                pointSizeSlider.onValueChanged.AddListener(OnPointSizeChanged);

            if (scaleSlider != null)
                scaleSlider.onValueChanged.AddListener(OnScaleChanged);

            if (showPointCloudToggle != null)
                showPointCloudToggle.onValueChanged.AddListener(OnShowPointCloudToggled);

            if (showWallsToggle != null)
                showWallsToggle.onValueChanged.AddListener(OnShowWallsToggled);

            if (showFurnitureToggle != null)
                showFurnitureToggle.onValueChanged.AddListener(OnShowFurnitureToggled);

            if (appController != null && appController.RegistrationManager != null)
            {
                appController.RegistrationManager.OnRegistrationProgress += OnRegistrationProgress;
                appController.RegistrationManager.OnRegistrationComplete += OnRegistrationComplete;
            }

            if (appController != null && appController.FurnitureManager != null)
            {
                appController.FurnitureManager.OnFurniturePlaced += OnFurniturePlaced;
            }

            if (appController != null && appController.ExportManager != null)
            {
                appController.ExportManager.OnExportComplete += OnExportComplete;
                appController.ExportManager.OnExportFailed += OnExportFailed;
            }
        }

        private void PopulateFurnitureList()
        {
            if (furnitureListDropdown == null) return;

            furnitureListDropdown.ClearOptions();
            List<string> options = new List<string> { "Select Furniture..." };

            if (furnitureModelPaths != null)
            {
                foreach (string path in furnitureModelPaths)
                {
                    string name = System.IO.Path.GetFileNameWithoutExtension(path);
                    options.Add(name);
                }
            }

            furnitureListDropdown.AddOptions(options);
        }

        private void OnLoadPointCloudClicked()
        {
            UpdateStatus("Selecting point cloud file...");
            string path = OpenFileDialog("Select Point Cloud", "ply");
            if (!string.IsNullOrEmpty(path) && appController != null)
            {
                bool success = appController.LoadPointCloud(path);
                UpdateStatus(success ? $"Loaded: {System.IO.Path.GetFileName(path)}" : "Failed to load point cloud");
                UpdatePointCloudInfo();
            }
        }

        private void OnLoadCADClicked()
        {
            UpdateStatus("Selecting CAD model file...");
            string path = OpenFileDialog("Select CAD Model", "ply,obj");
            if (!string.IsNullOrEmpty(path) && appController != null)
            {
                bool success = appController.LoadCADModel(path);
                UpdateStatus(success ? $"CAD loaded: {System.IO.Path.GetFileName(path)}" : "Failed to load CAD model");
            }
        }

        private void OnRunICPClicked()
        {
            if (appController == null) return;

            UpdateStatus("Running ICP registration...");
            if (icpProgressSlider != null)
            {
                icpProgressSlider.gameObject.SetActive(true);
                icpProgressSlider.value = 0;
            }

            var result = appController.RunICPRegistration();
            if (result != null)
            {
                UpdateICPStatus(result);
            }
            else
            {
                UpdateStatus("ICP registration failed");
            }

            if (icpProgressSlider != null)
            {
                icpProgressSlider.gameObject.SetActive(false);
            }
        }

        private void OnDetectWallsClicked()
        {
            if (appController == null) return;

            UpdateStatus("Detecting walls...");
            appController.DetectWalls();
            int wallCount = appController.WallDetector.DetectedWalls.Count;
            UpdateStatus($"Detected {wallCount} walls");
        }

        private void OnFurnitureSelected(int index)
        {
            if (index <= 0 || furnitureModelPaths == null || index - 1 >= furnitureModelPaths.Length)
                return;

            string modelPath = furnitureModelPaths[index - 1];
            if (appController != null)
            {
                appController.StartFurniturePlacement(modelPath);
                isPlacingMode = true;
                UpdatePlacementUI(true);
                UpdateStatus($"Placing: {System.IO.Path.GetFileNameWithoutExtension(modelPath)}");
            }
        }

        private void OnStartPlacementClicked()
        {
            if (furnitureListDropdown != null && furnitureListDropdown.value > 0)
            {
                OnFurnitureSelected(furnitureListDropdown.value);
            }
        }

        private void OnStopPlacementClicked()
        {
            if (appController != null)
            {
                appController.StopFurniturePlacement();
                isPlacingMode = false;
                UpdatePlacementUI(false);
                UpdateStatus("Placement mode stopped");
            }
        }

        private void OnExportPDFClicked()
        {
            if (appController == null) return;

            UpdateStatus("Exporting PDF...");
            string path = appController.ExportManager.GetDefaultExportPath("FurnitureLayout", "pdf");
            bool success = appController.ExportFurnitureLayoutPDF(path);
            UpdateStatus(success ? $"PDF exported: {path}" : "PDF export failed");
        }

        private void OnExportScreenshotClicked()
        {
            if (appController == null) return;

            UpdateStatus("Exporting screenshot...");
            string path = appController.ExportManager.GetDefaultExportPath("Screenshot", "pdf");
            bool success = appController.ExportScreenshotPDF(path);
            UpdateStatus(success ? $"Screenshot exported: {path}" : "Screenshot export failed");
        }

        private void OnExportJSONClicked()
        {
            if (appController == null) return;

            UpdateStatus("Exporting JSON...");
            string path = appController.ExportManager.GetDefaultExportPath("FurnitureData", "json");
            bool success = appController.ExportFurnitureJSON(path);
            UpdateStatus(success ? $"JSON exported: {path}" : "JSON export failed");
        }

        private void OnImportJSONClicked()
        {
            if (appController == null) return;

            UpdateStatus("Selecting JSON file...");
            string path = OpenFileDialog("Import Furniture Data", "json");
            if (!string.IsNullOrEmpty(path))
            {
                bool success = appController.ImportFurnitureJSON(path);
                UpdateStatus(success ? "Furniture data imported" : "Import failed");
            }
        }

        private void OnClearAllFurnitureClicked()
        {
            if (appController != null)
            {
                appController.FurnitureManager.ClearAllFurniture();
                UpdateStatus("All furniture cleared");
                UpdateFurnitureInfo();
            }
        }

        private void OnRenderModeChanged(int index)
        {
            if (appController == null) return;

            RenderMode mode = (RenderMode)index;
            appController.SetRenderMode(mode);
            UpdateStatus($"Render mode: {mode}");
        }

        private void OnColoringModeChanged(int index)
        {
            if (appController == null) return;

            PointCloudColoringMode mode = (PointCloudColoringMode)index;
            appController.SetColoringMode(mode);
            UpdateStatus($"Coloring mode: {mode}");
        }

        private void OnPointSizeChanged(float value)
        {
            if (appController != null)
            {
                appController.RenderManager.SetPointSize(value);
                if (pointSizeValueText != null)
                {
                    pointSizeValueText.text = $"{value:F3}m";
                }
            }
        }

        private void OnScaleChanged(float value)
        {
            if (appController != null && appController.PlacementController != null)
            {
                appController.PlacementController.SetScale(value);
                if (scaleValueText != null)
                {
                    scaleValueText.text = $"{value:F2}x";
                }
            }
        }

        private void OnShowPointCloudToggled(bool show)
        {
            if (appController != null)
            {
                appController.RenderManager.TogglePointCloud(show);
            }
        }

        private void OnShowWallsToggled(bool show)
        {
            if (appController != null)
            {
                appController.RenderManager.ToggleWalls(show);
            }
        }

        private void OnShowFurnitureToggled(bool show)
        {
            if (appController != null)
            {
                appController.RenderManager.ToggleFurniture(show);
            }
        }

        private void OnRegistrationProgress(float progress)
        {
            if (icpProgressSlider != null)
            {
                icpProgressSlider.value = progress;
            }
        }

        private void OnRegistrationComplete(ICPRegistration.RegistrationResult result)
        {
            UpdateICPStatus(result);
        }

        private void OnFurniturePlaced(FurnitureItem item)
        {
            UpdateFurnitureInfo();
            UpdateStatus($"Placed: {item.Data.Name}");
        }

        private void OnExportComplete(string path)
        {
            UpdateStatus($"Export complete: {path}");
        }

        private void OnExportFailed(string error)
        {
            UpdateStatus($"Export failed: {error}");
        }

        private void UpdateICPStatus(ICPRegistration.RegistrationResult result)
        {
            if (icpStatusText == null || result == null) return;

            string status = result.Converged ? "Converged" : "Not Converged";
            icpStatusText.text = $"ICP: {status} | Iter: {result.Iterations} | RMSE: {result.InlierRMSE:F6}";
        }

        private void UpdatePlacementUI(bool isPlacing)
        {
            if (startPlacementBtn != null)
                startPlacementBtn.gameObject.SetActive(!isPlacing);

            if (stopPlacementBtn != null)
                stopPlacementBtn.gameObject.SetActive(isPlacing);

            if (placementInfoText != null)
            {
                placementInfoText.gameObject.SetActive(isPlacing);
                placementInfoText.text = "Click to place | R/Q to rotate | +/- to scale | ESC to cancel";
            }
        }

        private void UpdatePointCloudInfo()
        {
            if (infoText == null || appController == null || appController.PointCloudManager.ActiveData == null) return;

            var data = appController.PointCloudManager.ActiveData;
            var bounds = data.GetBounds();
            infoText.text = $"Points: {data.PointCount:N0}\n" +
                          $"Size: {bounds.size.x:F2} x {bounds.size.y:F2} x {bounds.size.z:F2} m";
        }

        private void UpdateFurnitureInfo()
        {
            if (furnitureInfoText == null || appController == null) return;

            int count = appController.FurnitureManager.PlacedFurniture.Count;
            furnitureInfoText.text = $"Placed: {count} items";
        }

        private void UpdateStatus(string message)
        {
            if (statusText != null)
            {
                statusText.text = message;
            }
            Debug.Log($"[Status] {message}");
        }

        private string OpenFileDialog(string title, string extensions)
        {
            UpdateStatus($"Please select a file: {title}");
            return null;
        }

        private void Update()
        {
            UpdateFurnitureInfo();

            if (appController != null && appController.PlacementController != null)
            {
                bool placing = appController.PlacementController.IsPlacingMode;
                if (placing != isPlacingMode)
                {
                    isPlacingMode = placing;
                    UpdatePlacementUI(placing);
                }

                if (placing && placementInfoText != null)
                {
                    Vector3 size = appController.PlacementController.GetCurrentPlacementInfo();
                    placementInfoText.text = $"Size: {size.x:F2} x {size.y:F2} x {size.z:F2} m\n" +
                                            "Click to place | R/Q to rotate | +/- to scale | ESC to cancel";
                }
            }
        }

        private void OnDestroy()
        {
            if (appController != null && appController.RegistrationManager != null)
            {
                appController.RegistrationManager.OnRegistrationProgress -= OnRegistrationProgress;
                appController.RegistrationManager.OnRegistrationComplete -= OnRegistrationComplete;
            }

            if (appController != null && appController.FurnitureManager != null)
            {
                appController.FurnitureManager.OnFurniturePlaced -= OnFurniturePlaced;
            }

            if (appController != null && appController.ExportManager != null)
            {
                appController.ExportManager.OnExportComplete -= OnExportComplete;
                appController.ExportManager.OnExportFailed -= OnExportFailed;
            }
        }
    }
}
