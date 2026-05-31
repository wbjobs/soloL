using System;
using System.Collections.Generic;
using UnityEngine;
using LiDARFurniturePlacer.Furniture;

namespace LiDARFurniturePlacer.Anchor
{
    public class AnchorDetector : MonoBehaviour
    {
        [SerializeField] private float cornerAngleThreshold = 0.1f;
        [SerializeField] private float cornerSearchRadius = 0.5f;
        [SerializeField] private float wallIntersectionTolerance = 0.1f;
        [SerializeField] private float doorHeightMin = 1.8f;
        [SerializeField] private float doorHeightMax = 2.5f;
        [SerializeField] private float doorWidthMin = 0.6f;
        [SerializeField] private float doorWidthMax = 1.2f;
        [SerializeField] private float windowHeightMin = 0.5f;
        [SerializeField] private float windowHeightMax = 2.0f;
        [SerializeField] private float windowSillHeightMin = 0.5f;
        [SerializeField] private float windowSillHeightMax = 1.5f;

        private List<AnchorPoint> detectedAnchors = new List<AnchorPoint>();
        private List<GameObject> anchorVisualizers = new List<GameObject>();

        public IReadOnlyList<AnchorPoint> DetectedAnchors => detectedAnchors;

        public event Action<IReadOnlyList<AnchorPoint>> OnAnchorsDetected;

        public List<AnchorPoint> DetectAnchorsFromWalls(IReadOnlyList<WallDetector.DetectedWall> walls, Vector3 floorY)
        {
            ClearAnchors();

            DetectWallCorners(walls);
            DetectWallEdges(walls);
            DetectWallCenters(walls);

            DetectDoorAnchors(walls);
            DetectWindowAnchors(walls);

            foreach (var anchor in detectedAnchors)
            {
                CreateAnchorVisualizer(anchor);
            }

            OnAnchorsDetected?.Invoke(detectedAnchors);
            Debug.Log($"Detected {detectedAnchors.Count} anchors from {walls.Count} walls");

            return detectedAnchors;
        }

        private void DetectWallCorners(IReadOnlyList<WallDetector.DetectedWall> walls)
        {
            for (int i = 0; i < walls.Count; i++)
            {
                for (int j = i + 1; j < walls.Count; j++)
                {
                    DetectCornerBetweenWalls(walls[i], walls[j]);
                }
            }
        }

        private void DetectCornerBetweenWalls(WallDetector.DetectedWall wallA, WallDetector.DetectedWall wallB)
        {
            float normalDot = Vector3.Dot(wallA.Normal, wallB.Normal);

            if (Mathf.Abs(normalDot) > 1f - cornerAngleThreshold)
                return;

            Vector3 cornerDir = Vector3.Cross(wallA.Normal, wallB.Normal);
            if (cornerDir.sqrMagnitude < 0.001f)
                return;

            cornerDir.Normalize();

            float dA = wallA.Distance;
            float dB = wallB.Distance;

            float denom = wallA.Normal.x * wallB.Normal.z - wallA.Normal.z * wallB.Normal.x;

            if (Mathf.Abs(denom) < 0.001f)
            {
                denom = wallA.Normal.y * wallB.Normal.z - wallA.Normal.z * wallB.Normal.y;
                if (Mathf.Abs(denom) < 0.001f)
                    return;
            }

            float t = (wallB.Normal.x * dA - wallA.Normal.x * dB) / Mathf.Max(Mathf.Abs(denom), 0.001f);

            Vector3 cornerLinePoint = wallA.Normal * dA + Vector3.Cross(wallA.Normal, wallB.Normal).normalized * t;

            float minY = Mathf.Max(wallA.Bounds.min.y, wallB.Bounds.min.y);
            float maxY = Mathf.Min(wallA.Bounds.max.y, wallB.Bounds.max.y);

            Vector3 cornerBottom = new Vector3(cornerLinePoint.x, minY, cornerLinePoint.z);
            Vector3 cornerTop = new Vector3(cornerLinePoint.x, maxY, cornerLinePoint.z);

            AnchorPoint bottomAnchor = new AnchorPoint(AnchorType.WallCorner, cornerBottom, wallA.Normal, wallB.Normal)
            {
                Label = $"Corner_{i}_{j}_bottom",
                SnapRadius = 0.5f,
                Template = AnchorTemplate.WallCornerTemplate(),
                Up = Vector3.up
            };
            bottomAnchor.Tags.Add("corner");
            bottomAnchor.Tags.Add("floor-adjacent");
            detectedAnchors.Add(bottomAnchor);

            AnchorPoint topAnchor = new AnchorPoint(AnchorType.CeilingCorner, cornerTop, wallA.Normal, wallB.Normal)
            {
                Label = $"Corner_{i}_{j}_top",
                SnapRadius = 0.4f,
                Template = AnchorTemplate.WallCornerTemplate(),
                Up = Vector3.up
            };
            topAnchor.Tags.Add("corner");
            topAnchor.Tags.Add("ceiling-adjacent");
            detectedAnchors.Add(topAnchor);

            Vector3 cornerMid = new Vector3(cornerLinePoint.x, (minY + maxY) / 2f, cornerLinePoint.z);
            AnchorPoint midAnchor = new AnchorPoint(AnchorType.WallCorner, cornerMid, wallA.Normal, wallB.Normal)
            {
                Label = $"Corner_{i}_{j}_mid",
                SnapRadius = 0.4f,
                Template = AnchorTemplate.WallCornerTemplate(),
                Up = Vector3.up
            };
            midAnchor.Tags.Add("corner");
            detectedAnchors.Add(midAnchor);
        }

