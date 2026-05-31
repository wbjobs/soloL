using System;
using UnityEngine;

namespace LiDARFurniturePlacer.ICP
{
    public class KDTree
    {
        private class KDNode
        {
            public int PointIndex;
            public int Axis;
            public KDNode Left;
            public KDNode Right;
        }

        private Vector3[] points;
        private KDNode root;

        public int PointCount => points != null ? points.Length : 0;

        public KDTree(Vector3[] points)
        {
            this.points = points;
            int[] indices = new int[points.Length];
            for (int i = 0; i < points.Length; i++)
            {
                indices[i] = i;
            }

            root = BuildTree(indices, 0, indices.Length - 1, 0);
        }

        private KDNode BuildTree(int[] indices, int start, int end, int axis)
        {
            if (start > end)
                return null;

            int mid = (start + end) / 2;

            QuickSelect(indices, start, end, mid, axis);

            KDNode node = new KDNode
            {
                PointIndex = indices[mid],
                Axis = axis
            };

            int nextAxis = (axis + 1) % 3;
            node.Left = BuildTree(indices, start, mid - 1, nextAxis);
            node.Right = BuildTree(indices, mid + 1, end, nextAxis);

            return node;
        }

        private void QuickSelect(int[] indices, int start, int end, int k, int axis)
        {
            while (start < end)
            {
                int pivotIndex = Partition(indices, start, end, axis);
                if (pivotIndex == k)
                    return;
                if (k < pivotIndex)
                    end = pivotIndex - 1;
                else
                    start = pivotIndex + 1;
            }
        }

        private int Partition(int[] indices, int start, int end, int axis)
        {
            int pivotIndex = (start + end) / 2;
            float pivotValue = GetAxisValue(points[indices[pivotIndex]], axis);

            (indices[pivotIndex], indices[end]) = (indices[end], indices[pivotIndex]);

            int storeIndex = start;
            for (int i = start; i < end; i++)
            {
                if (GetAxisValue(points[indices[i]], axis) < pivotValue)
                {
                    (indices[storeIndex], indices[i]) = (indices[i], indices[storeIndex]);
                    storeIndex++;
                }
            }

            (indices[storeIndex], indices[end]) = (indices[end], indices[storeIndex]);
            return storeIndex;
        }

        private float GetAxisValue(Vector3 point, int axis)
        {
            switch (axis)
            {
                case 0: return point.x;
                case 1: return point.y;
                case 2: return point.z;
                default: return 0;
            }
        }

        public int FindNearest(Vector3 query, out double distanceSquared)
        {
            int bestIndex = -1;
            double bestDistSq = double.MaxValue;

            FindNearestRecursive(root, query, ref bestIndex, ref bestDistSq);

            distanceSquared = bestDistSq;
            return bestIndex;
        }

        private void FindNearestRecursive(KDNode node, Vector3 query, ref int bestIndex, ref double bestDistSq)
        {
            if (node == null)
                return;

            Vector3 point = points[node.PointIndex];
            double distSq = (point - query).sqrMagnitude;

            if (distSq < bestDistSq)
            {
                bestDistSq = distSq;
                bestIndex = node.PointIndex;
            }

            float axisValue = GetAxisValue(query, node.Axis);
            float nodeAxisValue = GetAxisValue(point, node.Axis);

            KDNode nearChild, farChild;
            if (axisValue < nodeAxisValue)
            {
                nearChild = node.Left;
                farChild = node.Right;
            }
            else
            {
                nearChild = node.Right;
                farChild = node.Left;
            }

            FindNearestRecursive(nearChild, query, ref bestIndex, ref bestDistSq);

            double planeDistSq = (axisValue - nodeAxisValue) * (axisValue - nodeAxisValue);
            if (planeDistSq < bestDistSq)
            {
                FindNearestRecursive(farChild, query, ref bestIndex, ref bestDistSq);
            }
        }

        public int[] FindKNearest(Vector3 query, int k, out double[] distancesSquared)
        {
            if (k <= 0)
            {
                distancesSquared = new double[0];
                return new int[0];
            }

            int[] result = new int[k];
            double[] dists = new double[k];
            for (int i = 0; i < k; i++)
            {
                result[i] = -1;
                dists[i] = double.MaxValue;
            }

            FindKNearestRecursive(root, query, k, result, dists);

            Array.Sort(dists, result);
            distancesSquared = dists;
            return result;
        }

        private void FindKNearestRecursive(KDNode node, Vector3 query, int k, int[] result, double[] dists)
        {
            if (node == null)
                return;

            Vector3 point = points[node.PointIndex];
            double distSq = (point - query).sqrMagnitude;

            if (distSq < dists[k - 1])
            {
                int insertPos = k - 1;
                while (insertPos > 0 && distSq < dists[insertPos - 1])
                {
                    result[insertPos] = result[insertPos - 1];
                    dists[insertPos] = dists[insertPos - 1];
                    insertPos--;
                }
                result[insertPos] = node.PointIndex;
                dists[insertPos] = distSq;
            }

            float axisValue = GetAxisValue(query, node.Axis);
            float nodeAxisValue = GetAxisValue(point, node.Axis);

            KDNode nearChild, farChild;
            if (axisValue < nodeAxisValue)
            {
                nearChild = node.Left;
                farChild = node.Right;
            }
            else
            {
                nearChild = node.Right;
                farChild = node.Left;
            }

            FindKNearestRecursive(nearChild, query, k, result, dists);

            double planeDistSq = (axisValue - nodeAxisValue) * (axisValue - nodeAxisValue);
            if (planeDistSq < dists[k - 1])
            {
                FindKNearestRecursive(farChild, query, k, result, dists);
            }
        }

        public int[] FindRadius(Vector3 query, double radius, out double[] distancesSquared)
        {
            double radiusSq = radius * radius;
            System.Collections.Generic.List<int> indices = new System.Collections.Generic.List<int>();
            System.Collections.Generic.List<double> dists = new System.Collections.Generic.List<double>();

            FindRadiusRecursive(root, query, radiusSq, indices, dists);

            distancesSquared = dists.ToArray();
            return indices.ToArray();
        }

        private void FindRadiusRecursive(KDNode node, Vector3 query, double radiusSq,
            System.Collections.Generic.List<int> indices, System.Collections.Generic.List<double> dists)
        {
            if (node == null)
                return;

            Vector3 point = points[node.PointIndex];
            double distSq = (point - query).sqrMagnitude;

            if (distSq <= radiusSq)
            {
                indices.Add(node.PointIndex);
                dists.Add(distSq);
            }

            float axisValue = GetAxisValue(query, node.Axis);
            float nodeAxisValue = GetAxisValue(point, node.Axis);

            KDNode nearChild, farChild;
            if (axisValue < nodeAxisValue)
            {
                nearChild = node.Left;
                farChild = node.Right;
            }
            else
            {
                nearChild = node.Right;
                farChild = node.Left;
            }

            FindRadiusRecursive(nearChild, query, radiusSq, indices, dists);

            double planeDistSq = (axisValue - nodeAxisValue) * (axisValue - nodeAxisValue);
            if (planeDistSq <= radiusSq)
            {
                FindRadiusRecursive(farChild, query, radiusSq, indices, dists);
            }
        }
    }
}
