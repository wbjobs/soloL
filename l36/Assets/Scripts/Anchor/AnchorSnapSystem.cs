using System;
using System.Collections.Generic;
using UnityEngine;
using LiDARFurniturePlacer.Furniture;

namespace LiDARFurniturePlacer.Anchor
{
    public class AnchorSnapSystem : MonoBehaviour
    {
        [SerializeField] private AnchorDetector anchorDetector;
        [SerializeField] private WallDetector wallDetector;

        [SerializeField] private float anchorSnapRadius = 0.5f;
        [SerializeField] private float wallSnapDistance = 0.15f;
        [SerializeField] private float cornerSnapAngle = 30f;
        [SerializeField] private bool enableAnchorSnap = true;
        [SerializeField] private bool enableWallPlaneSnap = true;
        [SerializeField] private bool enableCornerSnap = true;
        [SerializeField] private bool enableFloorSnap = true;
        [SerializeField] private float floorSnapY = 0f;
        [SerializeField] private float snapLerpSpeed = 15f;
        [SerializeField] private float wallOffset = 0.05f;

        private AnchorPoint currentSnapAnchor;
        private WallDetector.DetectedWall currentSnapWall;
        private Vector3 lastSnappedPosition;
        private Quaternion lastSnappedRotation;

        public AnchorPoint CurrentSnapAnchor => currentSnapAnchor;
        public WallDetector.DetectedWall CurrentSnapWall => currentSnapWall;
        public bool IsSnappedToAnchor => currentSnapAnchor != null;
        public bool IsSnappedToWall => currentSnapWall != null;

        public event Action<AnchorPoint> OnAnchorSnapped;
        public event Action<WallDetector.DetectedWall> OnWallSnapped;
        public event Action OnSnapReleased;

        public AnchorSnapResult ComputeSnap(Vector3 targetPosition, Quaternion targetRotation, Vector3 furnitureSize)
        {
            AnchorSnapResult result = AnchorSnapResult.NoSnap(targetPosition, targetRotation);

            if (enableFloorSnap)
            {
                targetPosition.y = floorSnapY;
            }

            if (enableAnchorSnap)
            {
                result = TrySnapToAnchor(targetPosition, targetRotation, furnitureSize);
                if (result.Snapped)
                {
                    currentSnapAnchor = result.Anchor;
                    currentSnapWall = null;
                    OnAnchorSnapped?.Invoke(currentSnapAnchor);
                    return result;
                }
            }

            if (enableCornerSnap)
            {
                result = TrySnapToCorner(targetPosition, targetRotation, furnitureSize);
                if (result.Snapped)
                {
                    currentSnapAnchor = result.Anchor;
                    currentSnapWall = null;
                    OnAnchorSnapped?.Invoke(currentSnapAnchor);
                    return result;
                }
            }

            if (enableWallPlaneSnap)
            {
                result = TrySnapToWallPlane(targetPosition, targetRotation, furnitureSize);
                if (result.Snapped)
                {
                    currentSnapWall = result.Anchor != null ? FindWallByNormal(result.PlaneNormal) : null;
                    currentSnapAnchor = null;
                    if (currentSnapWall != null)
                        OnWallSnapped?.Invoke(currentSnapWall);
                    return result;
                }
            }

            currentSnapAnchor = null;
            currentSnapWall = null;
            OnSnapReleased?.Invoke();

            return result;
        }