        private void DetectWallEdges(IReadOnlyList<WallDetector.DetectedWall> walls)
        {
            foreach (var wall in walls)
            {
                Vector3 right = Vector3.Cross(wall.Normal, Vector3.up).normalized;
                if (right.sqrMagnitude < 0.001f)
                    right = Vector3.right;

                Vector3 leftEdge = wall.Center - right * wall.Size.x * 0.5f;
                Vector3 rightEdge = wall.Center + right * wall.Size.x * 0.5f;

                float bottomY = wall.Bounds.min.y;
                float topY = wall.Bounds.max.y;

                Vector3 leftBottom = new Vector3(leftEdge.x, bottomY, leftEdge.z);
                Vector3 rightBottom = new Vector3(rightEdge.x, bottomY, rightEdge.z);

                AnchorPoint leftAnchor = new AnchorPoint(AnchorType.WallEdge, leftBottom, wall.Normal)
                {
                    Label = "Edge_Left",
                    SecondaryNormal = -right,
                    SnapRadius = 0.3f,
                    Template = AnchorTemplate.WallEdgeTemplate(),
                    Up = Vector3.up
                };
                leftAnchor.Tags.Add("edge");
                detectedAnchors.Add(leftAnchor);

                AnchorPoint rightAnchor = new AnchorPoint(AnchorType.WallEdge, rightBottom, wall.Normal)
                {
                    Label = "Edge_Right",
                    SecondaryNormal = right,
                    SnapRadius = 0.3f,
                    Template = AnchorTemplate.WallEdgeTemplate(),
                    Up = Vector3.up
                };
                rightAnchor.Tags.Add("edge");
                detectedAnchors.Add(rightAnchor);
            }
        }

        private void DetectWallCenters(IReadOnlyList<WallDetector.DetectedWall> walls)
        {
            foreach (var wall in walls)
            {
                float bottomY = wall.Bounds.min.y;
                float midY = (wall.Bounds.min.y + wall.Bounds.max.y) * 0.5f;

                Vector3 centerBottom = new Vector3(wall.Center.x, bottomY, wall.Center.z);
                Vector3 centerMid = new Vector3(wall.Center.x, midY, wall.Center.z);

                Vector3 right = Vector3.Cross(wall.Normal, Vector3.up).normalized;

                AnchorPoint centerAnchor = new AnchorPoint(AnchorType.WallCenter, centerBottom, wall.Normal)
                {
                    Label = "WallCenter_Bottom",
                    SecondaryNormal = right,
                    SnapRadius = 0.3f,
                    Template = AnchorTemplate.WallCenterTemplate(),
                    Up = Vector3.up
                };
                centerAnchor.Tags.Add("wall-center");
                detectedAnchors.Add(centerAnchor);

                AnchorPoint midAnchor = new AnchorPoint(AnchorType.WallCenter, centerMid, wall.Normal)
                {
                    Label = "WallCenter_Mid",
                    SecondaryNormal = right,
                    SnapRadius = 0.25f,
                    Template = AnchorTemplate.WallCenterTemplate(),
                    Up = Vector3.up
                };
                midAnchor.Tags.Add("wall-center");
                midAnchor.Tags.Add("mid-height");
                detectedAnchors.Add(midAnchor);
            }
        }

