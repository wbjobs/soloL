using System;
using System.Collections.Generic;
using UnityEngine;
using LiDARFurniturePlacer.Core;
using LiDARFurniturePlacer.Semantic;
using LiDARFurniturePlacer.PointCloud;

namespace LiDARFurniturePlacer.Floor
{
    public class FloorManager : MonoBehaviour
    {
        [SerializeField] private float floorDetectionTolerance = 0.3f;
        [SerializeField] private float minFloorHeight = 2.2f;
        [SerializeField] private float stairVoidMinSize = 0.8f;
        [SerializeField] private float stairVoidMaxSize = 3f;
        [SerializeField] private float defaultFloorThickness = 0.2f;
        [SerializeField] private bool showFloorBoundaries = true;

        private List<FloorData> floors = new List<FloorData>();
        private int currentFloorIndex = -1;
        private PointCloudData originalPointCloud;
        private Dictionary<int, PointCloudRenderer> floorRenderers = new Dictionary<int, PointCloudRenderer>();

        public IReadOnlyList<FloorData> Floors => floors;
        public int CurrentFloorIndex => currentFloorIndex;
        public FloorData CurrentFloor => currentFloorIndex >= 0 && currentFloorIndex < floors.Count ? floors[currentFloorIndex] : null;
        public int FloorCount => floors.Count;

        public event Action<int, FloorData> OnFloorSwitched;
        public event Action<List<FloorData>> OnFloorsDetected;
        public event Action<StairVoid> OnStairVoidDetected;

        public List<FloorData> DetectFloors(PointCloudData pointCloud, SemanticLabel[] semanticLabels)
        {
            if (pointCloud == null || pointCloud.PointCount == 0)
            {
                Debug.LogError("Cannot detect floors from null point cloud");
                return new List<FloorData>();
            }

            originalPointCloud = pointCloud;
            floors.Clear();
            ClearFloorRenderers();

            Bounds bounds = pointCloud.GetBounds();
            float totalHeight = bounds.max.y - bounds.min.y;

            List<float> floorHeights = DetectFloorPlanes(pointCloud, semanticLabels);
            if (floorHeights.Count == 0)
            {
                floorHeights = DetectFloorPlanesByHistogram(pointCloud);
            }

            if (floorHeights.Count == 0)
            {
                FloorData singleFloor = new FloorData
                {
                    FloorIndex = 0,
                    MinHeight = bounds.min.y,
                    MaxHeight = bounds.max.y,
                    FloorThickness = defaultFloorThickness,
                    IsVisible = true
                };
                singleFloor.PointCloud = pointCloud;
                singleFloor.FloorBounds = bounds;
                floors.Add(singleFloor);
            }
            else
            {
                floorHeights.Sort();

                for (int i = 0; i < floorHeights.Count; i++)
                {
                    float floorY = floorHeights[i];
                    float nextFloorY = (i + 1 < floorHeights.Count) ? floorHeights[i + 1] : bounds.max.y;
                    float ceilingY = nextFloorY - defaultFloorThickness;

                    if (ceilingY - floorY < minFloorHeight) continue;

                    FloorData floor = new FloorData
                    {
                        FloorIndex = floors.Count,
                        MinHeight = floorY,
                        MaxHeight = ceilingY,
                        FloorThickness = defaultFloorThickness,
                        IsVisible = i == 0
                    };

                    List<int> floorPointIndices = new List<int>();
                    for (int j = 0; j < pointCloud.PointCount; j++)
                    {
                        if (pointCloud.Vertices[j].y >= floorY - floorDetectionTolerance &&
                            pointCloud.Vertices[j].y <= ceilingY + floorDetectionTolerance)
                        {
                            floorPointIndices.Add(j);
                        }
                    }

                    if (floorPointIndices.Count > 0)
                    {
                        floor.PointCloud = pointCloud.ExtractSubset(floorPointIndices.ToArray());
                    }

                    floor.FloorBounds = new Bounds(
                        new Vector3(bounds.center.x, (floorY + ceilingY) * 0.5f, bounds.center.z),
                        new Vector3(bounds.size.x, ceilingY - floorY, bounds.size.z));

                    floors.Add(floor);
                }
            }

            for (int i = 0; i < floors.Count; i++)
            {
                DetectStairVoids(floors[i], pointCloud, semanticLabels);
            }

            if (floors.Count > 0)
            {
                currentFloorIndex = 0;
            }

            OnFloorsDetected?.Invoke(floors);
            return floors;
        }

