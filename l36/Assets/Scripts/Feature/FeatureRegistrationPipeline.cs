using System;
using System.Collections.Generic;
using UnityEngine;

namespace LiDARFurniturePlacer.Feature
{
    public class FeatureRegistrationPipeline
    {
        public class PipelineResult
        {
            public Matrix4x4 InitialTransform;
            public List<ISSKeypointDetector.Keypoint> SourceKeypoints;
            public List<ISSKeypointDetector.Keypoint> TargetKeypoints;
            public List<SIFTLikeDescriptor.FeatureDescriptor> SourceDescriptors;
            public List<SIFTLikeDescriptor.FeatureDescriptor> TargetDescriptors;
            public List<SIFTLikeDescriptor.FeatureMatch> Matches;
            public RANSACInitialEstimator.RANSACResult RANSACResult;
            public bool Success;
            public string Message;
        }

        private ISSKeypointDetector issDetector;
        private SIFTLikeDescriptor siftDescriptor;
        private RANSACInitialEstimator ransacEstimator;

        private int maxKeypoints = 3000;
        private int maxRANSACIterations = 10000;
        private float ransacInlierThreshold = 0.1f;

        public event Action<float, string> OnProgress;

        public FeatureRegistrationPipeline()
        {
            issDetector = new ISSKeypointDetector();
            siftDescriptor = new SIFTLikeDescriptor();
            ransacEstimator = new RANSACInitialEstimator();
        }

        public int MaxKeypoints
        {
            get => maxKeypoints;
            set
            {
                maxKeypoints = value;
                issDetector.MaxKeypoints = value;
            }
        }

        public float RANSACInlierThreshold
        {
            get => ransacInlierThreshold;
            set
            {
                ransacInlierThreshold = value;
                ransacEstimator.InlierThreshold = value;
            }
        }

        public PipelineResult Run(Vector3[] sourcePoints, Vector3[] targetPoints, Matrix4x4 fallbackInitialGuess)
        {
            PipelineResult result = new PipelineResult
            {
                Success = false,
                Message = ""
            };

            OnProgress?.Invoke(0.0f, "Estimating parameters...");

            float salientRadius = ISSKeypointDetector.EstimateSalientRadius(sourcePoints);
            float supportRadius = SIFTLikeDescriptor.EstimateSupportRadius(sourcePoints);

            issDetector.SalientRadius = salientRadius;
            issDetector.NonMaxRadius = salientRadius;
            siftDescriptor.SupportRadius = supportRadius;

            OnProgress?.Invoke(0.05f, "Building KD-trees...");

            KDTree sourceTree = new KDTree(sourcePoints);
            KDTree targetTree = new KDTree(targetPoints);

            OnProgress?.Invoke(0.1f, "Detecting ISS keypoints in source...");
            result.SourceKeypoints = issDetector.DetectKeypoints(sourcePoints, sourceTree);

            if (result.SourceKeypoints.Count < 3)
            {
                Debug.LogWarning("Too few ISS keypoints in source point cloud. Trying with relaxed parameters...");
                issDetector.SalientRadius = salientRadius * 0.5f;
                issDetector.NonMaxRadius = salientRadius * 0.5f;
                result.SourceKeypoints = issDetector.DetectKeypoints(sourcePoints, sourceTree);

                if (result.SourceKeypoints.Count < 3)
                {
                    result.InitialTransform = fallbackInitialGuess;
                    result.Message = "Insufficient source keypoints, using fallback initial guess";
                    result.Success = false;
                    OnProgress?.Invoke(1.0f, result.Message);
                    return result;
                }
            }

            OnProgress?.Invoke(0.3f, "Detecting ISS keypoints in target...");
            result.TargetKeypoints = issDetector.DetectKeypoints(targetPoints, targetTree);

            if (result.TargetKeypoints.Count < 3)
            {
                Debug.LogWarning("Too few ISS keypoints in target point cloud. Trying with relaxed parameters...");
                issDetector.SalientRadius = salientRadius * 0.5f;
                issDetector.NonMaxRadius = salientRadius * 0.5f;
                result.TargetKeypoints = issDetector.DetectKeypoints(targetPoints, targetTree);

                if (result.TargetKeypoints.Count < 3)
                {
                    result.InitialTransform = fallbackInitialGuess;
                    result.Message = "Insufficient target keypoints, using fallback initial guess";
                    result.Success = false;
                    OnProgress?.Invoke(1.0f, result.Message);
                    return result;
                }
            }

            Debug.Log($"Keypoints - Source: {result.SourceKeypoints.Count}, Target: {result.TargetKeypoints.Count}");

            OnProgress?.Invoke(0.5f, "Computing SIFT-like descriptors for source...");
            result.SourceDescriptors = siftDescriptor.ComputeDescriptors(sourcePoints, result.SourceKeypoints, sourceTree);

            OnProgress?.Invoke(0.6f, "Computing SIFT-like descriptors for target...");
            result.TargetDescriptors = siftDescriptor.ComputeDescriptors(targetPoints, result.TargetKeypoints, targetTree);

            OnProgress?.Invoke(0.7f, "Matching feature descriptors...");
            result.Matches = siftDescriptor.MatchDescriptorsBidirectional(result.SourceDescriptors, result.TargetDescriptors);

            Debug.Log($"Feature matches: {result.Matches.Count}");

            if (result.Matches.Count < 3)
            {
                Debug.LogWarning("Too few feature matches. Falling back to bounding box alignment.");
                result.InitialTransform = fallbackInitialGuess;
                result.Message = "Insufficient feature matches, using fallback initial guess";
                result.Success = false;
                OnProgress?.Invoke(1.0f, result.Message);
                return result;
            }

            OnProgress?.Invoke(0.85f, "Running RANSAC initial estimation...");
            ransacEstimator.MaxIterations = maxRANSACIterations;
            ransacEstimator.InlierThreshold = ransacInlierThreshold;

            result.RANSACResult = ransacEstimator.Estimate(result.Matches);

            if (result.RANSACResult != null && result.RANSACResult.InlierCount >= 3)
            {
                result.InitialTransform = result.RANSACResult.Transform;
                result.Success = true;
                result.Message = $"RANSAC succeeded: {result.RANSACResult.InlierCount} inliers, RMSE: {result.RANSACResult.RMSE:F4}";
                Debug.Log(result.Message);
            }
            else
            {
                result.InitialTransform = fallbackInitialGuess;
                result.Message = "RANSAC failed to find good transform, using fallback";
                result.Success = false;
                Debug.LogWarning(result.Message);
            }

            OnProgress?.Invoke(1.0f, result.Message);
            return result;
        }

