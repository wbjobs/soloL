using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;
using LiDARFurniturePlacer.Core;
using LiDARFurniturePlacer.Semantic;

namespace LiDARFurniturePlacer.Furniture
{
    public class FurnitureManager : MonoBehaviour
    {
        [SerializeField] private Transform furnitureContainer;
        [SerializeField] private LayerMask furnitureLayer;
        [SerializeField] private LayerMask wallLayer;
        [SerializeField] private LayerMask collisionLayer;
        [SerializeField] private bool enableSemanticValidation = true;

        private List<FurnitureItem> placedFurniture = new List<FurnitureItem>();
        private FurnitureItem selectedFurniture;
        private FurnitureItem previewFurniture;
        private string currentPreviewModelPath;
        private FurnitureCategory currentPreviewCategory = FurnitureCategory.General;

        private SemanticRegionManager regionManager;

        public event Action<FurnitureItem> OnFurniturePlaced;
        public event Action<FurnitureItem> OnFurnitureSelected;
        public event Action OnFurnitureCleared;
        public event Action<FurnitureData, string> OnPlacementRejected;

        public IReadOnlyList<FurnitureItem> PlacedFurniture => placedFurniture;
        public FurnitureItem SelectedFurniture => selectedFurniture;
        public FurnitureItem PreviewFurniture => previewFurniture;
        public bool EnableSemanticValidation { get => enableSemanticValidation; set => enableSemanticValidation = value; }

        public void SetRegionManager(SemanticRegionManager manager)
        {
            regionManager = manager;
        }

        private void Awake()
        {
            if (furnitureContainer == null)
            {
                furnitureContainer = new GameObject("FurnitureContainer").transform;
                furnitureContainer.SetParent(transform);
            }
        }

        public bool LoadPreview(string modelPath)
        {
            return LoadPreview(modelPath, FurnitureCategory.General);
        }

        public bool LoadPreview(string modelPath, FurnitureCategory category)
        {
            if (!File.Exists(modelPath))
            {
                Debug.LogError($"Furniture model not found: {modelPath}");
                return false;
            }

            ClearPreview();

            OBJLoader loader = new OBJLoader();
            OBJLoader.LoadResult result = loader.Load(modelPath);

            if (result.Mesh == null)
            {
                Debug.LogError("Failed to load furniture model");
                return false;
            }

            GameObject previewObj = new GameObject("PreviewFurniture");
            previewObj.transform.SetParent(furnitureContainer, false);
            previewObj.layer = LayerMask.NameToLayer("Ignore Raycast");

            previewFurniture = previewObj.AddComponent<FurnitureItem>();

            FurnitureData data = new FurnitureData
            {
                Name = Path.GetFileNameWithoutExtension(modelPath),
                ModelPath = modelPath,
                OriginalSize = result.OriginalSize,
                Category = category
            };

            previewFurniture.Initialize(data, result.Mesh, result.Material);
            currentPreviewModelPath = modelPath;
            currentPreviewCategory = category;

            SetPreviewTransparent(true);

            return true;
        }

        public void UpdatePreviewPosition(Vector3 position, Quaternion rotation, Vector3 scale)
        {
            if (previewFurniture == null) return;

            previewFurniture.transform.position = position;
            previewFurniture.transform.rotation = rotation;
            previewFurniture.transform.localScale = scale;

            bool isCollisionValid = IsValidPlacement(position, rotation, scale);
            bool isSemanticValid = IsSemanticValidPlacement(position);

            SetPreviewValid(isCollisionValid && isSemanticValid);
        }