        private List<float> DetectFloorPlanes(PointCloudData pointCloud, SemanticLabel[] labels)
        {
            List<float> floorHeights = new List<float>();

            if (labels == null || labels.Length != pointCloud.PointCount)
                return floorHeights;

            Dictionary<int, int> heightBuckets = new Dictionary<int, int>();
            float bucketSize = 0.1f;

            for (int i = 0; i < pointCloud.PointCount; i++)
            {
                if (labels[i] != SemanticLabel.Floor) continue;

                int bucket = Mathf.RoundToInt(pointCloud.Vertices[i].y / bucketSize);
                if (heightBuckets.ContainsKey(bucket))
                    heightBuckets[bucket]++;
                else
                    heightBuckets[bucket] = 1;
            }

            if (heightBuckets.Count == 0) return floorHeights;

            int maxCount = 0;
            foreach (var kvp in heightBuckets)
            {
                if (kvp.Value > maxCount) maxCount = kvp.Value;
            }

            int threshold = Mathf.Max(10, maxCount / 20);

            List<int> sortedBuckets = new List<int>(heightBuckets.Keys);
            sortedBuckets.Sort();

            int? currentPeakBucket = null;
            int currentPeakCount = 0;

            for (int i = 0; i < sortedBuckets.Count; i++)
            {
                int bucket = sortedBuckets[i];
                int count = heightBuckets[bucket];

                if (count >= threshold)
                {
                    if (currentPeakBucket == null || count > currentPeakCount)
                    {
                        currentPeakBucket = bucket;
                        currentPeakCount = count;
                    }
                }
                else
                {
                    if (currentPeakBucket.HasValue)
                    {
                        float height = currentPeakBucket.Value * bucketSize;
                        bool isDuplicate = false;
                        for (int j = 0; j < floorHeights.Count; j++)
                        {
                            if (Mathf.Abs(floorHeights[j] - height) < minFloorHeight)
                            {
                                isDuplicate = true;
                                break;
                            }
                        }
                        if (!isDuplicate)
                        {
                            floorHeights.Add(height);
                        }
                        currentPeakBucket = null;
                        currentPeakCount = 0;
                    }
                }
            }

            if (currentPeakBucket.HasValue)
            {
                float height = currentPeakBucket.Value * bucketSize;
                bool isDuplicate = false;
                for (int j = 0; j < floorHeights.Count; j++)
                {
                    if (Mathf.Abs(floorHeights[j] - height) < minFloorHeight)
                    {
                        isDuplicate = true;
                        break;
                    }
                }
                if (!isDuplicate)
                {
                    floorHeights.Add(height);
                }
            }

            return floorHeights;
        }

        private List<float> DetectFloorPlanesByHistogram(PointCloudData pointCloud)
        {
            List<float> floorHeights = new List<float>();

            Bounds bounds = pointCloud.GetBounds();
            float bucketSize = 0.1f;
            int numBuckets = Mathf.CeilToInt((bounds.max.y - bounds.min.y) / bucketSize);
            if (numBuckets <= 0) return floorHeights;

            int[] histogram = new int[numBuckets];
            for (int i = 0; i < pointCloud.PointCount; i++)
            {
                int bucket = Mathf.Clamp(
                    Mathf.FloorToInt((pointCloud.Vertices[i].y - bounds.min.y) / bucketSize),
                    0, numBuckets - 1);
                histogram[bucket]++;
            }

            float avgDensity = (float)pointCloud.PointCount / numBuckets;
            float floorThreshold = avgDensity * 2f;

            bool inPeak = false;
            int peakStart = 0;
            int peakMaxBucket = 0;
            int peakMaxCount = 0;

            for (int i = 0; i < numBuckets; i++)
            {
                if (histogram[i] >= floorThreshold)
                {
                    if (!inPeak)
                    {
                        inPeak = true;
                        peakStart = i;
                        peakMaxBucket = i;
                        peakMaxCount = histogram[i];
                    }
                    else if (histogram[i] > peakMaxCount)
                    {
                        peakMaxBucket = i;
                        peakMaxCount = histogram[i];
                    }
                }
                else
                {
                    if (inPeak)
                    {
                        float height = bounds.min.y + peakMaxBucket * bucketSize;
                        bool isDuplicate = false;
                        for (int j = 0; j < floorHeights.Count; j++)
                        {
                            if (Mathf.Abs(floorHeights[j] - height) < minFloorHeight)
                            {
                                isDuplicate = true;
                                break;
                            }
                        }
                        if (!isDuplicate)
                        {
                            floorHeights.Add(height);
                        }
                        inPeak = false;
                    }
                }
            }

            if (inPeak)
            {
                float height = bounds.min.y + peakMaxBucket * bucketSize;
                bool isDuplicate = false;
                for (int j = 0; j < floorHeights.Count; j++)
                {
                    if (Mathf.Abs(floorHeights[j] - height) < minFloorHeight)
                    {
                        isDuplicate = true;
                        break;
                    }
                }
                if (!isDuplicate)
                {
                    floorHeights.Add(height);
                }
            }

            return floorHeights;
        }