        private void DetectDoorAnchors(IReadOnlyList<WallDetector.DetectedWall> walls)
        {
            foreach (var wall in walls)
            {
                if (wall.InlierPoints == null || wall.InlierPoints.Length < 100)
                    continue;

                Vector3 right = Vector3.Cross(wall.Normal, Vector3.up).normalized;

                float[] heightProfile = BuildHeightProfile(wall, right, 20);

                for (int i = 1; i < heightProfile.Length - 1; i++)
                {
                    float prevH = heightProfile[i - 1];
                    float currH = heightProfile[i];
                    float nextH = heightProfile[i + 1];

                    if (currH < prevH && currH < nextH &&
                        currH < wall.Size.y * 0.7f &&
                        currH >= doorHeightMin && currH <= doorHeightMax)
                    {
                        float binWidth = wall.Size.x / heightProfile.Length;
                        float xPos = -wall.Size.x * 0.5f + (i + 0.5f) * binWidth;

                        Vector3 doorPos = wall.Center + right * xPos;
                        doorPos.y = wall.Bounds.min.y;

                        AnchorPoint doorAnchor = new AnchorPoint(AnchorType.DoorFrame, doorPos, wall.Normal)
                        {
                            Label = $"Door_{i}",
                            SecondaryNormal = right,
                            SnapRadius = 0.4f,
                            Template = AnchorTemplate.DoorFrame(),
                            Up = Vector3.up
                        };
                        doorAnchor.Tags.Add("door");
                        doorAnchor.Tags.Add("entrance");
                        detectedAnchors.Add(doorAnchor);
                    }
                }
            }
        }

        private void DetectWindowAnchors(IReadOnlyList<WallDetector.DetectedWall> walls)
        {
            foreach (var wall in walls)
            {
                if (wall.InlierPoints == null || wall.InlierPoints.Length < 100)
                    continue;

                Vector3 right = Vector3.Cross(wall.Normal, Vector3.up).normalized;

                float[] densityProfile = BuildDensityProfile(wall, right, 20);

                for (int i = 1; i < densityProfile.Length - 1; i++)
                {
                    float prevD = densityProfile[i - 1];
                    float currD = densityProfile[i];
                    float nextD = densityProfile[i + 1];

                    float avgNeighbor = (prevD + nextD) * 0.5f;

                    if (currD < avgNeighbor * 0.3f && avgNeighbor > 0)
                    {
                        float binWidth = wall.Size.x / densityProfile.Length;
                        float xPos = -wall.Size.x * 0.5f + (i + 0.5f) * binWidth;

                        Vector3 windowPos = wall.Center + right * xPos;
                        windowPos.y = wall.Bounds.min.y + (windowSillHeightMin + windowSillHeightMax) * 0.5f;

                        AnchorPoint windowAnchor = new AnchorPoint(AnchorType.WindowFrame, windowPos, wall.Normal)
                        {
                            Label = $"Window_{i}",
                            SecondaryNormal = right,
                            SnapRadius = 0.35f,
                            Template = AnchorTemplate.WindowFrame(),
                            Up = Vector3.up
                        };
                        windowAnchor.Tags.Add("window");
                        detectedAnchors.Add(windowAnchor);
                    }
                }
            }
        }

        private float[] BuildHeightProfile(WallDetector.DetectedWall wall, Vector3 right, int bins)
        {
            float[] profile = new float[bins];
            float binWidth = wall.Size.x / bins;

            List<Vector3>[] binPoints = new List<Vector3>[bins];
            for (int i = 0; i < bins; i++)
                binPoints[i] = new List<Vector3>();

            foreach (var p in wall.InlierPoints)
            {
                float r = Vector3.Dot(p - wall.Center, right);
                int bin = Mathf.Clamp(Mathf.FloorToInt((r + wall.Size.x * 0.5f) / binWidth), 0, bins - 1);
                binPoints[bin].Add(p);
            }

            for (int i = 0; i < bins; i++)
            {
                if (binPoints[i].Count == 0)
                {
                    profile[i] = 0;
                    continue;
                }

                float minY = float.MaxValue;
                float maxY = float.MinValue;
                foreach (var p in binPoints[i])
                {
                    if (p.y < minY) minY = p.y;
                    if (p.y > maxY) maxY = p.y;
                }
                profile[i] = maxY - minY;
            }

            return profile;
        }

        private float[] BuildDensityProfile(WallDetector.DetectedWall wall, Vector3 right, int bins)
        {
            float[] profile = new float[bins];
            float binWidth = wall.Size.x / bins;

            foreach (var p in wall.InlierPoints)
            {
                float r = Vector3.Dot(p - wall.Center, right);
                int bin = Mathf.Clamp(Mathf.FloorToInt((r + wall.Size.x * 0.5f) / binWidth), 0, bins - 1);
                profile[bin]++;
            }

            for (int i = 0; i < bins; i++)
            {
                profile[i] /= binWidth;
            }

            return profile;
        }

