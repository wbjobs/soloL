using System;
using System.Collections.Generic;
using UnityEngine;
using LiDARFurniturePlacer.Core;

namespace LiDARFurniturePlacer.Semantic
{
    public class SemanticRegionManager : MonoBehaviour
    {
        [SerializeField] private float roomDetectionGridSize = 0.5f;
        [SerializeField] private float minRoomArea = 4f;
        [SerializeField] private float wallThickness = 0.3f;
        [SerializeField] private float doorWidth = 0.9f;

        private List<RoomRegion> rooms = new List<RoomRegion>();
        private List<FurniturePlacementRule> placementRules = new List<FurniturePlacementRule>();
        private Dictionary<string, RoomRegion> roomById = new Dictionary<string, RoomRegion>();

        public IReadOnlyList<RoomRegion> Rooms => rooms;
        public IReadOnlyList<FurniturePlacementRule> PlacementRules => placementRules;

        public event Action<List<RoomRegion>> OnRoomsDetected;
        public event Action<FurnitureData, RoomRegion> OnFurniturePlacementValidated;
        public event Action<FurnitureData, string> OnFurniturePlacementRejected;

        private void Awake()
        {
            InitializeDefaultRules();
        }

        private void InitializeDefaultRules()
        {
            placementRules.Add(new FurniturePlacementRule
            {
                Category = FurnitureCategory.Sofa,
                AllowedRooms = new List<RoomType> { RoomType.LivingRoom, RoomType.Study, RoomType.Balcony },
                ForbiddenRooms = new List<RoomType> { RoomType.Bathroom, RoomType.Kitchen },
                MustBeAgainstWall = false,
                MinRoomArea = 8f,
                MaxWallDistance = 3f
            });

            placementRules.Add(new FurniturePlacementRule
            {
                Category = FurnitureCategory.Bed,
                AllowedRooms = new List<RoomType> { RoomType.Bedroom, RoomType.Study },
                ForbiddenRooms = new List<RoomType> { RoomType.Kitchen, RoomType.Bathroom, RoomType.Hallway },
                MustBeAgainstWall = true,
                MinRoomArea = 6f,
                MaxWallDistance = 0.5f
            });

            placementRules.Add(new FurniturePlacementRule
            {
                Category = FurnitureCategory.BathroomFixture,
                AllowedRooms = new List<RoomType> { RoomType.Bathroom },
                ForbiddenRooms = new List<RoomType> { RoomType.LivingRoom, RoomType.Bedroom, RoomType.Kitchen },
                MustBeAgainstWall = true,
                MinRoomArea = 2f,
                MaxWallDistance = 0.3f
            });

            placementRules.Add(new FurniturePlacementRule
            {
                Category = FurnitureCategory.KitchenFixture,
                AllowedRooms = new List<RoomType> { RoomType.Kitchen },
                ForbiddenRooms = new List<RoomType> { RoomType.Bathroom, RoomType.Bedroom },
                MustBeAgainstWall = true,
                MinRoomArea = 4f,
                MaxWallDistance = 0.5f
            });

            placementRules.Add(new FurniturePlacementRule
            {
                Category = FurnitureCategory.Table,
                AllowedRooms = new List<RoomType> { RoomType.LivingRoom, RoomType.Kitchen, RoomType.DiningRoom, RoomType.Study, RoomType.Bedroom },
                MustBeAgainstWall = false,
                MinRoomArea = 4f
            });

            placementRules.Add(new FurniturePlacementRule
            {
                Category = FurnitureCategory.Chair,
                AllowedRooms = new List<RoomType> { RoomType.LivingRoom, RoomType.Kitchen, RoomType.DiningRoom, RoomType.Study, RoomType.Bedroom },
                MustBeAgainstWall = false,
                MinRoomArea = 3f
            });

            placementRules.Add(new FurniturePlacementRule
            {
                Category = FurnitureCategory.Cabinet,
                AllowedRooms = new List<RoomType> { RoomType.LivingRoom, RoomType.Bedroom, RoomType.Kitchen, RoomType.Study, RoomType.Storage },
                MustBeAgainstWall = true,
                MinRoomArea = 3f,
                MaxWallDistance = 0.5f
            });

            placementRules.Add(new FurniturePlacementRule
            {
                Category = FurnitureCategory.Appliance,
                AllowedRooms = new List<RoomType> { RoomType.Kitchen, RoomType.LivingRoom },
                ForbiddenRooms = new List<RoomType> { RoomType.Bathroom },
                MustBeAgainstWall = true,
                MinRoomArea = 4f,
                MaxWallDistance = 0.3f
            });

            placementRules.Add(new FurniturePlacementRule
            {
                Category = FurnitureCategory.Lighting,
                MustBeAgainstWall = false,
                MinRoomArea = 1f
            });

            placementRules.Add(new FurniturePlacementRule
            {
                Category = FurnitureCategory.Decor,
                MustBeAgainstWall = false,
                MinRoomArea = 1f
            });
        }

