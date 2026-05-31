using UnityEngine;
using System.Collections.Generic;

namespace LiDARFurniturePlacer.Core
{
    public enum SemanticLabel
    {
        Unlabeled = 0,
        Wall = 1,
        Floor = 2,
        Ceiling = 3,
        Door = 4,
        Window = 5,
        Stair = 6,
        Column = 7,
        Beam = 8,
        Furniture = 9,
        Clutter = 10
    }

    public enum RoomType
    {
        Unknown = 0,
        LivingRoom = 1,
        Bedroom = 2,
        Kitchen = 3,
        Bathroom = 4,
        DiningRoom = 5,
        Study = 6,
        Balcony = 7,
        Hallway = 8,
        Storage = 9,
        Garage = 10
    }

    public enum FurnitureCategory
    {
        General = 0,
        Sofa = 1,
        Bed = 2,
        Table = 3,
        Chair = 4,
        Cabinet = 5,
        Appliance = 6,
        Lighting = 7,
        Decor = 8,
        Storage = 9,
        BathroomFixture = 10,
        KitchenFixture = 11
    }

    [System.Serializable]
    public class PointCloudData
    {
        public Vector3[] Vertices;
        public Color[] Colors;
        public int[] Indices;
        public SemanticLabel[] SemanticLabels;
        public int PointCount => Vertices != null ? Vertices.Length : 0;
        public bool HasSemanticLabels => SemanticLabels != null && SemanticLabels.Length == PointCount;

        public PointCloudData(int pointCount)
        {
            Vertices = new Vector3[pointCount];
            Colors = new Color[pointCount];
            Indices = new int[pointCount];
            SemanticLabels = null;
            for (int i = 0; i < pointCount; i++)
            {
                Indices[i] = i;
            }
        }

        public PointCloudData(Vector3[] vertices, Color[] colors)
        {
            Vertices = vertices;
            Colors = colors;
            Indices = new int[vertices.Length];
            SemanticLabels = null;
            for (int i = 0; i < vertices.Length; i++)
            {
                Indices[i] = i;
            }
        }

        public void EnsureSemanticLabels()
        {
            if (SemanticLabels == null || SemanticLabels.Length != PointCount)
            {
                SemanticLabels = new SemanticLabel[PointCount];
            }
        }

        public void ApplyTransform(Matrix4x4 transform)
        {
            for (int i = 0; i < Vertices.Length; i++)
            {
                Vertices[i] = transform.MultiplyPoint(Vertices[i]);
            }
        }

        public Bounds GetBounds()
        {
            if (Vertices == null || Vertices.Length == 0)
                return new Bounds(Vector3.zero, Vector3.zero);

            Bounds bounds = new Bounds(Vertices[0], Vector3.zero);
            for (int i = 1; i < Vertices.Length; i++)
            {
                bounds.Encapsulate(Vertices[i]);
            }
            return bounds;
        }

        public PointCloudData ExtractSubset(int[] indices)
        {
            Vector3[] subVerts = new Vector3[indices.Length];
            Color[] subColors = new Color[indices.Length];
            int[] subIndices = new int[indices.Length];
            SemanticLabel[] subLabels = null;

            if (HasSemanticLabels)
            {
                subLabels = new SemanticLabel[indices.Length];
            }

            for (int i = 0; i < indices.Length; i++)
            {
                int srcIdx = indices[i];
                subVerts[i] = Vertices[srcIdx];
                subColors[i] = Colors[srcIdx];
                subIndices[i] = i;
                if (subLabels != null)
                {
                    subLabels[i] = SemanticLabels[srcIdx];
                }
            }

            PointCloudData subset = new PointCloudData();
            subset.Vertices = subVerts;
            subset.Colors = subColors;
            subset.Indices = subIndices;
            subset.SemanticLabels = subLabels;
            return subset;
        }

        public Dictionary<SemanticLabel, int> GetSemanticStatistics()
        {
            Dictionary<SemanticLabel, int> stats = new Dictionary<SemanticLabel, int>();
            if (!HasSemanticLabels) return stats;

            for (int i = 0; i < PointCount; i++)
            {
                SemanticLabel label = SemanticLabels[i];
                if (stats.ContainsKey(label))
                    stats[label]++;
                else
                    stats[label] = 1;
            }
            return stats;
        }
    }

