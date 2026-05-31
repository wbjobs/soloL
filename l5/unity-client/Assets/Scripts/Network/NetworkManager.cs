using System;
using System.Collections.Generic;
using UnityEngine;

namespace Network
{
    /// <summary>
    /// 重连状态枚举
    /// </summary>
    public enum ReconnectState
    {
        /// <summary>
        /// 未连接
        /// </summary>
        Disconnected,

        /// <summary>
        /// 连接中
        /// </summary>
        Connecting,

        /// <summary>
        /// 已连接
        /// </summary>
        Connected,

        /// <summary>
        /// 重连中
        /// </summary>
        Reconnecting,

        /// <summary>
        /// 重连失败
        /// </summary>
        ReconnectFailed
    }

    /// <summary>
    /// 网络管理器单例，封装WebSocket客户端和消息路由器
    /// 处理跨线程消息队列，确保在Unity主线程中执行消息处理
    /// </summary>
    public class NetworkManager : MonoBehaviour
    {
        private static NetworkManager _instance;
        private static readonly object _instanceLock = new object();
        private static bool _applicationIsQuitting = false;

        private WebSocketClient _webSocketClient;
        private MessageRouter _messageRouter;
        private Queue<Action> _messageQueue = new Queue<Action>();
        private readonly object _queueLock = new object();

        /// <summary>
        /// 网络管理器单例实例
        /// </summary>
        public static NetworkManager Instance
        {
            get
            {
                if (_applicationIsQuitting)
                {
                    Debug.LogWarning("[NetworkManager] 应用程序正在退出，不返回实例");
                    return null;
                }

                lock (_instanceLock)
                {
                    if (_instance == null)
                    {
                        _instance = FindObjectOfType<NetworkManager>();

                        if (_instance == null)
                        {
                            GameObject singletonObject = new GameObject();
                            _instance = singletonObject.AddComponent<NetworkManager>();
                            singletonObject.name = typeof(NetworkManager).ToString() + " (Singleton)";
                            DontDestroyOnLoad(singletonObject);
                        }
                    }

                    return _instance;
                }
            }
        }

        /// <summary>
        /// 是否已连接到服务器
        /// </summary>
        public bool IsConnected => _webSocketClient != null && _webSocketClient.IsConnected;

        /// <summary>
        /// 当前重连状态
        /// </summary>
        public ReconnectState CurrentState { get; private set; } = ReconnectState.Disconnected;

        /// <summary>
        /// 当前重连尝试次数
        /// </summary>
        public int ReconnectAttempt { get; private set; }

        /// <summary>
        /// 最大重连尝试次数
        /// </summary>
        public int MaxReconnectAttempts { get; private set; } = 3;

        /// <summary>
        /// 消息路由器实例
        /// </summary>
        public MessageRouter Router => _messageRouter;

        /// <summary>
        /// 连接成功事件
        /// </summary>
        public event Action OnConnected;

        /// <summary>
        /// 断开连接事件
        /// </summary>
        public event Action OnDisconnected;

        /// <summary>
        /// 错误事件
        /// </summary>
        public event Action<Exception> OnError;

        /// <summary>
        /// 重连尝试事件（参数：当前尝试次数，最大尝试次数）
        /// </summary>
        public event Action<int, int> OnReconnectAttempt;

        /// <summary>
        /// 重连成功事件
        /// </summary>
        public event Action OnReconnected;

        /// <summary>
        /// 重连失败事件
        /// </summary>
        public event Action OnReconnectFailed;

        /// <summary>
        /// Awake时初始化
        /// </summary>
        private void Awake()
        {
            lock (_instanceLock)
            {
                if (_instance == null)
                {
                    _instance = this;
                    DontDestroyOnLoad(gameObject);
                }
                else if (_instance != this)
                {
                    Destroy(gameObject);
                    return;
                }
            }

            Initialize();
        }

        /// <summary>
        /// 初始化网络组件
        /// </summary>
        private void Initialize()
        {
            _webSocketClient = new WebSocketClient();
            _messageRouter = new MessageRouter();

            _webSocketClient.OnConnected += HandleWebSocketConnected;
            _webSocketClient.OnDisconnected += HandleWebSocketDisconnected;
            _webSocketClient.OnMessageReceived += HandleWebSocketMessageReceived;
            _webSocketClient.OnError += HandleWebSocketError;
            _webSocketClient.OnReconnectAttempt += HandleWebSocketReconnectAttempt;
            _webSocketClient.OnReconnected += HandleWebSocketReconnected;
            _webSocketClient.OnReconnectFailed += HandleWebSocketReconnectFailed;

            Debug.Log("[NetworkManager] 初始化完成");
        }

        /// <summary>
        /// 每帧处理消息队列
        /// </summary>
        private void Update()
        {
            ProcessMessageQueue();
        }

