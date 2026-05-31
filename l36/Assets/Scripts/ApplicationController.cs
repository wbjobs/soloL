using UnityEngine;
using System.Collections.Generic;
using LiDARFurniturePlacer.Core;
using LiDARFurniturePlacer.PointCloud;
using LiDARFurniturePlacer.ICP;
using LiDARFurniturePlacer.Furniture;
using LiDARFurniturePlacer.Rendering;
using LiDARFurniturePlacer.Export;
using LiDARFurniturePlacer.Anchor;
using LiDARFurniturePlacer.Semantic;
using LiDARFurniturePlacer.Floor;

namespace LiDARFurniturePlacer
{
    public class ApplicationController : MonoBehaviour
    {
        [SerializeField] private PointCloudManager pointCloudManager;
        [SerializeField] private RegistrationManager registrationManager;
        [SerializeField] private FurnitureManager furnitureManager;
        [SerializeField] private PlacementController placementController;
        [SerializeField] private WallDetector wallDetector;
        [SerializeField] private AnchorDetector anchorDetector;
        [SerializeField] private AnchorSnapSystem snapSystem;
        [SerializeField] private RenderManager renderManager;
        [SerializeField] private ExportManager exportManager;
        [SerializeField] private SemanticSegmentationManager semanticSegmentationManager;
        [SerializeField] private SemanticRegionManager semanticRegionManager;
        [SerializeField] private FloorManager floorManager;
        [SerializeField] private ComputeShader pointNetComputeShader;

        [SerializeField] private Camera mainCamera;
        [SerializeField] private Transform cameraTarget;

        [SerializeField] private float cameraMoveSpeed = 10f;
        [SerializeField] private float cameraRotateSpeed = 2f;
        [SerializeField] private float cameraZoomSpeed = 5f;

        private Vector3 lastMousePosition;
        private bool isOrbiting = false;
        private bool isPanning = false;

        public PointCloudManager PointCloudManager => pointCloudManager;
        public RegistrationManager RegistrationManager => registrationManager;
        public FurnitureManager FurnitureManager => furnitureManager;
        public PlacementController PlacementController => placementController;
        public WallDetector WallDetector => wallDetector;
        public AnchorDetector AnchorDetector => anchorDetector;
        public AnchorSnapSystem SnapSystem => snapSystem;
        public RenderManager RenderManager => renderManager;
        public ExportManager ExportManager => exportManager;
        public SemanticSegmentationManager SemanticSegmentationManager => semanticSegmentationManager;
        public SemanticRegionManager SemanticRegionManager => semanticRegionManager;
        public FloorManager FloorManager => floorManager;

        public static ApplicationController Instance { get; private set; }

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }

            Instance = this;
            DontDestroyOnLoad(gameObject);