    [System.Serializable]
    public class FurnitureData
    {
        public string Name;
        public string ModelPath;
        public Vector3 Position;
        public Quaternion Rotation;
        public Vector3 Scale;
        public Vector3 OriginalSize;
        public Vector3 ActualSize;
        public FurnitureCategory Category;
        public int FloorIndex;
        public string RoomId;
        public RoomType AllowedRoomType;

        public FurnitureData()
        {
            Position = Vector3.zero;
            Rotation = Quaternion.identity;
            Scale = Vector3.one;
            Category = FurnitureCategory.General;
            FloorIndex = 0;
            RoomId = "";
            AllowedRoomType = RoomType.Unknown;
        }

        public FurnitureData Clone()
        {
            return (FurnitureData)MemberwiseClone();
        }
    }

    [System.Serializable]
    public class RoomRegion
    {
        public string Id;
        public RoomType Type;
        public Bounds Bounds;
        public Vector3 Center;
        public Vector3 Size;
        public List<Vector3> FloorPolygon;
        public float Area;
        public List<string> FurnitureIds;
        public List<string> ConnectedRoomIds;
        public int FloorIndex;
        public bool HasDoor;
        public bool HasWindow;

        private static int idCounter = 0;

        public RoomRegion()
        {
            Id = $"room_{idCounter++}";
            FloorPolygon = new List<Vector3>();
            FurnitureIds = new List<string>();
            ConnectedRoomIds = new List<string>();
        }

        public bool ContainsPoint(Vector3 point)
        {
            if (!Bounds.Contains(point)) return false;

            if (FloorPolygon != null && FloorPolygon.Count >= 3)
            {
                return PointInPolygonXZ(point, FloorPolygon);
            }

            return true;
        }

        private bool PointInPolygonXZ(Vector3 point, List<Vector3> polygon)
        {
            bool inside = false;
            int n = polygon.Count;
            for (int i = 0, j = n - 1; i < n; j = i++)
            {
                Vector3 pi = polygon[i];
                Vector3 pj = polygon[j];

                if (((pi.z > point.z) != (pj.z > point.z)) &&
                    (point.x < (pj.x - pi.x) * (point.z - pi.z) / (pj.z - pi.z + 1e-10f) + pi.x))
                {
                    inside = !inside;
                }
            }
            return inside;
        }

        public float ComputeArea()
        {
            if (FloorPolygon == null || FloorPolygon.Count < 3) return 0f;

            float area = 0f;
            int n = FloorPolygon.Count;
            for (int i = 0; i < n; i++)
            {
                Vector3 current = FloorPolygon[i];
                Vector3 next = FloorPolygon[(i + 1) % n];
                area += current.x * next.z;
                area -= next.x * current.z;
            }
            Area = Mathf.Abs(area) * 0.5f;
            return Area;
        }
    }

    [System.Serializable]
    public class FloorData
    {
        public int FloorIndex;
        public float MinHeight;
        public float MaxHeight;
        public float FloorThickness;
        public PointCloudData PointCloud;
        public List<RoomRegion> Rooms;
        public List<StairVoid> StairVoids;
        public List<FurnitureData> Furniture;
        public bool IsVisible;
        public Bounds FloorBounds;

        public FloorData()
        {
            Rooms = new List<RoomRegion>();
            StairVoids = new List<StairVoid>();
            Furniture = new List<FurnitureData>();
            IsVisible = true;
        }

        public void AddRoom(RoomRegion room)
        {
            room.FloorIndex = FloorIndex;
            Rooms.Add(room);
        }

        public RoomRegion FindRoomAtPosition(Vector3 position)
        {
            for (int i = 0; i < Rooms.Count; i++)
            {
                if (Rooms[i].ContainsPoint(position))
                    return Rooms[i];
            }
            return null;
        }

        public bool IsInStairVoid(Vector3 position)
        {
            for (int i = 0; i < StairVoids.Count; i++)
            {
                if (StairVoids[i].ContainsPoint(position))
                    return true;
            }
            return false;
        }
    }

    [System.Serializable]
    public class StairVoid
    {
        public Vector3 Center;
        public Vector3 Size;
        public Quaternion Rotation;
        public int FromFloor;
        public int ToFloor;
        public float MinHeight;
        public float MaxHeight;
        public Bounds Bounds;