        public List<RoomRegion> DetectRooms(PointCloudData pointCloud, SemanticLabel[] labels, float floorY, float floorHeight)
        {
            if (pointCloud == null || labels == null) return new List<RoomRegion>();

            rooms.Clear();
            roomById.Clear();

            List<int> wallIndices = new List<int>();
            List<int> floorIndices = new List<int>();
            List<int> doorIndices = new List<int>();

            for (int i = 0; i < labels.Length; i++)
            {
                if (labels[i] == SemanticLabel.Wall) wallIndices.Add(i);
                else if (labels[i] == SemanticLabel.Floor) floorIndices.Add(i);
                else if (labels[i] == SemanticLabel.Door) doorIndices.Add(i);
            }

            if (floorIndices.Count == 0)
            {
                Debug.LogWarning("No floor points found for room detection");
                return rooms;
            }

            Bounds pcBounds = pointCloud.GetBounds();
            Vector3 min = pcBounds.min;
            Vector3 max = pcBounds.max;

            int gridX = Mathf.CeilToInt((max.x - min.x) / roomDetectionGridSize);
            int gridZ = Mathf.CeilToInt((max.z - min.z) / roomDetectionGridSize);

            bool[,] occupancyGrid = new bool[gridX, gridZ];
            bool[,] wallGrid = new bool[gridX, gridZ];

            for (int i = 0; i < floorIndices.Count; i++)
            {
                Vector3 p = pointCloud.Vertices[floorIndices[i]];
                int gx = Mathf.Clamp(Mathf.FloorToInt((p.x - min.x) / roomDetectionGridSize), 0, gridX - 1);
                int gz = Mathf.Clamp(Mathf.FloorToInt((p.z - min.z) / roomDetectionGridSize), 0, gridZ - 1);
                occupancyGrid[gx, gz] = true;
            }

            for (int i = 0; i < wallIndices.Count; i++)
            {
                Vector3 p = pointCloud.Vertices[wallIndices[i]];
                if (Mathf.Abs(p.y - floorY - floorHeight * 0.5f) > floorHeight * 0.6f) continue;
                int gx = Mathf.Clamp(Mathf.FloorToInt((p.x - min.x) / roomDetectionGridSize), 0, gridX - 1);
                int gz = Mathf.Clamp(Mathf.FloorToInt((p.z - min.z) / roomDetectionGridSize), 0, gridZ - 1);
                wallGrid[gx, gz] = true;
            }

            bool[,] visited = new bool[gridX, gridZ];
            List<List<Vector2Int>> roomRegions = new List<List<Vector2Int>>();

            for (int x = 0; x < gridX; x++)
            {
                for (int z = 0; z < gridZ; z++)
                {
                    if (visited[x, z] || !occupancyGrid[x, z] || wallGrid[x, z]) continue;

                    List<Vector2Int> region = FloodFill(occupancyGrid, wallGrid, visited, x, z, gridX, gridZ);
                    if (region.Count * roomDetectionGridSize * roomDetectionGridSize >= minRoomArea)
                    {
                        roomRegions.Add(region);
                    }
                }
            }

            for (int r = 0; r < roomRegions.Count; r++)
            {
                RoomRegion room = new RoomRegion();
                List<Vector2Int> region = roomRegions[r];

                Vector3 roomMin = new Vector3(float.MaxValue, floorY, float.MaxValue);
                Vector3 roomMax = new Vector3(float.MinValue, floorY + floorHeight, float.MinValue);

                room.FloorPolygon = new List<Vector3>();
                Vector3 center = Vector3.zero;

                for (int i = 0; i < region.Count; i++)
                {
                    Vector3 worldPos = new Vector3(
                        min.x + (region[i].x + 0.5f) * roomDetectionGridSize,
                        floorY,
                        min.z + (region[i].y + 0.5f) * roomDetectionGridSize);

                    center += worldPos;

                    if (worldPos.x < roomMin.x) roomMin.x = worldPos.x;
                    if (worldPos.z < roomMin.z) roomMin.z = worldPos.z;
                    if (worldPos.x > roomMax.x) roomMax.x = worldPos.x;
                    if (worldPos.z > roomMax.z) roomMax.z = worldPos.z;
                }

                center /= region.Count;
                room.Center = center;
                room.Bounds = new Bounds((roomMin + roomMax) * 0.5f, roomMax - roomMin);
                room.Size = roomMax - roomMin;

                Vector2Int hullStart = region[0];
                for (int i = 1; i < region.Count; i++)
                {
                    if (region[i].x < hullStart.x || (region[i].x == hullStart.x && region[i].y < hullStart.y))
                        hullStart = region[i];
                }

                List<Vector3> convexHull = ComputeConvexHull(region, min);
                room.FloorPolygon = convexHull;
                room.ComputeArea();

                room.HasDoor = CheckRoomHasDoor(pointCloud, doorIndices, room.Bounds, floorY, floorHeight);
                room.HasWindow = CheckRoomHasWindow(labels, pointCloud, room.Bounds, floorY, floorHeight);

                room.Type = ClassifyRoom(room);

                rooms.Add(room);
                roomById[room.Id] = room;
            }

            DetectConnectedRooms();

            OnRoomsDetected?.Invoke(rooms);
            return rooms;
        }