        private void DetectStairVoids(FloorData floor, PointCloudData fullPointCloud, SemanticLabel[] labels)
        {
            if (floor.FloorIndex >= floors.Count - 1 && floors.Count <= 1) return;

            List<Vector3> stairPoints = new List<Vector3>();

            if (labels != null && labels.Length == fullPointCloud.PointCount)
            {
                for (int i = 0; i < fullPointCloud.PointCount; i++)
                {
                    if (labels[i] == SemanticLabel.Stair &&
                        fullPointCloud.Vertices[i].y >= floor.MinHeight &&
                        fullPointCloud.Vertices[i].y <= floor.MaxHeight)
                    {
                        stairPoints.Add(fullPointCloud.Vertices[i]);
                    }
                }
            }

            if (stairPoints.Count < 10)
            {
                DetectStairVoidsByGeometry(floor, fullPointCloud);
                return;
            }

            Vector3 center = Vector3.zero;
            Vector3 min = new Vector3(float.MaxValue, float.MaxValue, float.MaxValue);
            Vector3 max = new Vector3(float.MinValue, float.MinValue, float.MinValue);

            for (int i = 0; i < stairPoints.Count; i++)
            {
                center += stairPoints[i];
                min = Vector3.Min(min, stairPoints[i]);
                max = Vector3.Max(max, stairPoints[i]);
            }
            center /= stairPoints.Count;

            Vector3 size = max - min;
            size.x = Mathf.Clamp(size.x, stairVoidMinSize, stairVoidMaxSize);
            size.z = Mathf.Clamp(size.z, stairVoidMinSize, stairVoidMaxSize);

            StairVoid stairVoid = new StairVoid
            {
                Center = center,
                Size = size,
                Rotation = Quaternion.identity,
                FromFloor = floor.FloorIndex,
                ToFloor = floor.FloorIndex + 1,
                MinHeight = floor.MinHeight,
                MaxHeight = floor.FloorIndex + 1 < floors.Count
                    ? floors[floor.FloorIndex + 1].MaxHeight
                    : floor.MaxHeight + minFloorHeight,
                Bounds = new Bounds(center, size)
            };

            floor.StairVoids.Add(stairVoid);
            OnStairVoidDetected?.Invoke(stairVoid);
        }