        public FurnitureItem PlaceFurniture(Vector3 position, Quaternion rotation, Vector3 scale)
        {
            if (previewFurniture == null) return null;

            if (!IsValidPlacement(position, rotation, scale))
            {
                Debug.LogWarning("Invalid furniture placement - colliding with objects");
                return null;
            }

            if (enableSemanticValidation && regionManager != null)
            {
                FurnitureData tempData = new FurnitureData
                {
                    Category = currentPreviewCategory,
                    Position = position
                };
                if (!regionManager.ValidateFurniturePlacement(tempData, position))
                {
                    return null;
                }
            }

            GameObject furnitureObj = new GameObject($"Furniture_{placedFurniture.Count}");
            furnitureObj.transform.SetParent(furnitureContainer, false);
            furnitureObj.layer = furnitureLayer.value;

            OBJLoader loader = new OBJLoader();
            OBJLoader.LoadResult result = loader.Load(currentPreviewModelPath);

            FurnitureItem furniture = furnitureObj.AddComponent<FurnitureItem>();

            FurnitureData data = new FurnitureData
            {
                Name = Path.GetFileNameWithoutExtension(currentPreviewModelPath),
                ModelPath = currentPreviewModelPath,
                Position = position,
                Rotation = rotation,
                Scale = scale,
                OriginalSize = result.OriginalSize,
                ActualSize = Vector3.Scale(result.OriginalSize, scale),
                Category = currentPreviewCategory
            };

            if (regionManager != null)
            {
                RoomRegion room = regionManager.FindRoomAtPosition(position);
                if (room != null)
                {
                    data.RoomId = room.Id;
                    data.AllowedRoomType = room.Type;
                }
            }

            furniture.Initialize(data, result.Mesh, result.Material);
            furniture.transform.position = position;
            furniture.transform.rotation = rotation;
            furniture.transform.localScale = scale;

            placedFurniture.Add(furniture);
            OnFurniturePlaced?.Invoke(furniture);

            return furniture;
        }

        public bool IsSemanticValidPlacement(Vector3 position)
        {
            if (!enableSemanticValidation || regionManager == null) return true;

            FurnitureData tempData = new FurnitureData
            {
                Category = currentPreviewCategory,
                Position = position
            };

            return regionManager.ValidateFurniturePlacement(tempData, position);
        }

        public string GetSemanticValidationMessage(Vector3 position)
        {
            if (!enableSemanticValidation || regionManager == null) return "";

            FurnitureData tempData = new FurnitureData
            {
                Category = currentPreviewCategory,
                Position = position
            };

            return regionManager.GetValidationMessage(tempData, position);
        }

        public void SetPreviewCategory(FurnitureCategory category)
        {
            currentPreviewCategory = category;
            if (previewFurniture != null)
            {
                previewFurniture.Data.Category = category;
            }
        }

        public List<FurnitureItem> GetFurnitureOnFloor(int floorIndex)
        {
            List<FurnitureItem> result = new List<FurnitureItem>();
            for (int i = 0; i < placedFurniture.Count; i++)
            {
                if (placedFurniture[i].Data.FloorIndex == floorIndex)
                    result.Add(placedFurniture[i]);
            }
            return result;
        }

        public List<FurnitureItem> GetFurnitureInRoom(string roomId)
        {
            List<FurnitureItem> result = new List<FurnitureItem>();
            for (int i = 0; i < placedFurniture.Count; i++)
            {
                if (placedFurniture[i].Data.RoomId == roomId)
                    result.Add(placedFurniture[i]);
            }
            return result;
        }

        public void SetFloorVisibility(int floorIndex, bool visible)
        {
            for (int i = 0; i < placedFurniture.Count; i++)
            {
                if (placedFurniture[i].Data.FloorIndex == floorIndex)
                {
                    placedFurniture[i].gameObject.SetActive(visible);
                }
            }
        }

        public void SelectFurniture(FurnitureItem furniture)
        {
            if (selectedFurniture != null)
            {
                selectedFurniture.SetHighlight(false);
            }

            selectedFurniture = furniture;

            if (selectedFurniture != null)
            {
                selectedFurniture.SetHighlight(true);
            }

            OnFurnitureSelected?.Invoke(selectedFurniture);
        }

        public void DeleteSelected()
        {
            if (selectedFurniture != null)
            {
                placedFurniture.Remove(selectedFurniture);
                Destroy(selectedFurniture.gameObject);
                selectedFurniture = null;
            }
        }