        private List<Vector2Int> FloodFill(bool[,] occupancy, bool[,] wall, bool[,] visited, int startX, int startZ, int sizeX, int sizeZ)
        {
            List<Vector2Int> region = new List<Vector2Int>();
            Queue<Vector2Int> queue = new Queue<Vector2Int>();
            queue.Enqueue(new Vector2Int(startX, startZ));
            visited[startX, startZ] = true;

            while (queue.Count > 0)
            {
                Vector2Int current = queue.Dequeue();
                region.Add(current);

                int[] dx = { 1, -1, 0, 0 };
                int[] dz = { 0, 0, 1, -1 };

                for (int d = 0; d < 4; d++)
                {
                    int nx = current.x + dx[d];
                    int nz = current.y + dz[d];

                    if (nx < 0 || nx >= sizeX || nz < 0 || nz >= sizeZ) continue;
                    if (visited[nx, nz]) continue;
                    if (!occupancy[nx, nz]) continue;

                    visited[nx, nz] = true;

                    if (!wall[nx, nz])
                    {
                        queue.Enqueue(new Vector2Int(nx, nz));
                    }
                }
            }

            return region;
        }

        private List<Vector3> ComputeConvexHull(List<Vector2Int> gridPoints, Vector3 origin)
        {
            List<Vector3> worldPoints = new List<Vector3>();
            for (int i = 0; i < gridPoints.Count; i++)
            {
                worldPoints.Add(new Vector3(
                    origin.x + (gridPoints[i].x + 0.5f) * roomDetectionGridSize,
                    0,
                    origin.z + (gridPoints[i].y + 0.5f) * roomDetectionGridSize));
            }

            if (worldPoints.Count <= 3) return worldPoints;

            List<Vector3> hull = new List<Vector3>();
            int leftmost = 0;
            for (int i = 1; i < worldPoints.Count; i++)
            {
                if (worldPoints[i].x < worldPoints[leftmost].x)
                    leftmost = i;
            }

            int current = leftmost;
            do
            {
                hull.Add(worldPoints[current]);
                int next = 0;

                for (int i = 0; i < worldPoints.Count; i++)
                {
                    if (i == current) continue;
                    if (next == current)
                    {
                        next = i;
                        continue;
                    }

                    float cross = Cross2D(
                        worldPoints[current].x, worldPoints[current].z,
                        worldPoints[next].x, worldPoints[next].z,
                        worldPoints[i].x, worldPoints[i].z);

                    if (cross < 0)
                        next = i;
                }

                current = next;

                if (hull.Count > worldPoints.Count) break;

            } while (current != leftmost);

            return hull;
        }

        private float Cross2D(float ax, float ay, float bx, float by, float cx, float cy)
        {
            return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        }