        private void DetectStairVoidsByGeometry(FloorData floor, PointCloudData fullPointCloud)
        {
            if (floor.FloorIndex >= floors.Count - 1 && floors.Count <= 1) return;

            float midHeight = (floor.MaxHeight + floor.MinHeight) * 0.5f;
            float searchRange = floor.FloorThickness * 2f + floorDetectionTolerance;

            List<Vector3> ceilingPoints = new List<Vector3>();
            List<Vector3> aboveFloorPoints = new List<Vector3>();

            for (int i = 0; i < fullPointCloud.PointCount; i++)
            {
                float y = fullPointCloud.Vertices[i].y;

                if (y >= floor.MaxHeight - searchRange && y <= floor.MaxHeight + searchRange)
                {
                    ceilingPoints.Add(fullPointCloud.Vertices[i]);
                }

                if (y >= floor.MaxHeight && y <= floor.MaxHeight + minFloorHeight)
                {
                    aboveFloorPoints.Add(fullPointCloud.Vertices[i]);
                }
            }

            if (ceilingPoints.Count < 50) return;

            float cellSize = 0.3f;
            Bounds bounds = floor.FloorBounds;
            int gridX = Mathf.CeilToInt(bounds.size.x / cellSize);
            int gridZ = Mathf.CeilToInt(bounds.size.z / cellSize);

            int[,] ceilingDensity = new int[gridX, gridZ];
            int[,] aboveDensity = new int[gridX, gridZ];

            for (int i = 0; i < ceilingPoints.Count; i++)
            {
                int gx = Mathf.Clamp(Mathf.FloorToInt((ceilingPoints[i].x - bounds.min.x) / cellSize), 0, gridX - 1);
                int gz = Mathf.Clamp(Mathf.FloorToInt((ceilingPoints[i].z - bounds.min.z) / cellSize), 0, gridZ - 1);
                ceilingDensity[gx, gz]++;
            }

            for (int i = 0; i < aboveFloorPoints.Count; i++)
            {
                int gx = Mathf.Clamp(Mathf.FloorToInt((aboveFloorPoints[i].x - bounds.min.x) / cellSize), 0, gridX - 1);
                int gz = Mathf.Clamp(Mathf.FloorToInt((aboveFloorPoints[i].z - bounds.min.z) / cellSize), 0, gridZ - 1);
                aboveDensity[gx, gz]++;
            }

            float avgCeilingDensity = (float)ceilingPoints.Count / (gridX * gridZ);
            int voidThreshold = Mathf.Max(1, (int)(avgCeilingDensity * 0.15f));

            bool[,] visited = new bool[gridX, gridZ];
            List<List<Vector2Int>> voidRegions = new List<List<Vector2Int>>();

            for (int x = 0; x < gridX; x++)
            {
                for (int z = 0; z < gridZ; z++)
                {
                    if (visited[x, z]) continue;
                    if (ceilingDensity[x, z] > voidThreshold) continue;

                    List<Vector2Int> region = FloodFillVoid(ceilingDensity, visited, x, z, gridX, gridZ, voidThreshold);

                    if (region.Count * cellSize * cellSize >= stairVoidMinSize * stairVoidMinSize &&
                        region.Count * cellSize * cellSize <= stairVoidMaxSize * stairVoidMaxSize * 2)
                    {
                        voidRegions.Add(region);
                    }
                }
            }

            for (int r = 0; r < voidRegions.Count; r++)
            {
                List<Vector2Int> region = voidRegions[r];
                Vector3 voidMin = new Vector3(float.MaxValue, floor.MaxHeight - searchRange, float.MaxValue);
                Vector3 voidMax = new Vector3(float.MinValue, floor.MaxHeight + searchRange, float.MinValue);

                for (int i = 0; i < region.Count; i++)
                {
                    float wx = bounds.min.x + (region[i].x + 0.5f) * cellSize;
                    float wz = bounds.min.z + (region[i].y + 0.5f) * cellSize;
                    if (wx < voidMin.x) voidMin.x = wx;
                    if (wz < voidMin.z) voidMin.z = wz;
                    if (wx > voidMax.x) voidMax.x = wx;
                    if (wz > voidMax.z) voidMax.z = wz;
                }

                StairVoid stairVoid = new StairVoid
                {
                    Center = (voidMin + voidMax) * 0.5f,
                    Size = voidMax - voidMin + Vector3.one * cellSize,
                    Rotation = Quaternion.identity,
                    FromFloor = floor.FloorIndex,
                    ToFloor = floor.FloorIndex + 1,
                    MinHeight = voidMin.y,
                    MaxHeight = voidMax.y + minFloorHeight,
                    Bounds = new Bounds((voidMin + voidMax) * 0.5f, voidMax - voidMin)
                };

                floor.StairVoids.Add(stairVoid);
                OnStairVoidDetected?.Invoke(stairVoid);
            }
        }

        private List<Vector2Int> FloodFillVoid(int[,] density, bool[,] visited, int startX, int startZ, int sizeX, int sizeZ, int threshold)
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
                    if (density[nx, nz] > threshold) continue;

