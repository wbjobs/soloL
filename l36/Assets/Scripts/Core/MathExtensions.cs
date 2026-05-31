using UnityEngine;

namespace LiDARFurniturePlacer.Core
{
    public static class MathExtensions
    {
        public static Vector3 ToVector3(this float[] arr)
        {
            if (arr == null || arr.Length < 3)
                return Vector3.zero;
            return new Vector3(arr[0], arr[1], arr[2]);
        }

        public static float[] ToFloatArray(this Vector3 vec)
        {
            return new float[] { vec.x, vec.y, vec.z };
        }

        public static Matrix4x4 ToMatrix4x4(this double[,] matrix)
        {
            Matrix4x4 result = Matrix4x4.identity;
            for (int i = 0; i < 4 && i < matrix.GetLength(0); i++)
            {
                for (int j = 0; j < 4 && j < matrix.GetLength(1); j++)
                {
                    result[i, j] = (float)matrix[i, j];
                }
            }
            return result;
        }

        public static double[,] ToDoubleArray(this Matrix4x4 matrix)
        {
            double[,] result = new double[4, 4];
            for (int i = 0; i < 4; i++)
            {
                for (int j = 0; j < 4; j++)
                {
                    result[i, j] = matrix[i, j];
                }
            }
            return result;
        }

        public static Vector3 GetTranslation(this Matrix4x4 matrix)
        {
            return new Vector3(matrix[0, 3], matrix[1, 3], matrix[2, 3]);
        }

        public static Quaternion GetRotation(this Matrix4x4 matrix)
        {
            return Quaternion.LookRotation(
                new Vector3(matrix[0, 2], matrix[1, 2], matrix[2, 2]),
                new Vector3(matrix[0, 1], matrix[1, 1], matrix[2, 1])
            );
        }

        public static Vector3 GetScale(this Matrix4x4 matrix)
        {
            return new Vector3(
                matrix.GetColumn(0).magnitude,
                matrix.GetColumn(1).magnitude,
                matrix.GetColumn(2).magnitude
            );
        }

        public static float DistanceToPoint(this Vector3 a, Vector3 b)
        {
            return Vector3.Distance(a, b);
        }

        public static float SqrDistanceToPoint(this Vector3 a, Vector3 b)
        {
            return (a - b).sqrMagnitude;
        }
    }

    public static class ColorExtensions
    {
        public static Color FromRGB255(byte r, byte g, byte b, byte a = 255)
        {
            return new Color(r / 255f, g / 255f, b / 255f, a / 255f);
        }

        public static Color HeightGradient(float height, float minHeight, float maxHeight)
        {
            float t = Mathf.InverseLerp(minHeight, maxHeight, height);
            return Color.Lerp(Color.blue, Color.red, t);
        }

        public static Color NormalColor(Vector3 normal)
        {
            return new Color(
                Mathf.Abs(normal.x),
                Mathf.Abs(normal.y),
                Mathf.Abs(normal.z)
            );
        }
    }
}
