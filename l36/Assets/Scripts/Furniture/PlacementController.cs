using UnityEngine;
using UnityEngine.EventSystems;
using LiDARFurniturePlacer.Core;
using LiDARFurniturePlacer.Anchor;
using LiDARFurniturePlacer.PointCloud;

namespace LiDARFurniturePlacer.Furniture
{
    public class PlacementController : MonoBehaviour
    {
        [SerializeField] private Camera mainCamera;
        [SerializeField] private FurnitureManager furnitureManager;
        [SerializeField] private WallDetector wallDetector;
        [SerializeField] private PointCloudManager pointCloudManager;
        [SerializeField] private AnchorDetector anchorDetector;
        [SerializeField] private AnchorSnapSystem snapSystem;

        [SerializeField] private float minWallDistance = 0.05f;
        [SerializeField] private float maxWallDistance = 0.5f;
        [SerializeField] private float rotationStep = 15f;
        [SerializeField] private float scaleStep = 0.1f;
        [SerializeField] private bool autoScale = true;
        [SerializeField] private float defaultScale = 1f;
        [SerializeField] private bool enableAnchorSnap = true;
        [SerializeField] private bool enableDragMode = true;

        private bool isPlacingMode = false;
        private bool isDragging = false;
        private Vector3 currentPosition;
        private Quaternion currentRotation;
        private Vector3 currentScale;
        private WallDetector.DetectedWall currentWall;
        private AnchorSnapResult lastSnapResult;

        public bool IsPlacingMode => isPlacingMode;
        public bool IsDragging => isDragging;
        public FurnitureManager FurnitureManager => furnitureManager;
        public WallDetector WallDetector => wallDetector;
        public AnchorDetector AnchorDetector => anchorDetector;
        public AnchorSnapSystem SnapSystem => snapSystem;
        public AnchorSnapResult LastSnapResult => lastSnapResult;

        public event System.Action<bool> OnPlacingModeChanged;
        public event System.Action<AnchorSnapResult> OnSnapUpdated;

        private void Awake()
        {
            if (mainCamera == null)
            {
                mainCamera = Camera.main;
            }
            currentScale = Vector3.one * defaultScale;
            currentRotation = Quaternion.identity;
        }

        private void Update()
        {
            if (isPlacingMode)
            {
                UpdatePlacementPreview();
                HandlePlacementInput();
            }
            else
            {
                HandleSelectionInput();
            }
        }

        public void StartPlacingMode(string modelPath)
        {
            if (furnitureManager.LoadPreview(modelPath))
            {
                isPlacingMode = true;
                currentScale = Vector3.one * defaultScale;
                currentRotation = Quaternion.identity;
                OnPlacingModeChanged?.Invoke(true);
            }
        }

        public void StopPlacingMode()
        {
            isPlacingMode = false;
            isDragging = false;
            furnitureManager.ClearPreview();
            currentWall = null;
            lastSnapResult = default;
            OnPlacingModeChanged?.Invoke(false);
        }

        private void UpdatePlacementPreview()
        {
            if (EventSystem.current != null && EventSystem.current.IsPointerOverGameObject())
            {
                furnitureManager.UpdatePreviewPosition(
                    Vector3.one * 1000,
                    currentRotation,
                    currentScale
                );
                return;
            }

            Ray ray = mainCamera.ScreenPointToRay(Input.mousePosition);

            Vector3 rawPosition = ComputeRawPosition(ray);
            Vector3 furnitureSize = Vector3.Scale(
                furnitureManager.PreviewFurniture?.OriginalSize ?? Vector3.one,
                currentScale
            );

            if (enableAnchorSnap && snapSystem != null)
            {
                lastSnapResult = snapSystem.ComputeSnap(rawPosition, currentRotation, furnitureSize);

                if (lastSnapResult.Snapped)
                {
                    currentPosition = lastSnapResult.SnappedPosition;
                    currentRotation = lastSnapResult.SnappedRotation;
                }
                else
                {
                    currentPosition = rawPosition;
                }

                OnSnapUpdated?.Invoke(lastSnapResult);
            }
            else
            {
                WallDetector.DetectedWall wall = wallDetector.RaycastWall(ray, out RaycastHit wallHit);
                if (wall != null)
                {
                    currentWall = wall;
                    currentPosition = wallHit.point + wallHit.normal * minWallDistance;

                    Vector3 eulerAngles = wallDetector.CalculateWallAlignedRotation(wall.Normal);
                    currentRotation = Quaternion.Euler(eulerAngles);

                    if (autoScale)
                    {
                        currentScale = CalculateAutoScale(wall, furnitureManager.PreviewFurniture.OriginalSize);
                    }
                }
                else if (furnitureManager.RaycastWall(ray, out RaycastHit hit))
                {
                    currentPosition = hit.point + hit.normal * minWallDistance;
                    currentRotation = Quaternion.FromToRotation(Vector3.back, hit.normal);

                    if (autoScale)
                    {
                        Vector3 wallSize = EstimateWallSize(hit.point, hit.normal);
                        currentScale = furnitureManager.CalculateAutoScale(wallSize, furnitureManager.PreviewFurniture.OriginalSize);
                    }
                }
                else
                {
                    currentPosition = rawPosition;
                }

                lastSnapResult = AnchorSnapResult.NoSnap(currentPosition, currentRotation);
            }

            furnitureManager.UpdatePreviewPosition(currentPosition, currentRotation, currentScale);
        }