        public AnchorPoint AddManualAnchor(AnchorType type, Vector3 position, Vector3 normal, string label = "")
        {
            AnchorPoint anchor = new AnchorPoint(type, position, normal)
            {
                Label = string.IsNullOrEmpty(label) ? $"Manual_{detectedAnchors.Count}" : label,
                SnapRadius = 0.3f,
                Up = Vector3.up
            };

            switch (type)
            {
                case AnchorType.DoorFrame:
                    anchor.Template = AnchorTemplate.DoorFrame();
                    break;
                case AnchorType.WindowFrame:
                    anchor.Template = AnchorTemplate.WindowFrame();
                    break;
                case AnchorType.WallCorner:
                    anchor.Template = AnchorTemplate.WallCornerTemplate();
                    break;
                default:
                    anchor.Template = AnchorTemplate.WallCenterTemplate();
                    break;
            }

            detectedAnchors.Add(anchor);
            CreateAnchorVisualizer(anchor);

            return anchor;
        }

        public void RemoveAnchor(AnchorPoint anchor)
        {
            if (detectedAnchors.Remove(anchor))
            {
                RemoveAnchorVisualizer(anchor);
            }
        }

        private void CreateAnchorVisualizer(AnchorPoint anchor)
        {
            GameObject obj = new GameObject($"Anchor_{anchor.Label}");
            obj.transform.SetParent(transform);
            obj.transform.position = anchor.Position;

            Color color = GetAnchorColor(anchor.Type);

            GameObject visual = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            visual.transform.SetParent(obj.transform, false);
            visual.transform.localScale = Vector3.one * anchor.SnapRadius * 0.3f;

            Renderer renderer = visual.GetComponent<Renderer>();
            Material mat = new Material(Shader.Find("Universal Render Pipeline/Lit"));
            mat.color = new Color(color.r, color.g, color.b, 0.6f);
            renderer.material = mat;

            Destroy(visual.GetComponent<Collider>());

            GameObject lineObj = new GameObject("NormalLine");
            lineObj.transform.SetParent(obj.transform, false);
            LineRenderer line = lineObj.AddComponent<LineRenderer>();
            line.positionCount = 2;
            line.SetPosition(0, anchor.Position);
            line.SetPosition(1, anchor.Position + anchor.Normal * 0.5f);
            line.startWidth = 0.02f;
            line.endWidth = 0.02f;
            line.material = new Material(Shader.Find("Universal Render Pipeline/Lit"));
            line.material.color = color;

            anchorVisualizers.Add(obj);
        }

        private void RemoveAnchorVisualizer(AnchorPoint anchor)
        {
            int idx = detectedAnchors.IndexOf(anchor);
            if (idx >= 0 && idx < anchorVisualizers.Count)
            {
                Destroy(anchorVisualizers[idx]);
                anchorVisualizers.RemoveAt(idx);
            }
        }

        private Color GetAnchorColor(AnchorType type)
        {
            switch (type)
            {
                case AnchorType.WallCorner: return Color.yellow;
                case AnchorType.DoorFrame: return new Color(0.2f, 0.8f, 0.2f);
                case AnchorType.WindowFrame: return new Color(0.2f, 0.5f, 1f);
                case AnchorType.WallCenter: return Color.cyan;
                case AnchorType.WallEdge: return new Color(1f, 0.5f, 0f);
                case AnchorType.FloorCorner: return Color.red;
                case AnchorType.CeilingCorner: return Color.magenta;
                default: return Color.white;
            }
        }

        public void ClearAnchors()
        {
            foreach (var viz in anchorVisualizers)
            {
                if (viz != null) Destroy(viz);
            }
            anchorVisualizers.Clear();
            detectedAnchors.Clear();
        }

        public List<AnchorPoint> FindAnchorsInRange(Vector3 position, float range)
        {
            List<AnchorPoint> result = new List<AnchorPoint>();
            foreach (var anchor in detectedAnchors)
            {
                if (!anchor.IsActive) continue;
                if (anchor.DistanceTo(position) <= range)
                {
                    result.Add(anchor);
                }
            }
            result.Sort((a, b) => a.DistanceTo(position).CompareTo(b.DistanceTo(position)));
            return result;
        }

        public List<AnchorPoint> FindAnchorsByType(AnchorType type)
        {
            List<AnchorPoint> result = new List<AnchorPoint>();
            foreach (var anchor in detectedAnchors)
            {
                if (anchor.Type == type && anchor.IsActive)
                    result.Add(anchor);
            }
            return result;
        }

        public List<AnchorPoint> FindAnchorsByTag(string tag)
        {
            List<AnchorPoint> result = new List<AnchorPoint>();
            foreach (var anchor in detectedAnchors)
            {
                if (anchor.Tags.Contains(tag) && anchor.IsActive)
                    result.Add(anchor);
            }
            return result;
        }

        private void OnDestroy()
        {
            ClearAnchors();
        }
    }
}
