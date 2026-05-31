using System;
using System.Collections.Generic;
using UnityEngine;

namespace LiDARFurniturePlacer.Feature
{
    public class SIFTLikeDescriptor
    {
        public struct FeatureDescriptor
        {
            public ISSKeypointDetector.Keypoint Keypoint;
            public float[] Histogram;
            public int DescriptorSize;
        }

        public struct FeatureMatch
        {
            public FeatureDescriptor Source;
            public FeatureDescriptor Target;
            public float Distance;
            public float RatioTest;
        }

        private int angularBins = 8;
        private int spatialBins = 4;
        private float supportRadius;
        private float matchThreshold = 0.8f;

        public int DescriptorLength => angularBins * spatialBins * spatialBins;

        public SIFTLikeDescriptor(float supportRadius = 0.2f)
        {
            this.supportRadius = supportRadius;
        }

        public float SupportRadius
        {
            get => supportRadius;
            set => supportRadius = value;
        }

        public List<FeatureDescriptor> ComputeDescriptors(Vector3[] points, List<ISSKeypointDetector.Keypoint> keypoints, KDTree tree)
        {
            List<FeatureDescriptor> descriptors = new List<FeatureDescriptor>();
            int descLength = DescriptorLength;

            for (int k = 0; k < keypoints.Count; k++)
            {
                FeatureDescriptor desc = new FeatureDescriptor
                {
                    Keypoint = keypoints[k],
                    Histogram = new float[descLength],
                    DescriptorSize = descLength
                };

                ComputeSingleDescriptor(points, keypoints[k], tree, desc.Histogram);

                NormalizeDescriptor(desc.Histogram);
                descriptors.Add(desc);
            }

            return descriptors;
        }

        private void ComputeSingleDescriptor(Vector3[] points, ISSKeypointDetector.Keypoint keypoint, KDTree tree, float[] histogram)
        {
            Vector3 kp = keypoint.Position;
            Vector3 normal = keypoint.Normal;

            if (normal.sqrMagnitude < 0.001f)
            {
                normal = Vector3.up;
            }
            normal = normal.normalized;

            Vector3 up = Mathf.Abs(Vector3.Dot(normal, Vector3.up)) > 0.99f ? Vector3.right : Vector3.up;
            Vector3 localX = Vector3.Cross(up, normal).normalized;
            Vector3 localY = Vector3.Cross(normal, localX).normalized;

            int[] neighbors = tree.FindRadius(kp, supportRadius, out double[] distances);

            if (neighbors.Length < 3)
                return;

            float binSize = supportRadius / spatialBins;

            for (int i = 0; i < neighbors.Length; i++)
            {
                int idx = neighbors[i];
                Vector3 p = points[idx];

                Vector3 diff = p - kp;
                float radialDist = diff.magnitude;

                if (radialDist > supportRadius)
                    continue;

                float localXCoord = Vector3.Dot(diff, localX);
                float localYCoord = Vector3.Dot(diff, localY);
                float localZCoord = Vector3.Dot(diff, normal);

                int spatialBinX = Mathf.Clamp(Mathf.FloorToInt((localXCoord + supportRadius) / (2 * supportRadius) * spatialBins), 0, spatialBins - 1);
                int spatialBinY = Mathf.Clamp(Mathf.FloorToInt((localYCoord + supportRadius) / (2 * supportRadius) * spatialBins), 0, spatialBins - 1);

                Vector3 localPoint = new Vector3(localXCoord, localYCoord, localZCoord);
                float azimuth = Mathf.Atan2(localPoint.y, localPoint.x);
                if (azimuth < 0) azimuth += 2 * Mathf.PI;

                int angularBin = Mathf.Clamp(Mathf.FloorToInt(azimuth / (2 * Mathf.PI) * angularBins), 0, angularBins - 1);

                float weight = GaussianWeight(radialDist, supportRadius * 0.5f);
                float elevation = Mathf.Asin(Mathf.Clamp(localZCoord / Mathf.Max(radialDist, 0.0001f), -1, 1));
                weight *= (1 + Mathf.Cos(elevation));

                int histogramIndex = (spatialBinY * spatialBins + spatialBinX) * angularBins + angularBin;
                histogram[histogramIndex] += weight;
            }
        }

        private float GaussianWeight(float distance, float sigma)
        {
            return (float)Math.Exp(-(distance * distance) / (2 * sigma * sigma));
        }