        public bool ContainsPoint(Vector3 point)
        {
            Vector3 local = Quaternion.Inverse(Rotation) * (point - Center);
            return Mathf.Abs(local.x) <= Size.x * 0.5f
                && Mathf.Abs(local.z) <= Size.z * 0.5f
                && point.y >= MinHeight && point.y <= MaxHeight;
        }
    }

    [System.Serializable]
    public class FurniturePlacementRule
    {
        public FurnitureCategory Category;
        public List<RoomType> AllowedRooms;
        public List<RoomType> ForbiddenRooms;
        public bool MustBeAgainstWall;
        public bool MustBeInCorner;
        public float MinRoomArea;
        public float MaxWallDistance;

        public bool IsAllowedInRoom(RoomType roomType)
        {
            if (ForbiddenRooms != null && ForbiddenRooms.Contains(roomType))
                return false;
            if (AllowedRooms != null && AllowedRooms.Count > 0 && !AllowedRooms.Contains(roomType))
                return false;
            return true;
        }
    }

    public enum RenderMode
    {
        Realistic,
        Wireframe
    }

    public enum PointCloudColoringMode
    {
        Original,
        Height,
        Normal,
        Semantic
    }

    public static class SemanticColors
    {
        public static readonly Color Wall = new Color(0.7f, 0.7f, 0.8f);
        public static readonly Color Floor = new Color(0.6f, 0.4f, 0.2f);
        public static readonly Color Ceiling = new Color(0.8f, 0.8f, 0.8f);
        public static readonly Color Door = new Color(0.2f, 0.6f, 0.2f);
        public static readonly Color Window = new Color(0.2f, 0.4f, 0.8f);
        public static readonly Color Stair = new Color(0.8f, 0.6f, 0.2f);
        public static readonly Color Column = new Color(0.6f, 0.6f, 0.6f);
        public static readonly Color Beam = new Color(0.5f, 0.5f, 0.5f);
        public static readonly Color FurnitureColor = new Color(0.8f, 0.4f, 0.4f);
        public static readonly Color Clutter = new Color(0.5f, 0.5f, 0.3f);
        public static readonly Color Unlabeled = new Color(0.3f, 0.3f, 0.3f);

        public static Color GetColor(SemanticLabel label)
        {
            switch (label)
            {
                case SemanticLabel.Wall: return Wall;
                case SemanticLabel.Floor: return Floor;
                case SemanticLabel.Ceiling: return Ceiling;
                case SemanticLabel.Door: return Door;
                case SemanticLabel.Window: return Window;
                case SemanticLabel.Stair: return Stair;
                case SemanticLabel.Column: return Column;
                case SemanticLabel.Beam: return Beam;
                case SemanticLabel.Furniture: return FurnitureColor;
                case SemanticLabel.Clutter: return Clutter;
                default: return Unlabeled;
            }
        }
    }

    public static class RoomTypeNames
    {
        public static string GetDisplayName(RoomType type)
        {
            switch (type)
            {
                case RoomType.LivingRoom: return "客厅";
                case RoomType.Bedroom: return "卧室";
                case RoomType.Kitchen: return "厨房";
                case RoomType.Bathroom: return "卫生间";
                case RoomType.DiningRoom: return "餐厅";
                case RoomType.Study: return "书房";
                case RoomType.Balcony: return "阳台";
                case RoomType.Hallway: return "走廊";
                case RoomType.Storage: return "储藏室";
                case RoomType.Garage: return "车库";
                default: return "未知";
            }
        }

        public static string GetDisplayName(FurnitureCategory cat)
        {
            switch (cat)
            {
                case FurnitureCategory.Sofa: return "沙发";
                case FurnitureCategory.Bed: return "床";
                case FurnitureCategory.Table: return "桌子";
                case FurnitureCategory.Chair: return "椅子";
                case FurnitureCategory.Cabinet: return "柜子";
                case FurnitureCategory.Appliance: return "家电";
                case FurnitureCategory.Lighting: return "灯具";
                case FurnitureCategory.Decor: return "装饰";
                case FurnitureCategory.Storage: return "收纳";
                case FurnitureCategory.BathroomFixture: return "卫浴";
                case FurnitureCategory.KitchenFixture: return "厨具";
                default: return "通用";
            }
        }
    }
}