        /// <summary>
        /// 处理消息队列，确保在Unity主线程执行
        /// </summary>
        private void ProcessMessageQueue()
        {
            if (_messageQueue.Count == 0)
            {
                return;
            }

            lock (_queueLock)
            {
                while (_messageQueue.Count > 0)
                {
                    Action action = _messageQueue.Dequeue();
                    try
                    {
                        action?.Invoke();
                    }
                    catch (Exception ex)
                    {
                        Debug.LogError($"[NetworkManager] 执行消息队列任务时出错: {ex.Message}");
                        OnError?.Invoke(ex);
                    }
                }
            }
        }

        /// <summary>
        /// 将任务添加到消息队列，在Unity主线程执行
        /// </summary>
        /// <param name="action">要执行的任务</param>
        private void EnqueueTask(Action action)
        {
            if (action == null)
            {
                return;
            }

            lock (_queueLock)
            {
                _messageQueue.Enqueue(action);
            }
        }

        /// <summary>
        /// 连接到服务器
        /// </summary>
        /// <param name="url">服务器地址，例如 ws://localhost:8080/ws</param>
        /// <param name="playerId">玩家ID</param>
        public async void Connect(string url, string playerId)
        {
            if (string.IsNullOrEmpty(url))
            {
                throw new ArgumentException("服务器地址不能为空", nameof(url));
            }

            if (string.IsNullOrEmpty(playerId))
            {
                throw new ArgumentException("玩家ID不能为空", nameof(playerId));
            }

            if (IsConnected)
            {
                Debug.LogWarning("[NetworkManager] 已经连接到服务器");
                return;
            }

            CurrentState = ReconnectState.Connecting;
            Debug.Log($"[NetworkManager] 正在连接到服务器: {url}, 玩家ID: {playerId}");

            try
            {
                await _webSocketClient.Connect(url, playerId);
            }
            catch (Exception ex)
            {
                Debug.LogError($"[NetworkManager] 连接失败: {ex.Message}");
                CurrentState = ReconnectState.Disconnected;
                OnError?.Invoke(ex);
            }
        }

        /// <summary>
        /// 断开与服务器的连接
        /// </summary>
        public async void Disconnect()
        {
            if (!IsConnected && CurrentState == ReconnectState.Disconnected)
            {
                Debug.LogWarning("[NetworkManager] 当前未连接到服务器");
                return;
            }

            Debug.Log("[NetworkManager] 正在断开连接...");

            try
            {
                await _webSocketClient.Disconnect();
            }
            catch (Exception ex)
            {
                Debug.LogError($"[NetworkManager] 断开连接时出错: {ex.Message}");
                OnError?.Invoke(ex);
            }
        }

        /// <summary>
        /// 发送消息
        /// </summary>
        /// <typeparam name="T">消息数据类型</typeparam>
        /// <param name="messageType">消息类型ID</param>
        /// <param name="data">消息数据对象</param>
        public async void Send<T>(int messageType, T data)
        {
            if (!IsConnected)
            {
                Debug.LogError("[NetworkManager] 未连接到服务器，无法发送消息");
                throw new InvalidOperationException("未连接到服务器");
            }

            try
            {
                await _webSocketClient.SendMessage(messageType, data);
            }
            catch (Exception ex)
            {
                Debug.LogError($"[NetworkManager] 发送消息失败 (类型: {messageType}): {ex.Message}");
                OnError?.Invoke(ex);
                throw;
            }
        }

        /// <summary>
        /// 发送原始字节消息
        /// </summary>
        /// <param name="messageType">消息类型ID</param>
        /// <param name="data">消息数据字节数组</param>
        public async void SendRaw(int messageType, byte[] data)
        {
            if (!IsConnected)
            {
                Debug.LogError("[NetworkManager] 未连接到服务器，无法发送消息");
                throw new InvalidOperationException("未连接到服务器");
            }

            try
            {
                await _webSocketClient.SendMessageRaw(messageType, data);
            }
            catch (Exception ex)
            {
                Debug.LogError($"[NetworkManager] 发送原始消息失败 (类型: {messageType}): {ex.Message}");
                OnError?.Invoke(ex);
                throw;
            }
        }

        /// <summary>
        /// 注册消息处理函数
        /// </summary>
        /// <param name="messageType">消息类型ID</param>
        /// <param name="handler">处理函数，参数为消息数据字节数组</param>
        public void RegisterHandler(int messageType, Action<byte[]> handler)
        {
            _messageRouter.RegisterHandler(messageType, handler);
        }

        /// <summary>
        /// 注册泛型消息处理函数，自动反序列化
        /// </summary>
        /// <typeparam name="T">消息数据类型</typeparam>
        /// <param name="messageType">消息类型ID</param>
        /// <param name="handler">处理函数，参数为反序列化后的对象</param>
        public void RegisterHandler<T>(int messageType, Action<T> handler)
        {
            _messageRouter.RegisterHandler<T>(messageType, handler);
        }