        private RoomType ClassifyRoom(RoomRegion room)
        {
            float area = room.Area;
            float aspectRatio = Mathf.Max(room.Size.x, room.Size.z) / (Mathf.Min(room.Size.x, room.Size.z) + 0.001f);

            if (aspectRatio > 3f && area < 10f)
                return RoomType.Hallway;

            if (room.HasWindow && area > 12f)
                return RoomType.LivingRoom;

            if (room.HasWindow && area > 8f && area <= 15f)
                return RoomType.Bedroom;

            if (area < 6f && !room.HasWindow)
                return RoomType.Bathroom;

            if (area > 5f && area < 15f && !room.HasWindow)
                return RoomType.Kitchen;

            if (area > 8f && area <= 15f)
                return RoomType.DiningRoom;

            if (area > 6f && room.HasWindow)
                return RoomType.Study;

            if (area < 4f)
                return RoomType.Storage;

            return RoomType.LivingRoom;
        }

        private bool CheckRoomHasDoor(PointCloudData pointCloud, List<int> doorIndices, Bounds roomBounds, float floorY, float floorHeight)
        {
            for (int i = 0; i < doorIndices.Count; i++)
            {
                Vector3 p = pointCloud.Vertices[doorIndices[i]];
                if (p.y >= floorY && p.y <= floorY + floorHeight)
                {
                    Vector3 pXZ = new Vector3(p.x, roomBounds.center.y, p.z);
                    if (roomBounds.Contains(pXZ))
                        return true;
                }
            }
            return false;
        }

        private bool CheckRoomHasWindow(SemanticLabel[] labels, PointCloudData pointCloud, Bounds roomBounds, float floorY, float floorHeight)
        {
            int windowCount = 0;
            for (int i = 0; i < labels.Length; i++)
            {
                if (labels[i] != SemanticLabel.Window) continue;
                Vector3 p = pointCloud.Vertices[i];
                if (p.y >= floorY && p.y <= floorY + floorHeight)
                {
                    Vector3 pXZ = new Vector3(p.x, roomBounds.center.y, p.z);
                    if (roomBounds.Contains(pXZ))
                    {
                        windowCount++;
                        if (windowCount > 10) return true;
                    }
                }
            }
            return windowCount > 5;
        }

        private void DetectConnectedRooms()
        {
            for (int i = 0; i < rooms.Count; i++)
            {
                for (int j = i + 1; j < rooms.Count; j++)
                {
                    if (AreRoomsConnected(rooms[i], rooms[j]))
                    {
                        rooms[i].ConnectedRoomIds.Add(rooms[j].Id);
                        rooms[j].ConnectedRoomIds.Add(rooms[i].Id);
                    }
                }
            }
        }

        private bool AreRoomsConnected(RoomRegion a, RoomRegion b)
        {
            float distance = Vector3.Distance(
                new Vector3(a.Center.x, 0, a.Center.z),
                new Vector3(b.Center.x, 0, b.Center.z));

            float maxDist = (a.Size.x + a.Size.z + b.Size.x + b.Size.z) * 0.5f;
            if (distance > maxDist) return false;

            Bounds expandedA = a.Bounds;
            expandedA.Expand(wallThickness * 2f);
            if (expandedA.Intersects(b.Bounds))
                return true;

            return false;
        }

        public bool ValidateFurniturePlacement(FurnitureData furniture, Vector3 position)
        {
            RoomRegion room = FindRoomAtPosition(position);
            if (room == null)
            {
                OnFurniturePlacementRejected?.Invoke(furniture, "位置不在任何已识别的房间区域内");
                return true;
            }

            FurniturePlacementRule rule = GetRuleForCategory(furniture.Category);
            if (rule == null)
            {
                furniture.RoomId = room.Id;
                furniture.AllowedRoomType = room.Type;
                OnFurniturePlacementValidated?.Invoke(furniture, room);
                return true;
            }

            if (!rule.IsAllowedInRoom(room.Type))
            {
                string reason = $"{RoomTypeNames.GetDisplayName(furniture.Category)}不允许放置在{RoomTypeNames.GetDisplayName(room.Type)}";
                OnFurniturePlacementRejected?.Invoke(furniture, reason);
                return false;
            }

            if (room.Area < rule.MinRoomArea)
            {
                string reason = $"房间面积({room.Area:F1}m²)小于该家具所需最小面积({rule.MinRoomArea:F1}m²)";
                OnFurniturePlacementRejected?.Invoke(furniture, reason);
                return false;
            }

            furniture.RoomId = room.Id;
            furniture.AllowedRoomType = room.Type;
            OnFurniturePlacementValidated?.Invoke(furniture, room);
            return true;
        }

