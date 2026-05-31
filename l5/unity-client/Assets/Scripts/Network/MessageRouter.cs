using System;
using System.Collections.Generic;
using UnityEngine;

namespace Network
{
    /// <summary>
    /// 消息路由器，负责根据消息类型将消息路由到对应的处理函数
    /// 线程安全，支持多线程环境下的注册和路由
    /// </summary>
    public class MessageRouter
    {
        private readonly Dictionary<int, Action<byte[]>> _handlers = new Dictionary<int, Action<byte[]>>();
        private readonly object _lock = new object();

        /// <summary>
        /// 注册消息处理函数
        /// </summary>
        /// <param name="messageType">消息类型ID</param>
        /// <param name="handler">处理函数，参数为消息数据字节数组</param>
        /// <exception cref="ArgumentNullException">当handler为null时抛出</exception>
        /// <exception cref="ArgumentException">当该消息类型已注册处理函数时抛出</exception>
        public void RegisterHandler(int messageType, Action<byte[]> handler)
        {
            if (handler == null)
            {
                throw new ArgumentNullException(nameof(handler), "消息处理函数不能为null");
            }

            lock (_lock)
            {
                if (_handlers.ContainsKey(messageType))
                {
                    throw new ArgumentException($"消息类型 {messageType} 已注册处理函数", nameof(messageType));
                }

                _handlers[messageType] = handler;
                Debug.Log($"[MessageRouter] 已注册消息类型 {messageType} 的处理函数");
            }
        }

        /// <summary>
        /// 注册泛型消息处理函数，自动反序列化消息数据
        /// </summary>
        /// <typeparam name="T">消息数据类型</typeparam>
        /// <param name="messageType">消息类型ID</param>
        /// <param name="handler">处理函数，参数为反序列化后的对象</param>
        /// <exception cref="ArgumentNullException">当handler为null时抛出</exception>
        /// <exception cref="ArgumentException">当该消息类型已注册处理函数时抛出</exception>
        public void RegisterHandler<T>(int messageType, Action<T> handler)
        {
            if (handler == null)
            {
                throw new ArgumentNullException(nameof(handler), "消息处理函数不能为null");
            }

            void WrappedHandler(byte[] data)
            {
                try
                {
                    T obj = MessagePackExtensions.Deserialize<T>(data);
                    handler(obj);
                }
                catch (Exception ex)
                {
                    Debug.LogError($"[MessageRouter] 处理消息类型 {messageType} 时反序列化失败: {ex.Message}");
                }
            }

            RegisterHandler(messageType, WrappedHandler);
        }

        /// <summary>
        /// 取消注册消息处理函数
        /// </summary>
        /// <param name="messageType">消息类型ID</param>
        /// <returns>取消成功返回true，未找到返回false</returns>
        public bool UnregisterHandler(int messageType)
        {
            lock (_lock)
            {
                bool removed = _handlers.Remove(messageType);
                if (removed)
                {
                    Debug.Log($"[MessageRouter] 已取消注册消息类型 {messageType} 的处理函数");
                }
                return removed;
            }
        }

        /// <summary>
        /// 检查是否已注册指定消息类型的处理函数
        /// </summary>
        /// <param name="messageType">消息类型ID</param>
        /// <returns>已注册返回true，否则返回false</returns>
        public bool HasHandler(int messageType)
        {
            lock (_lock)
            {
                return _handlers.ContainsKey(messageType);
            }
        }

        /// <summary>
        /// 路由消息到对应的处理函数
        /// </summary>
        /// <param name="messageType">消息类型ID</param>
        /// <param name="data">消息数据字节数组</param>
        /// <returns>找到处理函数并执行返回true，否则返回false</returns>
        public bool RouteMessage(int messageType, byte[] data)
        {
            Action<byte[]> handler = null;

            lock (_lock)
            {
                if (_handlers.TryGetValue(messageType, out handler))
                {
                }
            }

            if (handler != null)
            {
                try
                {
                    handler(data);
                    return true;
                }
                catch (Exception ex)
                {
                    Debug.LogError($"[MessageRouter] 执行消息类型 {messageType} 的处理函数时出错: {ex.Message}");
                    return false;
                }
            }
            else
            {
                Debug.LogWarning($"[MessageRouter] 未找到消息类型 {messageType} 的处理函数");
                return false;
            }
        }

        /// <summary>
        /// 清空所有已注册的处理函数
        /// </summary>
        public void ClearAllHandlers()
        {
            lock (_lock)
            {
                int count = _handlers.Count;
                _handlers.Clear();
                Debug.Log($"[MessageRouter] 已清空所有处理函数，共 {count} 个");
            }
        }

        /// <summary>
        /// 获取所有已注册的消息类型
        /// </summary>
        /// <returns>消息类型ID数组</returns>
        public int[] GetRegisteredMessageTypes()
        {
            lock (_lock)
            {
                int[] result = new int[_handlers.Count];
                _handlers.Keys.CopyTo(result, 0);
                return result;
            }
        }

        /// <summary>
        /// 获取已注册处理函数的数量
        /// </summary>
        public int HandlerCount
        {
            get
            {
                lock (_lock)
                {
                    return _handlers.Count;
                }
            }
        }
    }
}