        private Vector3 ComputeRawPosition(Ray ray)
        {
            if (Physics.Raycast(ray, out RaycastHit hit, Mathf.Infinity))
            {
                return hit.point;
            }

            float distance = 3f;
            return ray.GetPoint(distance);
        }

        private Vector3 CalculateAutoScale(WallDetector.DetectedWall wall, Vector3 modelSize)
        {
            float availableWidth = wall.Size.x * 0.8f;
            float availableHeight = wall.Size.y * 0.8f;
            float availableDepth = 0.5f;

            Vector3 wallSize = new Vector3(availableWidth, availableHeight, availableDepth);
            return furnitureManager.CalculateAutoScale(wallSize, modelSize);
        }

        private Vector3 EstimateWallSize(Vector3 hitPoint, Vector3 normal)
        {
            float width = 2f;
            float height = 2.5f;
            float depth = 0.3f;

            if (pointCloudManager.ActiveData != null)
            {
                Bounds bounds = pointCloudManager.GetPointCloudBounds();
                height = Mathf.Min(height, bounds.size.y * 0.8f);
                width = Mathf.Min(width, bounds.size.x * 0.5f);
            }

            return new Vector3(width, height, depth);
        }

        private void HandlePlacementInput()
        {
            if (Input.GetKeyDown(KeyCode.Escape))
            {
                StopPlacingMode();
                return;
            }

            if (Input.GetKeyDown(KeyCode.R))
            {
                RotatePreview(rotationStep);
            }
            else if (Input.GetKeyDown(KeyCode.Q))
            {
                RotatePreview(-rotationStep);
            }

            if (Input.GetKeyDown(KeyCode.Plus) || Input.GetKeyDown(KeyCode.Equals))
            {
                AdjustScale(scaleStep);
            }
            else if (Input.GetKeyDown(KeyCode.Minus))
            {
                AdjustScale(-scaleStep);
            }

            if (Input.GetKeyDown(KeyCode.Tab))
            {
                ToggleAnchorSnap();
            }

            if (Input.GetMouseButtonDown(0) && !isDragging)
            {
                if (enableDragMode)
                {
                    isDragging = true;
                }
                else
                {
                    PlaceFurniture();
                }
            }

            if (Input.GetMouseButtonUp(0) && isDragging)
            {
                PlaceFurniture();
                isDragging = false;
            }
        }

        private void HandleSelectionInput()
        {
            if (Input.GetMouseButtonDown(0))
            {
                if (EventSystem.current != null && EventSystem.current.IsPointerOverGameObject())
                    return;

                Ray ray = mainCamera.ScreenPointToRay(Input.mousePosition);

                FurnitureItem hitFurniture = furnitureManager.RaycastSelect(ray);
                furnitureManager.SelectFurniture(hitFurniture);
            }

            if (Input.GetKeyDown(KeyCode.Delete) || Input.GetKeyDown(KeyCode.Backspace))
            {
                furnitureManager.DeleteSelected();
            }

            if (furnitureManager.SelectedFurniture != null)
            {
                HandleDragMove();

                if (Input.GetKeyDown(KeyCode.E))
                {
                    furnitureManager.RotateSelected(rotationStep);
                }
                if (Input.GetKeyDown(KeyCode.Q))
                {
                    furnitureManager.RotateSelected(-rotationStep);
                }
            }
        }

