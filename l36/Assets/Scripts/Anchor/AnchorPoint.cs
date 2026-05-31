using System;
using System.Collections.Generic;
using UnityEngine;

namespace LiDARFurniturePlacer.Anchor
{
    public enum AnchorType
    {
        WallCorner,
        DoorFrame,
        WindowFrame,
        WallCenter,
        WallEdge,
        FloorCorner,
        CeilingCorner,
        Custom
    }

    [System.Serializable]
    public class AnchorPoint : IComparable<AnchorPoint>
    {
        public string Id;
        public AnchorType Type;
        public Vector3 Position;
        public Vector3 Normal;
        public Vector3 SecondaryNormal;
        public Vector3 Up;
        public float SnapRadius;
        public bool IsActive;
        public string Label;
        public List<string> Tags;
        public AnchorTemplate Template;

        private static int idCounter = 0;

        public AnchorPoint()
        {
            Id = $"anchor_{idCounter++}";
            Normal = Vector3.forward;
            SecondaryNormal = Vector3.right;
            Up = Vector3.up;
            SnapRadius = 0.3f;
            IsActive = true;
            Tags = new List<string>();
        }

        public AnchorPoint(AnchorType type, Vector3 position, Vector3 normal) : this()
        {
            Type = type;
            Position = position;
            Normal = normal.normalized;
        }

        public AnchorPoint(AnchorType type, Vector3 position, Vector3 normal, Vector3 secondaryNormal) : this()
        {
            Type = type;
            Position = position;
            Normal = normal.normalized;
            SecondaryNormal = secondaryNormal.normalized;
        }

        public float DistanceTo(Vector3 point)
        {
            return Vector3.Distance(Position, point);
        }

        public float DistanceToPlane(Vector3 point)
        {
            return Mathf.Abs(Vector3.Dot(point - Position, Normal));
        }

        public bool IsWithinSnapRadius(Vector3 point)
        {
            return DistanceTo(point) <= SnapRadius;
        }

        public Vector3 SnapPosition(Vector3 point)
        {
            Vector3 toPoint = point - Position;
            float alongNormal = Vector3.Dot(toPoint, Normal);
            float alongSecondary = Vector3.Dot(toPoint, SecondaryNormal);
            float alongUp = Vector3.Dot(toPoint, Up);

            switch (Type)
            {
                case AnchorType.WallCorner:
                case AnchorType.FloorCorner:
                case AnchorType.CeilingCorner:
                    return Position;

                case AnchorType.DoorFrame:
                case AnchorType.WindowFrame:
                    float snappedSecondary = Mathf.Clamp(alongSecondary,
                        -Template?.Width * 0.5f ?? 0.5f,
                        Template?.Width * 0.5f ?? 0.5f);
                    return Position + SecondaryNormal * snappedSecondary;

                case AnchorType.WallCenter:
                case AnchorType.WallEdge:
                    return Position + SecondaryNormal * alongSecondary + Up * alongUp;

                default:
                    return Position;
            }
        }

        public Quaternion GetAlignedRotation()
        {
            Vector3 forward = -Normal;
            if (forward.sqrMagnitude < 0.001f)
                forward = Vector3.forward;

            Vector3 right = Vector3.Cross(Up, forward).normalized;
            if (right.sqrMagnitude < 0.001f)
                right = Vector3.right;

            forward = Vector3.Cross(right, Up).normalized;
            return Quaternion.LookRotation(forward, Up);
        }

        public Quaternion GetCornerRotation()
        {
            Vector3 bisector = (Normal + SecondaryNormal).normalized;
            if (bisector.sqrMagnitude < 0.001f)
                return Quaternion.LookRotation(-Normal, Up);

            return Quaternion.LookRotation(-bisector, Up);
        }

        public int CompareTo(AnchorPoint other)
        {
            return string.Compare(Id, other.Id, StringComparison.Ordinal);
        }

        public AnchorPoint Clone()
        {
            return (AnchorPoint)MemberwiseClone();
        }
    }

    [System.Serializable]
    public class AnchorTemplate
    {
        public string Name;
        public AnchorType Type;
        public float Width;
        public float Height;
        public float Depth;
        public float DefaultSnapRadius;
        public Vector3 LocalOffset;
        public List<string> DefaultTags;
        public bool SnapToFloor;

        public static AnchorTemplate DoorFrame()
        {
            return new AnchorTemplate
            {
                Name = "Door Frame",
                Type = AnchorType.DoorFrame,
                Width = 0.9f,
                Height = 2.1f,
                Depth = 0.15f,
                DefaultSnapRadius = 0.4f,
                LocalOffset = new Vector3(0, 1.05f, 0),
                DefaultTags = new List<string> { "door", "entrance" },
                SnapToFloor = true
            };
        }

        public static AnchorTemplate WindowFrame()
        {
            return new AnchorTemplate
            {
                Name = "Window Frame",
                Type = AnchorType.WindowFrame,
                Width = 1.2f,
                Height = 1.5f,
                Depth = 0.15f,
                DefaultSnapRadius = 0.35f,
                LocalOffset = new Vector3(0, 1.2f, 0),
                DefaultTags = new List<string> { "window" },
                SnapToFloor = false
            };
        }

        public static AnchorTemplate WallCornerTemplate()
        {
            return new AnchorTemplate
            {
                Name = "Wall Corner",
                Type = AnchorType.WallCorner,
                Width = 0.6f,
                Height = 2.5f,
                Depth = 0.6f,
                DefaultSnapRadius = 0.5f,
                LocalOffset = Vector3.zero,
                DefaultTags = new List<string> { "corner" },
                SnapToFloor = true
            };
        }

        public static AnchorTemplate WallCenterTemplate()
        {
            return new AnchorTemplate
            {
                Name = "Wall Center",
                Type = AnchorType.WallCenter,
                Width = 2f,
                Height = 2.5f,
                Depth = 0.3f,
                DefaultSnapRadius = 0.3f,
                LocalOffset = Vector3.zero,
                DefaultTags = new List<string> { "wall" },
                SnapToFloor = true
            };
        }

        public static AnchorTemplate WallEdgeTemplate()
        {
            return new AnchorTemplate
            {
                Name = "Wall Edge",
                Type = AnchorType.WallEdge,
                Width = 0.3f,
                Height = 2.5f,
                Depth = 0.3f,
                DefaultSnapRadius = 0.3f,
                LocalOffset = Vector3.zero,
                DefaultTags = new List<string> { "edge" },
                SnapToFloor = true
            };
        }

        public static List<AnchorTemplate> GetAllDefaults()
        {
            return new List<AnchorTemplate>
            {
                DoorFrame(),
                WindowFrame(),
                WallCornerTemplate(),
                WallCenterTemplate(),
                WallEdgeTemplate()
            };
        }
    }

    [System.Serializable]
    public class AnchorSnapResult
    {
        public bool Snapped;
        public AnchorPoint Anchor;
        public Vector3 SnappedPosition;
        public Quaternion SnappedRotation;
        public float SnapDistance;
        public Vector3 PlaneNormal;
        public Vector3 ProjectedPosition;

        public static AnchorSnapResult NoSnap(Vector3 originalPosition, Quaternion originalRotation)
        {
            return new AnchorSnapResult
            {
                Snapped = false,
                Anchor = null,
                SnappedPosition = originalPosition,
                SnappedRotation = originalRotation,
                SnapDistance = float.MaxValue,
                PlaneNormal = Vector3.up,
                ProjectedPosition = originalPosition
            };
        }
    }
}