        /// <summary>
        /// 取消注册消息处理函数
        /// </summary>
        /// <param name="messageType">消息类型ID</param>
        /// <returns>取消成功返回true</returns>
        public bool UnregisterHandler(int messageType)
        {
            return _messageRouter.UnregisterHandler(messageType);
        }

        /// <summary>
        /// 处理WebSocket连接成功事件
        /// </summary>
        private void HandleWebSocketConnected()
        {
            EnqueueTask(() =>
            {
                CurrentState = ReconnectState.Connected;
                ReconnectAttempt = 0;
                Debug.Log("[NetworkManager] 连接成功");
                OnConnected?.Invoke();
            });
        }

        /// <summary>
        /// 处理WebSocket断开连接事件
        /// </summary>
        private void HandleWebSocketDisconnected()
        {
            EnqueueTask(() =>
            {
                if (CurrentState != ReconnectState.Reconnecting &&
                    CurrentState != ReconnectState.Connecting)
                {
                    CurrentState = ReconnectState.Disconnected;
                }
                Debug.Log("[NetworkManager] 断开连接");
                OnDisconnected?.Invoke();
            });
        }

        /// <summary>
        /// 处理WebSocket收到消息事件
        /// </summary>
        private void HandleWebSocketMessageReceived(int messageType, byte[] data)
        {
            EnqueueTask(() =>
            {
                bool routed = _messageRouter.RouteMessage(messageType, data);
                if (!routed)
                {
                    Debug.LogWarning($"[NetworkManager] 消息类型 {messageType} 未被处理");
                }
            });
        }

        /// <summary>
        /// 处理WebSocket错误事件
        /// </summary>
        private void HandleWebSocketError(Exception ex)
        {
            EnqueueTask(() =>
            {
                Debug.LogError($"[NetworkManager] 网络错误: {ex.Message}");
                OnError?.Invoke(ex);
            });
        }

        /// <summary>
        /// 处理WebSocket重连尝试事件
        /// </summary>
        private void HandleWebSocketReconnectAttempt(int attempt, int maxAttempts)
        {
            EnqueueTask(() =>
            {
                CurrentState = ReconnectState.Reconnecting;
                ReconnectAttempt = attempt;
                MaxReconnectAttempts = maxAttempts;
                Debug.Log($"[NetworkManager] 正在尝试第 {attempt}/{maxAttempts} 次重连");
                OnReconnectAttempt?.Invoke(attempt, maxAttempts);
            });
        }

        /// <summary>
        /// 处理WebSocket重连成功事件
        /// </summary>
        private void HandleWebSocketReconnected()
        {
            EnqueueTask(() =>
            {
                CurrentState = ReconnectState.Connected;
                ReconnectAttempt = 0;
                Debug.Log("[NetworkManager] 重连成功");
                OnReconnected?.Invoke();
            });
        }

        /// <summary>
        /// 处理WebSocket重连失败事件
        /// </summary>
        private void HandleWebSocketReconnectFailed()
        {
            EnqueueTask(() =>
            {
                CurrentState = ReconnectState.ReconnectFailed;
                Debug.LogError("[NetworkManager] 重连失败");
                OnReconnectFailed?.Invoke();
            });
        }

        /// <summary>
        /// 应用程序退出时清理
        /// </summary>
        private void OnApplicationQuit()
        {
            _applicationIsQuitting = true;
            Dispose();
        }

        /// <summary>
        /// 销毁时清理资源
        /// </summary>
        private void OnDestroy()
        {
            if (_instance == this)
            {
                Dispose();
                _instance = null;
            }
        }

        /// <summary>
        /// 释放资源
        /// </summary>
        private void Dispose()
        {
            try
            {
                if (_webSocketClient != null)
                {
                    _webSocketClient.OnConnected -= HandleWebSocketConnected;
                    _webSocketClient.OnDisconnected -= HandleWebSocketDisconnected;
                    _webSocketClient.OnMessageReceived -= HandleWebSocketMessageReceived;
                    _webSocketClient.OnError -= HandleWebSocketError;
                    _webSocketClient.OnReconnectAttempt -= HandleWebSocketReconnectAttempt;
                    _webSocketClient.OnReconnected -= HandleWebSocketReconnected;
                    _webSocketClient.OnReconnectFailed -= HandleWebSocketReconnectFailed;

                    _webSocketClient.Dispose();
                    _webSocketClient = null;
                }

                _messageRouter?.ClearAllHandlers();
                _messageRouter = null;

                lock (_queueLock)
                {
                    _messageQueue?.Clear();
                    _messageQueue = null;
                }

                Debug.Log("[NetworkManager] 资源已释放");
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[NetworkManager] 释放资源时出错: {ex.Message}");
            }
        }
    }
}