        public string GetValidationMessage(FurnitureData furniture, Vector3 position)
        {
            RoomRegion room = FindRoomAtPosition(position);
            if (room == null) return "";

            FurniturePlacementRule rule = GetRuleForCategory(furniture.Category);
            if (rule == null) return "";

            if (!rule.IsAllowedInRoom(room.Type))
            {
                return $"{RoomTypeNames.GetDisplayName(furniture.Category)}不允许放置在{RoomTypeNames.GetDisplayName(room.Type)}";
            }

            if (room.Area < rule.MinRoomArea)
            {
                return $"房间面积不足";
            }

            return "";
        }

        public RoomRegion FindRoomAtPosition(Vector3 position)
        {
            for (int i = 0; i < rooms.Count; i++)
            {
                if (rooms[i].ContainsPoint(position))
                    return rooms[i];
            }
            return null;
        }

        public RoomRegion FindRoomById(string id)
        {
            roomById.TryGetValue(id, out RoomRegion room);
            return room;
        }

        public List<RoomRegion> GetRoomsByType(RoomType type)
        {
            List<RoomRegion> result = new List<RoomRegion>();
            for (int i = 0; i < rooms.Count; i++)
            {
                if (rooms[i].Type == type)
                    result.Add(rooms[i]);
            }
            return result;
        }

        public FurniturePlacementRule GetRuleForCategory(FurnitureCategory category)
        {
            for (int i = 0; i < placementRules.Count; i++)
            {
                if (placementRules[i].Category == category)
                    return placementRules[i];
            }
            return null;
        }

        public void AddPlacementRule(FurniturePlacementRule rule)
        {
            for (int i = 0; i < placementRules.Count; i++)
            {
                if (placementRules[i].Category == rule.Category)
                {
                    placementRules[i] = rule;
                    return;
                }
            }
            placementRules.Add(rule);
        }

        public void SetRoomType(string roomId, RoomType type)
        {
            if (roomById.TryGetValue(roomId, out RoomRegion room))
            {
                room.Type = type;
            }
        }

        public void VisualizeRooms()
        {
            for (int i = 0; i < rooms.Count; i++)
            {
                RoomRegion room = rooms[i];
                GameObject visObj = GameObject.Find($"RoomVis_{room.Id}");
                if (visObj != null) Destroy(visObj);

                visObj = GameObject.CreatePrimitive(PrimitiveType.Cube);
                visObj.name = $"RoomVis_{room.Id}";
                visObj.transform.position = room.Center + Vector3.up * 1f;
                visObj.transform.localScale = new Vector3(room.Size.x, 0.1f, room.Size.z);

                Renderer renderer = visObj.GetComponent<Renderer>();
                Color roomColor = GetRoomTypeColor(room.Type);
                roomColor.a = 0.2f;
                renderer.material.color = roomColor;
                renderer.material.SetInt("_SrcBlend", (int)UnityEngine.Rendering.BlendMode.SrcAlpha);
                renderer.material.SetInt("_DstBlend", (int)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
                renderer.material.SetInt("_ZWrite", 0);
                renderer.material.renderQueue = 3000;

                Collider col = visObj.GetComponent<Collider>();
                if (col != null) Destroy(col);
            }
        }

        private Color GetRoomTypeColor(RoomType type)
        {
            switch (type)
            {
                case RoomType.LivingRoom: return new Color(0.2f, 0.6f, 0.8f);
                case RoomType.Bedroom: return new Color(0.5f, 0.3f, 0.8f);
                case RoomType.Kitchen: return new Color(0.8f, 0.5f, 0.2f);
                case RoomType.Bathroom: return new Color(0.2f, 0.7f, 0.5f);
                case RoomType.DiningRoom: return new Color(0.8f, 0.3f, 0.3f);
                case RoomType.Study: return new Color(0.3f, 0.5f, 0.7f);
                case RoomType.Hallway: return new Color(0.6f, 0.6f, 0.6f);
                default: return new Color(0.5f, 0.5f, 0.5f);
            }
        }

        public void ClearRooms()
        {
            rooms.Clear();
            roomById.Clear();

            for (int i = transform.childCount - 1; i >= 0; i--)
            {
                Transform child = transform.GetChild(i);
                if (child.name.StartsWith("RoomVis_"))
                    Destroy(child.gameObject);
            }
        }
    }
}