        public PipelineResult RunWithKnownCorrespondences(Vector3[] sourcePoints, Vector3[] targetPoints,
            List<Tuple<Vector3, Vector3>> manualCorrespondences)
        {
            PipelineResult result = new PipelineResult
            {
                Success = true,
                SourceKeypoints = new List<ISSKeypointDetector.Keypoint>(),
                TargetKeypoints = new List<ISSKeypointDetector.Keypoint>(),
                Matches = new List<SIFTLikeDescriptor.FeatureMatch>()
            };

            RANSACInitialEstimator estimator = new RANSACInitialEstimator
            {
                MaxIterations = 1000,
                InlierThreshold = ransacInlierThreshold
            };

            List<SIFTLikeDescriptor.FeatureMatch> fakeMatches = new List<SIFTLikeDescriptor.FeatureMatch>();
            foreach (var corr in manualCorrespondences)
            {
                SIFTLikeDescriptor.FeatureMatch match = new SIFTLikeDescriptor.FeatureMatch
                {
                    Source = new SIFTLikeDescriptor.FeatureDescriptor
                    {
                        Keypoint = new ISSKeypointDetector.Keypoint { Position = corr.Item1 }
                    },
                    Target = new SIFTLikeDescriptor.FeatureDescriptor
                    {
                        Keypoint = new ISSKeypointDetector.Keypoint { Position = corr.Item2 }
                    },
                    Distance = 0,
                    RatioTest = 0
                };
                fakeMatches.Add(match);
            }

            result.RANSACResult = estimator.Estimate(fakeMatches);

            if (result.RANSACResult != null)
            {
                result.InitialTransform = result.RANSACResult.Transform;
                result.Message = $"Manual correspondences: {result.RANSACResult.InlierCount} inliers";
            }
            else
            {
                result.InitialTransform = Matrix4x4.identity;
                result.Success = false;
                result.Message = "Failed to estimate from manual correspondences";
            }

            return result;
        }
    }
}