        private void HandleDragMove()
        {
            Vector3 moveDelta = Vector3.zero;
            float moveSpeed = 0.1f;

            if (Input.GetKey(KeyCode.W)) moveDelta += Vector3.forward * moveSpeed;
            if (Input.GetKey(KeyCode.S)) moveDelta += Vector3.back * moveSpeed;
            if (Input.GetKey(KeyCode.A)) moveDelta += Vector3.left * moveSpeed;
            if (Input.GetKey(KeyCode.D)) moveDelta += Vector3.right * moveSpeed;

            if (moveDelta != Vector3.zero)
            {
                Vector3 newPos = furnitureManager.SelectedFurniture.transform.position + moveDelta;

                if (enableAnchorSnap && snapSystem != null)
                {
                    Vector3 furnitureSize = furnitureManager.SelectedFurniture.ActualSize;
                    AnchorSnapResult snap = snapSystem.ComputeSnap(
                        newPos,
                        furnitureManager.SelectedFurniture.transform.rotation,
                        furnitureSize
                    );

                    if (snap.Snapped)
                    {
                        newPos = snap.SnappedPosition;
                    }
                }

                furnitureManager.MoveSelected(newPos - furnitureManager.SelectedFurniture.transform.position);
            }
        }

        public void RotatePreview(float angle)
        {
            currentRotation *= Quaternion.Euler(0, angle, 0);
            furnitureManager.UpdatePreviewPosition(currentPosition, currentRotation, currentScale);
        }

        public void AdjustScale(float delta)
        {
            float scaleFactor = 1f + delta;
            currentScale = Vector3.ClampMagnitude(currentScale * scaleFactor, 10f);
            if (currentScale.x < 0.1f) currentScale = Vector3.one * 0.1f;

            furnitureManager.UpdatePreviewPosition(currentPosition, currentRotation, currentScale);
        }

        public void SetScale(float scale)
        {
            currentScale = Vector3.one * Mathf.Clamp(scale, 0.1f, 10f);
            furnitureManager.UpdatePreviewPosition(currentPosition, currentRotation, currentScale);
        }

        public void PlaceFurniture()
        {
            FurnitureItem placed = furnitureManager.PlaceFurniture(currentPosition, currentRotation, currentScale);
            if (placed != null)
            {
                string snapInfo = lastSnapResult.Snapped
                    ? $" (snapped to {lastSnapResult.Anchor?.Label ?? "wall"})"
                    : "";
                Debug.Log($"Placed furniture: {placed.Data.Name} at {currentPosition}{snapInfo}");
            }
        }

        public void SetAutoScale(bool enable)
        {
            autoScale = enable;
        }

        public void ToggleAnchorSnap()
        {
            enableAnchorSnap = !enableAnchorSnap;
            if (snapSystem != null)
            {
                snapSystem.SetAnchorSnapEnabled(enableAnchorSnap);
                snapSystem.SetWallSnapEnabled(enableAnchorSnap);
                snapSystem.SetCornerSnapEnabled(enableAnchorSnap);
            }
            Debug.Log($"Anchor snap: {(enableAnchorSnap ? "enabled" : "disabled")}");
        }

        public void SetAnchorSnapEnabled(bool enabled)
        {
            enableAnchorSnap = enabled;
            if (snapSystem != null)
            {
                snapSystem.SetAnchorSnapEnabled(enabled);
                snapSystem.SetWallSnapEnabled(enabled);
                snapSystem.SetCornerSnapEnabled(enabled);
            }
        }

        public bool CheckWallCollision(Vector3 position, Vector3 normal)
        {
            if (currentWall != null)
            {
                float distance = currentWall.Plane.GetDistanceToPoint(position);
                return Mathf.Abs(distance) < maxWallDistance;
            }
            return false;
        }

        public Vector3 GetCurrentPlacementInfo()
        {
            Vector3 actualSize = Vector3.Scale(furnitureManager.PreviewFurniture?.OriginalSize ?? Vector3.one, currentScale);
            return actualSize;
        }

        public void ClearSelection()
        {
            furnitureManager.SelectFurniture(null);
        }

        public void DetectAnchorsFromWalls()
        {
            if (wallDetector != null && anchorDetector != null)
            {
                Vector3 floorY = pointCloudManager?.ActiveData != null
                    ? pointCloudManager.GetPointCloudBounds().min
                    : Vector3.zero;
                anchorDetector.DetectAnchorsFromWalls(wallDetector.DetectedWalls, floorY);
            }
        }
    }
}