        public void ClearAllFurniture()
        {
            foreach (var furniture in placedFurniture)
            {
                if (furniture != null)
                {
                    Destroy(furniture.gameObject);
                }
            }

            placedFurniture.Clear();
            selectedFurniture = null;
            ClearPreview();
            OnFurnitureCleared?.Invoke();
        }

        public void ClearPreview()
        {
            if (previewFurniture != null)
            {
                Destroy(previewFurniture.gameObject);
                previewFurniture = null;
            }
            currentPreviewModelPath = null;
        }

        public bool IsValidPlacement(Vector3 position, Quaternion rotation, Vector3 scale)
        {
            if (previewFurniture == null) return false;

            return !previewFurniture.CheckCollision(position, rotation, scale, collisionLayer);
        }

        public List<FurnitureData> GetFurnitureDataList()
        {
            List<FurnitureData> dataList = new List<FurnitureData>();
            foreach (var furniture in placedFurniture)
            {
                furniture.SetDataFromTransform();
                dataList.Add(furniture.Data.Clone());
            }
            return dataList;
        }

        public void SetAllRenderMode(RenderMode mode)
        {
            foreach (var furniture in placedFurniture)
            {
                furniture.SetRenderMode(mode);
            }
            if (previewFurniture != null)
            {
                previewFurniture.SetRenderMode(mode);
            }
        }

        private void SetPreviewTransparent(bool transparent)
        {
            if (previewFurniture == null) return;

            Renderer[] renderers = previewFurniture.GetComponentsInChildren<Renderer>();
            foreach (var renderer in renderers)
            {
                if (transparent)
                {
                    renderer.material.SetFloat("_Alpha", 0.5f);
                }
                else
                {
                    renderer.material.SetFloat("_Alpha", 1f);
                }
            }
        }

        private void SetPreviewValid(bool isValid)
        {
            if (previewFurniture == null) return;

            Renderer[] renderers = previewFurniture.GetComponentsInChildren<Renderer>();
            foreach (var renderer in renderers)
            {
                Color color = isValid ? new Color(0.5f, 1f, 0.5f, 0.5f) : new Color(1f, 0.5f, 0.5f, 0.5f);
                renderer.material.SetColor("_BaseColor", color);
            }
        }

        public FurnitureItem RaycastSelect(Ray ray)
        {
            RaycastHit hit;
            if (Physics.Raycast(ray, out hit, Mathf.Infinity, furnitureLayer))
            {
                return hit.collider.GetComponentInParent<FurnitureItem>();
            }
            return null;
        }

        public bool RaycastWall(Ray ray, out RaycastHit hitInfo)
        {
            return Physics.Raycast(ray, out hitInfo, Mathf.Infinity, wallLayer);
        }

        public Vector3 CalculateAutoScale(Vector3 wallSize, Vector3 modelSize)
        {
            float scaleX = wallSize.x / Mathf.Max(modelSize.x, 0.001f);
            float scaleY = wallSize.y / Mathf.Max(modelSize.y, 0.001f);
            float scaleZ = wallSize.z / Mathf.Max(modelSize.z, 0.001f);

            float minScale = Mathf.Min(scaleX, Mathf.Min(scaleY, scaleZ));
            minScale = Mathf.Clamp(minScale, 0.1f, 5f);

            return Vector3.one * minScale;
        }

        public void MoveSelected(Vector3 delta)
        {
            if (selectedFurniture != null)
            {
                Vector3 newPos = selectedFurniture.transform.position + delta;

                if (!selectedFurniture.CheckCollision(newPos, selectedFurniture.transform.rotation, selectedFurniture.transform.localScale, collisionLayer))
                {
                    selectedFurniture.transform.position = newPos;
                }
            }
        }

        public void RotateSelected(float yAngle)
        {
            if (selectedFurniture != null)
            {
                Quaternion newRot = selectedFurniture.transform.rotation * Quaternion.Euler(0, yAngle, 0);

                if (!selectedFurniture.CheckCollision(selectedFurniture.transform.position, newRot, selectedFurniture.transform.localScale, collisionLayer))
                {
                    selectedFurniture.transform.rotation = newRot;
                }
            }
        }
    }
}
