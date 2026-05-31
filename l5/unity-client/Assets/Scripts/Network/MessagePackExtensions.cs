using System;
using MessagePack;

namespace Network
{
    /// <summary>
    /// MessagePack序列化扩展类
    /// 提供对象与字节数组之间的序列化/反序列化功能
    /// </summary>
    public static class MessagePackExtensions
    {
        /// <summary>
        /// 序列化对象为字节数组
        /// </summary>
        /// <typeparam name="T">要序列化的对象类型</typeparam>
        /// <param name="obj">要序列化的对象</param>
        /// <returns>序列化后的字节数组</returns>
        /// <exception cref="ArgumentNullException">当obj为null时抛出</exception>
        /// <exception cref="Exception">序列化失败时抛出</exception>
        public static byte[] Serialize<T>(T obj)
        {
            if (obj == null)
            {
                throw new ArgumentNullException(nameof(obj), "序列化对象不能为null");
            }

            try
            {
                return MessagePackSerializer.Serialize(obj);
            }
            catch (Exception ex)
            {
                throw new Exception($"序列化类型 {typeof(T).Name} 失败: {ex.Message}", ex);
            }
        }

        /// <summary>
        /// 反序列化字节数组为对象
        /// </summary>
        /// <typeparam name="T">要反序列化的目标类型</typeparam>
        /// <param name="data">要反序列化的字节数组</param>
        /// <returns>反序列化后的对象</returns>
        /// <exception cref="ArgumentNullException">当data为null时抛出</exception>
        /// <exception cref="ArgumentException">当data长度为0时抛出</exception>
        /// <exception cref="Exception">反序列化失败时抛出</exception>
        public static T Deserialize<T>(byte[] data)
        {
            if (data == null)
            {
                throw new ArgumentNullException(nameof(data), "反序列化数据不能为null");
            }

            if (data.Length == 0)
            {
                throw new ArgumentException("反序列化数据长度不能为0", nameof(data));
            }

            try
            {
                return MessagePackSerializer.Deserialize<T>(data);
            }
            catch (Exception ex)
            {
                throw new Exception($"反序列化为类型 {typeof(T).Name} 失败: {ex.Message}", ex);
            }
        }

        /// <summary>
        /// 尝试序列化对象为字节数组
        /// </summary>
        /// <typeparam name="T">要序列化的对象类型</typeparam>
        /// <param name="obj">要序列化的对象</param>
        /// <param name="result">序列化后的字节数组，失败时为null</param>
        /// <returns>序列化成功返回true，失败返回false</returns>
        public static bool TrySerialize<T>(T obj, out byte[] result)
        {
            result = null;
            try
            {
                result = Serialize(obj);
                return true;
            }
            catch
            {
                return false;
            }
        }

        /// <summary>
        /// 尝试反序列化字节数组为对象
        /// </summary>
        /// <typeparam name="T">要反序列化的目标类型</typeparam>
        /// <param name="data">要反序列化的字节数组</param>
        /// <param name="result">反序列化后的对象，失败时为默认值</param>
        /// <returns>反序列化成功返回true，失败返回false</returns>
        public static bool TryDeserialize<T>(byte[] data, out T result)
        {
            result = default;
            try
            {
                result = Deserialize<T>(data);
                return true;
            }
            catch
            {
                return false;
            }
        }
    }
}