        private AnchorSnapResult TrySnapToAnchor(Vector3 position, Quaternion rotation, Vector3 furnitureSize)
        {
            if (anchorDetector == null) return AnchorSnapResult.NoSnap(position, rotation);

            List<AnchorPoint> nearbyAnchors = anchorDetector.FindAnchorsInRange(position, anchorSnapRadius);

            if (nearbyAnchors.Count == 0)
                return AnchorSnapResult.NoSnap(position, rotation);

            AnchorPoint closest = nearbyAnchors[0];
            float closestDist = closest.DistanceTo(position);

            Vector3 snappedPos = closest.SnapPosition(position);
            Quaternion snappedRot = GetAnchorAlignedRotation(closest, rotation);

            if (closest.Type == AnchorType.WallCorner && closest.SecondaryNormal.sqrMagnitude > 0.001f)
            {
                snappedRot = closest.GetCornerRotation();
            }
            else
            {
                snappedRot = closest.GetAlignedRotation();
            }

            if (enableFloorSnap && closest.Template != null && closest.Template.SnapToFloor)
            {
                snappedPos.y = floorSnapY;
            }

            return new AnchorSnapResult
            {
                Snapped = true,
                Anchor = closest,
                SnappedPosition = snappedPos,
                SnappedRotation = snappedRot,
                SnapDistance = closestDist,
                PlaneNormal = closest.Normal,
                ProjectedPosition = ProjectOntoPlane(position, closest.Position, closest.Normal)
            };
        }

        private AnchorSnapResult TrySnapToCorner(Vector3 position, Quaternion rotation, Vector3 furnitureSize)
        {
            if (anchorDetector == null) return AnchorSnapResult.NoSnap(position, rotation);

            List<AnchorPoint> corners = anchorDetector.FindAnchorsByType(AnchorType.WallCorner);

            AnchorPoint bestCorner = null;
            float bestDist = anchorSnapRadius;

            foreach (var corner in corners)
            {
                if (!corner.IsActive) continue;

                float dist = corner.DistanceTo(position);
                if (dist < bestDist)
                {
                    bestDist = dist;
                    bestCorner = corner;
                }
            }

            if (bestCorner == null)
                return AnchorSnapResult.NoSnap(position, rotation);

            Vector3 snappedPos = bestCorner.Position;
            Quaternion snappedRot = bestCorner.GetCornerRotation();

            Vector3 furnitureHalf = furnitureSize * 0.5f;

            Vector3 bisector = (bestCorner.Normal + bestCorner.SecondaryNormal).normalized;
            if (bisector.sqrMagnitude > 0.001f)
            {
                snappedPos += bisector * furnitureHalf.magnitude * 0.7f;
            }

            if (enableFloorSnap)
            {
                snappedPos.y = floorSnapY;
            }

            return new AnchorSnapResult
            {
                Snapped = true,
                Anchor = bestCorner,
                SnappedPosition = snappedPos,
                SnappedRotation = snappedRot,
                SnapDistance = bestDist,
                PlaneNormal = bestCorner.Normal,
                ProjectedPosition = bestCorner.Position
            };
        }

        private AnchorSnapResult TrySnapToWallPlane(Vector3 position, Quaternion rotation, Vector3 furnitureSize)
        {
            if (wallDetector == null) return AnchorSnapResult.NoSnap(position, rotation);

            WallDetector.DetectedWall nearestWall = null;
            float nearestDist = wallSnapDistance;

            foreach (var wall in wallDetector.DetectedWalls)
            {
                float dist = Mathf.Abs(wall.Plane.GetDistanceToPoint(position));

                if (dist < nearestDist)
                {
                    Vector3 projected = ProjectOntoPlane(position, wall.Center, wall.Normal);
                    if (IsPointInWallBounds(projected, wall))
                    {
                        nearestDist = dist;
                        nearestWall = wall;
                    }
                }
            }

            if (nearestWall == null)
                return AnchorSnapResult.NoSnap(position, rotation);

            Vector3 snappedPos = ProjectOntoWall(position, nearestWall, furnitureSize);
            Quaternion snappedRot = GetWallAlignedRotation(nearestWall.Normal, rotation);

            if (enableFloorSnap)
            {
                snappedPos.y = floorSnapY;
            }

            AnchorPoint wallAnchor = new AnchorPoint(AnchorType.WallCenter, snappedPos, nearestWall.Normal)
            {
                SecondaryNormal = Vector3.Cross(nearestWall.Normal, Vector3.up).normalized,
                Up = Vector3.up,
                SnapRadius = nearestWall.Size.x * 0.5f,
                Label = "WallSnap"
            };

            return new AnchorSnapResult
            {
                Snapped = true,
                Anchor = wallAnchor,
                SnappedPosition = snappedPos,
                SnappedRotation = snappedRot,
                SnapDistance = nearestDist,
                PlaneNormal = nearestWall.Normal,
                ProjectedPosition = ProjectOntoPlane(position, nearestWall.Center, nearestWall.Normal)
            };
        }