        private void NormalizeDescriptor(float[] histogram)
        {
            float norm = 0;
            for (int i = 0; i < histogram.Length; i++)
            {
                norm += histogram[i] * histogram[i];
            }
            norm = (float)Math.Sqrt(norm);

            if (norm < 1e-10f)
                return;

            for (int i = 0; i < histogram.Length; i++)
            {
                histogram[i] /= norm;
                if (histogram[i] > 0.2f)
                {
                    histogram[i] = 0.2f;
                }
            }

            norm = 0;
            for (int i = 0; i < histogram.Length; i++)
            {
                norm += histogram[i] * histogram[i];
            }
            norm = (float)Math.Sqrt(norm);

            if (norm < 1e-10f)
                return;

            for (int i = 0; i < histogram.Length; i++)
            {
                histogram[i] /= norm;
            }
        }

        public List<FeatureMatch> MatchDescriptors(List<FeatureDescriptor> source, List<FeatureDescriptor> target)
        {
            List<FeatureMatch> matches = new List<FeatureMatch>();

            for (int i = 0; i < source.Count; i++)
            {
                float bestDist = float.MaxValue;
                int bestIdx = -1;
                float secondBestDist = float.MaxValue;

                for (int j = 0; j < target.Count; j++)
                {
                    float dist = DescriptorDistance(source[i].Histogram, target[j].Histogram);

                    if (dist < bestDist)
                    {
                        secondBestDist = bestDist;
                        bestDist = dist;
                        bestIdx = j;
                    }
                    else if (dist < secondBestDist)
                    {
                        secondBestDist = dist;
                    }
                }

                if (bestIdx < 0)
                    continue;

                float ratio = bestDist / Mathf.Max(secondBestDist, 1e-10f);

                if (ratio < matchThreshold)
                {
                    matches.Add(new FeatureMatch
                    {
                        Source = source[i],
                        Target = target[bestIdx],
                        Distance = bestDist,
                        RatioTest = ratio
                    });
                }
            }

            matches.Sort((a, b) => a.Distance.CompareTo(b.Distance));
            return matches;
        }

        private float DescriptorDistance(float[] a, float[] b)
        {
            float sum = 0;
            int len = Math.Min(a.Length, b.Length);
            for (int i = 0; i < len; i++)
            {
                float diff = a[i] - b[i];
                sum += diff * diff;
            }
            return (float)Math.Sqrt(sum);
        }

        public List<FeatureMatch> MatchDescriptorsBidirectional(List<FeatureDescriptor> source, List<FeatureDescriptor> target)
        {
            List<FeatureMatch> forwardMatches = MatchDescriptors(source, target);
            List<FeatureMatch> backwardMatches = MatchDescriptors(target, source);

            Dictionary<int, int> backwardMap = new Dictionary<int, int>();
            for (int i = 0; i < backwardMatches.Count; i++)
            {
                int srcIdx = backwardMatches[i].Target.Keypoint.OriginalIndex;
                int tgtIdx = backwardMatches[i].Source.Keypoint.OriginalIndex;
                backwardMap[srcIdx] = tgtIdx;
            }

            List<FeatureMatch> consistentMatches = new List<FeatureMatch>();
            for (int i = 0; i < forwardMatches.Count; i++)
            {
                int srcIdx = forwardMatches[i].Source.Keypoint.OriginalIndex;
                int tgtIdx = forwardMatches[i].Target.Keypoint.OriginalIndex;

                if (backwardMap.ContainsKey(srcIdx) && backwardMap[srcIdx] == tgtIdx)
                {
                    consistentMatches.Add(forwardMatches[i]);
                }
            }

            return consistentMatches;
        }

        public static float EstimateSupportRadius(Vector3[] points)
        {
            if (points == null || points.Length == 0)
                return 0.2f;

            KDTree tree = new KDTree(points);
            double avgDist = 0;
            int count = 0;
            int sampleStep = Math.Max(1, points.Length / 500);

            for (int i = 0; i < points.Length; i += sampleStep)
            {
                int[] knn = tree.FindKNearest(points[i], 2, out double[] dists);
                if (knn.Length >= 2 && dists[1] > 0)
                {
                    avgDist += Math.Sqrt(dists[1]);
                    count++;
                }
            }

            if (count > 0)
            {
                avgDist /= count;
                return (float)(avgDist * 10.0);
            }

            return 0.2f;
        }
    }
}