            InitializeComponents();
        }

        private void InitializeComponents()
        {
            if (mainCamera == null)
            {
                mainCamera = Camera.main;
            }

            if (pointCloudManager == null)
            {
                GameObject pcObj = new GameObject("PointCloudManager");
                pcObj.transform.SetParent(transform);
                pointCloudManager = pcObj.AddComponent<PointCloudManager>();
            }

            if (registrationManager == null)
            {
                GameObject regObj = new GameObject("RegistrationManager");
                regObj.transform.SetParent(transform);
                registrationManager = regObj.AddComponent<RegistrationManager>();
                registrationManager.PointCloudManager = pointCloudManager;
            }

            if (furnitureManager == null)
            {
                GameObject furnObj = new GameObject("FurnitureManager");
                furnObj.transform.SetParent(transform);
                furnitureManager = furnObj.AddComponent<FurnitureManager>();
            }

            if (wallDetector == null)
            {
                GameObject wallObj = new GameObject("WallDetector");
                wallObj.transform.SetParent(transform);
                wallDetector = wallObj.AddComponent<WallDetector>();
            }

            if (anchorDetector == null)
            {
                GameObject anchorObj = new GameObject("AnchorDetector");
                anchorObj.transform.SetParent(transform);
                anchorDetector = anchorObj.AddComponent<AnchorDetector>();
            }

            if (snapSystem == null)
            {
                GameObject snapObj = new GameObject("AnchorSnapSystem");
                snapObj.transform.SetParent(transform);
                snapSystem = snapObj.AddComponent<AnchorSnapSystem>();
            }

            if (placementController == null)
            {
                GameObject placeObj = new GameObject("PlacementController");
                placeObj.transform.SetParent(transform);
                placementController = placeObj.AddComponent<PlacementController>();
            }

            if (renderManager == null)
            {
                GameObject renderObj = new GameObject("RenderManager");
                renderObj.transform.SetParent(transform);
                renderManager = renderObj.AddComponent<RenderManager>();
            }

            if (exportManager == null)
            {
                GameObject exportObj = new GameObject("ExportManager");
                exportObj.transform.SetParent(transform);
                exportManager = exportObj.AddComponent<ExportManager>();
            }

            if (semanticSegmentationManager == null)
            {
                GameObject semObj = new GameObject("SemanticSegmentationManager");
                semObj.transform.SetParent(transform);
                semanticSegmentationManager = semObj.AddComponent<SemanticSegmentationManager>();
            }

            if (semanticRegionManager == null)
            {
                GameObject regionObj = new GameObject("SemanticRegionManager");
                regionObj.transform.SetParent(transform);
                semanticRegionManager = regionObj.AddComponent<SemanticRegionManager>();
            }

            if (floorManager == null)
            {
                GameObject floorObj = new GameObject("FloorManager");
                floorObj.transform.SetParent(transform);
                floorManager = floorObj.AddComponent<FloorManager>();
            }

            if (pointNetComputeShader != null && semanticSegmentationManager != null)
            {
                semanticSegmentationManager.SetUseGPU(true);
            }

            if (furnitureManager != null && semanticRegionManager != null)
            {
                furnitureManager.SetRegionManager(semanticRegionManager);
            }

            if (cameraTarget == null)
            {
                cameraTarget = new GameObject("CameraTarget").transform;
                cameraTarget.SetParent(transform);
            }
        }

        private void Start()
        {
            SetupCamera();
        }

        private void SetupCamera()
        {
            if (mainCamera != null)
            {
                mainCamera.transform.position = new Vector3(5, 3, 5);
                mainCamera.transform.LookAt(cameraTarget.position);
            }
        }

        private void Update()
        {
            HandleCameraInput();
            HandleKeyboardShortcuts();
        }

        private void HandleCameraInput()
        {
            if (placementController != null && placementController.IsPlacingMode)
                return;

            if (Input.GetMouseButtonDown(1))
            {
                isOrbiting = true;
                lastMousePosition = Input.mousePosition;
            }
            if (Input.GetMouseButtonUp(1))
            {
                isOrbiting = false;
            }

            if (Input.GetMouseButtonDown(2))
            {
                isPanning = true;
                lastMousePosition = Input.mousePosition;
            }
            if (Input.GetMouseButtonUp(2))
            {
                isPanning = false;
            }

            if (isOrbiting)
            {
                Vector3 delta = Input.mousePosition - lastMousePosition;
                float rotationX = delta.y * cameraRotateSpeed * Time.deltaTime;
                float rotationY = delta.x * cameraRotateSpeed * Time.deltaTime;

                mainCamera.transform.RotateAround(cameraTarget.position, Vector3.up, rotationY);
                mainCamera.transform.RotateAround(cameraTarget.position, mainCamera.transform.right, -rotationX);
            }

            if (isPanning)
            {
                Vector3 delta = Input.mousePosition - lastMousePosition;
                Vector3 pan = new Vector3(-delta.x, -delta.y, 0) * cameraMoveSpeed * 0.01f * Time.deltaTime;
                pan = mainCamera.transform.TransformDirection(pan);
                pan.y = 0;

                cameraTarget.position += pan;
                mainCamera.transform.position += pan;
            }

            float scroll = Input.GetAxis("Mouse ScrollWheel");
            if (Mathf.Abs(scroll) > 0.01f)
            {
                Vector3 zoomDirection = (cameraTarget.position - mainCamera.transform.position).normalized;
                mainCamera.transform.position += zoomDirection * scroll * cameraZoomSpeed;
            }

            lastMousePosition = Input.mousePosition;
        }

        private void HandleKeyboardShortcuts()
        {
            if (Input.GetKey(KeyCode.LeftControl) || Input.GetKey(KeyCode.RightControl))
            {
                if (Input.GetKeyDown(KeyCode.O))
                {
                    LoadPointCloudDialog();
                }
                if (Input.GetKeyDown(KeyCode.I))
                {
                    LoadCADDialog();
                }
                if (Input.GetKeyDown(KeyCode.E))
                {
                    ExportPDFDialog();
                }
                if (Input.GetKeyDown(KeyCode.S))
                {
                    ExportJSONDialog();
                }
            }

            if (Input.GetKeyDown(KeyCode.F1))
            {
                RunICPRegistration();
            }
            if (Input.GetKeyDown(KeyCode.F2))
            {
                DetectWalls();
            }
            if (Input.GetKeyDown(KeyCode.F3))
            {
                renderManager.CycleRenderMode();
            }
            if (Input.GetKeyDown(KeyCode.F4))
            {
                renderManager.CycleColoringMode();
            }
            if (Input.GetKeyDown(KeyCode.F5))
            {
                renderManager.ResetView();
            }
            if (Input.GetKeyDown(KeyCode.F6))
            {
                DetectAnchors();
            }
            if (Input.GetKeyDown(KeyCode.F7))
            {
                ToggleAnchorSnap();
            }
            if (Input.GetKeyDown(KeyCode.F8))
            {
                RunSemanticSegmentation();
            }
            if (Input.GetKeyDown(KeyCode.F9))
            {
                ExportScreenshotDialog();
            }
            if (Input.GetKeyDown(KeyCode.F10))
            {
                DetectFloors();
            }
            if (Input.GetKeyDown(KeyCode.F11))
            {
                DetectRooms();
            }
            if (Input.GetKeyDown(KeyCode.F12))
            {
                ToggleSemanticValidation();
            }

            if (Input.GetKeyDown(KeyCode.PageUp))
            {
                SwitchToNextFloor();
            }
            if (Input.GetKeyDown(KeyCode.PageDown))
            {
                SwitchToPreviousFloor();
            }
        }

        public bool LoadPointCloud(string filePath)
        {
            bool success = pointCloudManager.LoadPointCloud(filePath);
            if (success)
            {
                renderManager.ResetView();
            }
            return success;
        }

        public bool LoadCADModel(string filePath)
        {
            return registrationManager.LoadCADModel(filePath);
        }

        public ICPRegistration.RegistrationResult RunICPRegistration()
        {
            return registrationManager.RegisterPointCloudToCAD();
        }

        public void DetectWalls()
        {
            if (pointCloudManager.ActiveData != null)
            {
                wallDetector.DetectWalls(pointCloudManager.ActiveData);
            }
        }

        public SemanticLabel[] RunSemanticSegmentation()
        {
            if (pointCloudManager.ActiveData == null)
            {
                Debug.LogWarning("No point cloud loaded for semantic segmentation");
                return null;
            }

            SemanticLabel[] labels = semanticSegmentationManager.SegmentPointCloud(pointCloudManager.ActiveData);
            if (labels != null)
            {
                pointCloudManager.ApplySemanticLabels(labels);
                Debug.Log("Semantic segmentation complete");

                Dictionary<SemanticLabel, int> stats = pointCloudManager.ActiveData.GetSemanticStatistics();
                foreach (var kvp in stats)
                {
                    Debug.Log($"  {kvp.Key}: {kvp.Value} points");
                }
            }
            return labels;
        }

        public List<FloorData> DetectFloors()
        {
            if (pointCloudManager.ActiveData == null)
            {
                Debug.LogWarning("No point cloud loaded for floor detection");
                return new List<FloorData>();
            }

            SemanticLabel[] labels = semanticSegmentationManager.CurrentLabels;
            if (labels == null)
            {
                Debug.Log("Running semantic segmentation first for floor detection...");
                labels = RunSemanticSegmentation();
            }

            List<FloorData> floors = floorManager.DetectFloors(pointCloudManager.ActiveData, labels);

            if (floors.Count > 0)
            {
                pointCloudManager.CreateFloorRenderers(floors);
                floorManager.VisualizeFloorBoundaries();
                Debug.Log($"Detected {floors.Count} floors");
            }
            else
            {
                Debug.LogWarning("No floors detected");
            }

            return floors;
        }

        public List<RoomRegion> DetectRooms()
        {
            if (pointCloudManager.ActiveData == null)
            {
                Debug.LogWarning("No point cloud loaded for room detection");
                return new List<RoomRegion>();
            }

            if (!semanticSegmentationManager.IsSegmented)
            {
                RunSemanticSegmentation();
            }

            if (floorManager.FloorCount == 0)
            {
                DetectFloors();
            }

            FloorData currentFloor = floorManager.CurrentFloor;
            if (currentFloor == null)
            {
                currentFloor = floorManager.GetFloor(0);
            }

            float floorY = currentFloor != null ? currentFloor.MinHeight : pointCloudManager.GetPointCloudBounds().min.y;
            float floorHeight = currentFloor != null ? currentFloor.MaxHeight - currentFloor.MinHeight : 2.8f;

            List<RoomRegion> rooms = semanticRegionManager.DetectRooms(
                pointCloudManager.ActiveData,
                semanticSegmentationManager.CurrentLabels,
                floorY,
                floorHeight);

            if (rooms.Count > 0)
            {
                semanticRegionManager.VisualizeRooms();
                Debug.Log($"Detected {rooms.Count} rooms");

                for (int i = 0; i < rooms.Count; i++)
                {
                    if (currentFloor != null)
                    {
                        currentFloor.AddRoom(rooms[i]);
                    }
                    Debug.Log($"  Room {i + 1}: {RoomTypeNames.GetDisplayName(rooms[i].Type)} ({rooms[i].Area:F1}m²)");
                }
            }

            return rooms;
        }

        public void SwitchFloor(int floorIndex)
        {
            previousFloorIndex = floorManager.CurrentFloorIndex;
            floorManager.SwitchFloor(floorIndex);

            FloorData floor = floorManager.CurrentFloor;
            if (floor != null)
            {
                if (previousFloorIndex >= 0 && previousFloorIndex != floorIndex)
                {
                    pointCloudManager.HideFloor(previousFloorIndex);
                    furnitureManager.SetFloorVisibility(previousFloorIndex, false);
                }
                pointCloudManager.ShowFloor(floorIndex);
                furnitureManager.SetFloorVisibility(floorIndex, true);

                cameraTarget.position = floor.Center;
                Debug.Log($"Switched to floor {floorIndex + 1} ({floor.MinHeight:F1}m ~ {floor.MaxHeight:F1}m)");
            }
        }

        private int previousFloorIndex = -1;

        public void SwitchToNextFloor()
        {
            if (floorManager.FloorCount <= 1) return;
            previousFloorIndex = floorManager.CurrentFloorIndex;
            floorManager.SwitchToNextFloor();
            HandleFloorSwitch();
        }

        public void SwitchToPreviousFloor()
        {
            if (floorManager.FloorCount <= 1) return;
            previousFloorIndex = floorManager.CurrentFloorIndex;
            floorManager.SwitchToPreviousFloor();
            HandleFloorSwitch();
        }

        private void HandleFloorSwitch()
        {
            FloorData floor = floorManager.CurrentFloor;
            if (floor == null) return;

            if (previousFloorIndex >= 0)
            {
                pointCloudManager.HideFloor(previousFloorIndex);
                furnitureManager.SetFloorVisibility(previousFloorIndex, false);
            }

            pointCloudManager.ShowFloor(floorManager.CurrentFloorIndex);
            furnitureManager.SetFloorVisibility(floorManager.CurrentFloorIndex, true);

            cameraTarget.position = floor.Center;
            Debug.Log($"Switched to {floor.FloorIndex + 1}F ({floor.MinHeight:F1}m ~ {floor.MaxHeight:F1}m)");
        }

        public void ShowAllFloors()
        {
            floorManager.ShowAllFloors();
            pointCloudManager.ShowAllFloors();
            for (int i = 0; i < floorManager.FloorCount; i++)
            {
                furnitureManager.SetFloorVisibility(i, true);
            }
        }

        public void ShowOnlyCurrentFloor()
        {
            floorManager.ShowOnlyCurrentFloor();
            for (int i = 0; i < floorManager.FloorCount; i++)
            {
                bool visible = i == floorManager.CurrentFloorIndex;
                if (visible)
                    pointCloudManager.ShowFloor(i);
                else
                    pointCloudManager.HideFloor(i);
                furnitureManager.SetFloorVisibility(i, visible);
            }
        }

        public void StartFurniturePlacement(string modelPath)
        {
            placementController.StartPlacingMode(modelPath);
        }

        public void StartFurniturePlacement(string modelPath, FurnitureCategory category)
        {
            furnitureManager.LoadPreview(modelPath, category);
            placementController.StartPlacingMode(modelPath);
        }

        public void StopFurniturePlacement()
        {
            placementController.StopPlacingMode();
        }

        public void SetRenderMode(RenderMode mode)
        {
            renderManager.SetRenderMode(mode);
        }

        public void SetColoringMode(PointCloudColoringMode mode)
        {
            renderManager.SetColoringMode(mode);
        }

        public void DetectAnchors()
        {
            if (wallDetector != null && anchorDetector != null)
            {
                Vector3 floorY = pointCloudManager?.ActiveData != null
                    ? pointCloudManager.GetPointCloudBounds().min
                    : Vector3.zero;
                anchorDetector.DetectAnchorsFromWalls(wallDetector.DetectedWalls, floorY);
            }
        }

        public void ToggleAnchorSnap()
        {
            if (placementController != null)
            {
                placementController.ToggleAnchorSnap();
            }
        }

        public void ToggleSemanticValidation()
        {
            if (furnitureManager != null)
            {
                furnitureManager.EnableSemanticValidation = !furnitureManager.EnableSemanticValidation;
                Debug.Log($"Semantic validation: {(furnitureManager.EnableSemanticValidation ? "ON" : "OFF")}");
            }
        }

        public void SetEstimationMode(RegistrationManager.InitialEstimationMode mode)
        {
            registrationManager.SetEstimationMode(mode);
        }

        public AnchorPoint AddManualAnchor(AnchorType type, Vector3 position, Vector3 normal, string label = "")
        {
            if (anchorDetector != null)
            {
                return anchorDetector.AddManualAnchor(type, position, normal, label);
            }
            return null;
        }

        public void SetRoomType(string roomId, RoomType type)
        {
            semanticRegionManager.SetRoomType(roomId, type);
        }

        public void AddPlacementRule(FurniturePlacementRule rule)
        {
            semanticRegionManager.AddPlacementRule(rule);
        }

        public string GetFloorInfo()
        {
            return floorManager.GetFloorInfoString();
        }

        public bool ExportFurnitureLayoutPDF(string outputPath)
        {
            return exportManager.ExportFurnitureLayoutPDF(outputPath);
        }

        public bool ExportScreenshotPDF(string outputPath)
        {
            return exportManager.ExportScreenshotPDF(outputPath);
        }

        public bool ExportFurnitureJSON(string outputPath)
        {
            return exportManager.ExportFurnitureDataJSON(outputPath);
        }

        public bool ImportFurnitureJSON(string inputPath)
        {
            return exportManager.ImportFurnitureDataJSON(inputPath);
        }

        private void LoadPointCloudDialog()
        {
            Debug.Log("Open Point Cloud Dialog - In actual use, integrate with your file dialog system");
        }

        private void LoadCADDialog()
        {
            Debug.Log("Open CAD Dialog - In actual use, integrate with your file dialog system");
        }

        private void ExportPDFDialog()
        {
            string path = exportManager.GetDefaultExportPath("Layout", "pdf");
            exportManager.ExportFurnitureLayoutPDF(path);
        }

        private void ExportJSONDialog()
        {
            string path = exportManager.GetDefaultExportPath("FurnitureData", "json");
            exportManager.ExportFurnitureDataJSON(path);
        }

        private void ExportScreenshotDialog()
        {
            string path = exportManager.GetDefaultExportPath("Screenshot", "pdf");
            exportManager.ExportScreenshotPDF(path);
        }

        public void ClearAll()
        {
            furnitureManager.ClearAllFurniture();
            pointCloudManager.ClearPointCloud();
            wallDetector.ClearDetectedWalls();
            registrationManager.ResetTransform();
            semanticSegmentationManager.ClearSegmentation();
            semanticRegionManager.ClearRooms();
            floorManager.ClearAll();
        }

        private void OnApplicationQuit()
        {
            if (Instance == this)
            {
                Instance = null;
            }
        }
    }
}