                    visited[nx, nz] = true;
                    queue.Enqueue(new Vector2Int(nx, nz));
                }
            }

            return region;
        }

        public void SwitchFloor(int floorIndex)
        {
            if (floorIndex < 0 || floorIndex >= floors.Count) return;

            if (currentFloorIndex >= 0 && currentFloorIndex < floors.Count)
            {
                floors[currentFloorIndex].IsVisible = false;
                HideFloorRenderer(currentFloorIndex);
            }

            currentFloorIndex = floorIndex;
            floors[currentFloorIndex].IsVisible = true;
            ShowFloorRenderer(currentFloorIndex);

            OnFloorSwitched?.Invoke(currentFloorIndex, floors[currentFloorIndex]);
        }

        public void SwitchToNextFloor()
        {
            if (floors.Count <= 1) return;
            int nextFloor = (currentFloorIndex + 1) % floors.Count;
            SwitchFloor(nextFloor);
        }

        public void SwitchToPreviousFloor()
        {
            if (floors.Count <= 1) return;
            int prevFloor = (currentFloorIndex - 1 + floors.Count) % floors.Count;
            SwitchFloor(prevFloor);
        }

        public void ShowAllFloors()
        {
            for (int i = 0; i < floors.Count; i++)
            {
                floors[i].IsVisible = true;
                ShowFloorRenderer(i);
            }
        }

        public void ShowOnlyCurrentFloor()
        {
            for (int i = 0; i < floors.Count; i++)
            {
                floors[i].IsVisible = (i == currentFloorIndex);
                if (i == currentFloorIndex)
                    ShowFloorRenderer(i);
                else
                    HideFloorRenderer(i);
            }
        }

        public FloorData GetFloor(int index)
        {
            if (index < 0 || index >= floors.Count) return null;
            return floors[index];
        }

        public int GetFloorIndexAtHeight(float height)
        {
            for (int i = 0; i < floors.Count; i++)
            {
                if (height >= floors[i].MinHeight - floorDetectionTolerance &&
                    height <= floors[i].MaxHeight + floorDetectionTolerance)
                {
                    return i;
                }
            }
            return -1;
        }

        public bool IsPositionOnCurrentFloor(Vector3 position)
        {
            if (currentFloorIndex < 0 || currentFloorIndex >= floors.Count) return false;
            FloorData floor = floors[currentFloorIndex];
            return position.y >= floor.MinHeight - floorDetectionTolerance &&
                   position.y <= floor.MaxHeight + floorDetectionTolerance;
        }

        public Vector3 ClampToCurrentFloor(Vector3 position)
        {
            if (currentFloorIndex < 0 || currentFloorIndex >= floors.Count) return position;
            FloorData floor = floors[currentFloorIndex];
            position.y = Mathf.Clamp(position.y, floor.MinHeight, floor.MaxHeight);
            return position;
        }

        public List<FurnitureData> GetFurnitureOnCurrentFloor()
        {
            if (currentFloorIndex < 0 || currentFloorIndex >= floors.Count) return new List<FurnitureData>();
            return floors[currentFloorIndex].Furniture;
        }

        public void AddFurnitureToFloor(FurnitureData furniture)
        {
            if (furniture.FloorIndex < 0 || furniture.FloorIndex >= floors.Count) return;
            floors[furniture.FloorIndex].Furniture.Add(furniture);
        }

        public void RemoveFurnitureFromFloor(FurnitureData furniture)
        {
            if (furniture.FloorIndex < 0 || furniture.FloorIndex >= floors.Count) return;
            floors[furniture.FloorIndex].Furniture.Remove(furniture);
        }

        public void VisualizeFloorBoundaries()
        {
            if (!showFloorBoundaries) return;

            for (int i = 0; i < floors.Count; i++)
            {
                VisualizeFloorBoundary(floors[i]);
            }
        }

        private void VisualizeFloorBoundary(FloorData floor)
        {
            GameObject existing = GameObject.Find($"FloorBoundary_{floor.FloorIndex}");
            if (existing != null) Destroy(existing);

            GameObject boundaryObj = new GameObject($"FloorBoundary_{floor.FloorIndex}");
            boundaryObj.transform.SetParent(transform, false);

            List<Vector3> corners = new List<Vector3>
            {
                new Vector3(floor.FloorBounds.min.x, floor.MinHeight, floor.FloorBounds.min.z),
                new Vector3(floor.FloorBounds.max.x, floor.MinHeight, floor.FloorBounds.min.z),
                new Vector3(floor.FloorBounds.max.x, floor.MinHeight, floor.FloorBounds.max.z),
                new Vector3(floor.FloorBounds.min.x, floor.MinHeight, floor.FloorBounds.max.z),

                new Vector3(floor.FloorBounds.min.x, floor.MaxHeight, floor.FloorBounds.min.z),
                new Vector3(floor.FloorBounds.max.x, floor.MaxHeight, floor.FloorBounds.min.z),
                new Vector3(floor.FloorBounds.max.x, floor.MaxHeight, floor.FloorBounds.max.z),
                new Vector3(floor.FloorBounds.min.x, floor.MaxHeight, floor.FloorBounds.max.z)
            };

            int[] lineIndices = { 0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7 };

            Color floorColor = floor.FloorIndex == currentFloorIndex ? Color.green : Color.gray;

            LineRenderer lineRenderer = boundaryObj.AddComponent<LineRenderer>();
            lineRenderer.positionCount = lineIndices.Length;
            lineRenderer.startWidth = 0.02f;
            lineRenderer.endWidth = 0.02f;
            lineRenderer.material = new Material(Shader.Find("Unlit/Color"));
            lineRenderer.material.color = floorColor;

            Vector3[] positions = new Vector3[lineIndices.Length];
            for (int i = 0; i < lineIndices.Length; i++)
            {
                positions[i] = corners[lineIndices[i]];
            }
            lineRenderer.SetPositions(positions);

            for (int s = 0; s < floor.StairVoids.Count; s++)
            {
                VisualizeStairVoid(floor.StairVoids[s], boundaryObj.transform);
            }
        }

        private void VisualizeStairVoid(StairVoid stairVoid, Transform parent)
        {
            GameObject voidObj = GameObject.CreatePrimitive(PrimitiveType.Cube);
            voidObj.name = "StairVoid";
            voidObj.transform.SetParent(parent, false);
            voidObj.transform.position = stairVoid.Center;
            voidObj.transform.rotation = stairVoid.Rotation;
            voidObj.transform.localScale = stairVoid.Size;

            Renderer renderer = voidObj.GetComponent<Renderer>();
            Color voidColor = new Color(1f, 0.5f, 0f, 0.15f);
            renderer.material.color = voidColor;
            renderer.material.SetInt("_SrcBlend", (int)UnityEngine.Rendering.BlendMode.SrcAlpha);
            renderer.material.SetInt("_DstBlend", (int)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
            renderer.material.SetInt("_ZWrite", 0);
            renderer.material.renderQueue = 3000;

            Collider col = voidObj.GetComponent<Collider>();
            if (col != null) Destroy(col);
        }

        private void ShowFloorRenderer(int floorIndex)
        {
            if (floorRenderers.TryGetValue(floorIndex, out PointCloudRenderer renderer))
            {
                if (renderer != null)
                    renderer.gameObject.SetActive(true);
            }
        }

        private void HideFloorRenderer(int floorIndex)
        {
            if (floorRenderers.TryGetValue(floorIndex, out PointCloudRenderer renderer))
            {
                if (renderer != null)
                    renderer.gameObject.SetActive(false);
            }
        }

        public void RegisterFloorRenderer(int floorIndex, PointCloudRenderer renderer)
        {
            floorRenderers[floorIndex] = renderer;
        }

        private void ClearFloorRenderers()
        {
            foreach (var kvp in floorRenderers)
            {
                if (kvp.Value != null)
                    Destroy(kvp.Value.gameObject);
            }
            floorRenderers.Clear();

            for (int i = transform.childCount - 1; i >= 0; i--)
            {
                Transform child = transform.GetChild(i);
                if (child.name.StartsWith("FloorBoundary_"))
                    Destroy(child.gameObject);
            }
        }

        public void ClearAll()
        {
            ClearFloorRenderers();
            floors.Clear();
            currentFloorIndex = -1;
            originalPointCloud = null;
        }

        public string GetFloorInfoString()
        {
            if (floors.Count == 0) return "未检测到楼层";

            string info = $"共 {floors.Count} 层 | 当前: {(currentFloorIndex + 1)}F\n";
            for (int i = 0; i < floors.Count; i++)
            {
                FloorData f = floors[i];
                string marker = i == currentFloorIndex ? "►" : " ";
                info += $"{marker} {i + 1}F: {f.MinHeight:F1}m ~ {f.MaxHeight:F1}m";
                info += $" | {f.Rooms.Count}房间";
                info += $" | {f.Furniture.Count}家具";
                if (f.StairVoids.Count > 0)
                    info += $" | {f.StairVoids.Count}楼梯孔";
                info += "\n";
            }
            return info;
        }
    }
}