        private Vector3 ProjectOntoWall(Vector3 position, WallDetector.DetectedWall wall, Vector3 furnitureSize)
        {
            Vector3 projected = ProjectOntoPlane(position, wall.Center, wall.Normal);

            Vector3 offset = wall.Normal * (wallOffset + furnitureSize.z * 0.5f);

            return projected + offset;
        }

        private Vector3 ProjectOntoPlane(Vector3 point, Vector3 planePoint, Vector3 planeNormal)
        {
            float distance = Vector3.Dot(point - planePoint, planeNormal);
            return point - planeNormal * distance;
        }

        private Quaternion GetAnchorAlignedRotation(AnchorPoint anchor, Quaternion currentRotation)
        {
            if (anchor.Type == AnchorType.WallCorner)
            {
                return anchor.GetCornerRotation();
            }

            return anchor.GetAlignedRotation();
        }

        private Quaternion GetWallAlignedRotation(Vector3 wallNormal, Quaternion currentRotation)
        {
            Vector3 forward = -wallNormal;
            Vector3 right = Vector3.Cross(Vector3.up, forward).normalized;

            if (right.sqrMagnitude < 0.001f)
            {
                right = Vector3.right;
            }

            return Quaternion.LookRotation(forward, Vector3.up);
        }

        private bool IsPointInWallBounds(Vector3 point, WallDetector.DetectedWall wall)
        {
            Vector3 local = point - wall.Center;
            Vector3 right = Vector3.Cross(wall.Normal, Vector3.up).normalized;

            float x = Vector3.Dot(local, right);
            float y = Vector3.Dot(local, Vector3.up);

            float margin = 0.1f;
            return Mathf.Abs(x) <= wall.Size.x * 0.5f + margin &&
                   Mathf.Abs(y) <= wall.Size.y * 0.5f + margin;
        }

        private WallDetector.DetectedWall FindWallByNormal(Vector3 normal)
        {
            if (wallDetector == null) return null;

            foreach (var wall in wallDetector.DetectedWalls)
            {
                if (Vector3.Dot(wall.Normal, normal) > 0.9f)
                    return wall;
            }

            return null;
        }

        public Vector3 SmoothSnap(Vector3 currentPosition, Vector3 targetPosition)
        {
            return Vector3.Lerp(currentPosition, targetPosition, Mathf.Clamp01(snapLerpSpeed * Time.deltaTime));
        }

        public Quaternion SmoothSnapRotation(Quaternion currentRotation, Quaternion targetRotation)
        {
            return Quaternion.Slerp(currentRotation, targetRotation, Mathf.Clamp01(snapLerpSpeed * Time.deltaTime));
        }

        public void SetAnchorSnapEnabled(bool enabled)
        {
            enableAnchorSnap = enabled;
        }

        public void SetWallSnapEnabled(bool enabled)
        {
            enableWallPlaneSnap = enabled;
        }

        public void SetCornerSnapEnabled(bool enabled)
        {
            enableCornerSnap = enabled;
        }

        public void SetFloorSnapEnabled(bool enabled, float y = 0f)
        {
            enableFloorSnap = enabled;
            floorSnapY = y;
        }

        public void SetSnapRadius(float radius)
        {
            anchorSnapRadius = radius;
            wallSnapDistance = radius * 0.3f;
        }

        public void SetWallOffset(float offset)
        {
            wallOffset = offset;
        }

        public string GetSnapInfo()
        {
            if (currentSnapAnchor != null)
            {
                return $"Snapped to anchor: {currentSnapAnchor.Label} ({currentSnapAnchor.Type})";
            }
            if (currentSnapWall != null)
            {
                return $"Snapped to wall plane";
            }
            return "No snap";
        }
    }
}
