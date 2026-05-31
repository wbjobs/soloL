using System;
using System.Collections.Generic;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;

namespace Network
{
    /// <summary>
    /// WebSocket消息封装，与服务器协议对应
    /// </summary>
    [MessagePackObject]
    public class NetworkMessage
    {
        [Key("type")]
        public int Type { get; set; }

        [Key("data")]
        public byte[] Data { get; set; }
    }

    /// <summary>
    /// 心跳请求
    /// </summary>
    [MessagePackObject]
    public class HeartbeatRequest
    {
        [Key("playerId")]
        public string PlayerID { get; set; }

        [Key("timestamp")]
        public long Timestamp { get; set; }
    }

    /// <summary>
    /// 心跳响应
    /// </summary>
    [MessagePackObject]
    public class HeartbeatResponse
    {
        [Key("timestamp")]
        public long Timestamp { get; set; }

        [Key("serverTime")]
        public long ServerTime { get; set; }
    }

    /// <summary>
    /// WebSocket客户端，负责与服务器建立连接、发送和接收消息
    /// </summary>
    public class WebSocketClient : IDisposable
    {
        private const int HeartbeatInterval = 3000;
        private const int ReconnectMaxAttempts = 3;
        private const int ReconnectInterval = 2000;
        private const int ReceiveBufferSize = 4096;

        private ClientWebSocket _webSocket;
        private CancellationTokenSource _cancellationTokenSource;
        private Task _receiveTask;
        private Task _heartbeatTask;
        private string _serverUrl;
        private string _playerId;
        private int _reconnectAttempts;
        private bool _isDisconnecting;
        private bool _disposed;

        /// <summary>
        /// 是否已连接到服务器
        /// </summary>
        public bool IsConnected => _webSocket != null && _webSocket.State == WebSocketState.Open;

        /// <summary>
        /// 当前WebSocket状态
        /// </summary>
        public WebSocketState State => _webSocket?.State ?? WebSocketState.None;

        /// <summary>
        /// 连接成功事件
        /// </summary>
        public event Action OnConnected;

        /// <summary>
        /// 断开连接事件
        /// </summary>
        public event Action OnDisconnected;

        /// <summary>
        /// 收到消息事件（参数：消息类型，消息数据）
        /// </summary>
        public event Action<int, byte[]> OnMessageReceived;

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
        /// 连接到服务器
        /// </summary>
        /// <param name="url">服务器地址，例如 ws://localhost:8080/ws</param>
        /// <param name="playerId">玩家ID</param>
        /// <returns>异步任务</returns>
        public async Task Connect(string url, string playerId)
        {
            if (IsConnected)
            {
                Debug.LogWarning("[WebSocketClient] 已经连接到服务器");
                return;
            }

            _serverUrl = url;
            _playerId = playerId;
            _reconnectAttempts = 0;
            _isDisconnecting = false;

            try
            {
                await ConnectInternal();
            }
            catch (Exception ex)
            {
                Debug.LogError($"[WebSocketClient] 连接失败: {ex.Message}");
                OnError?.Invoke(ex);
                throw;
            }
        }

        /// <summary>
        /// 内部连接方法
        /// </summary>
        private async Task ConnectInternal()
        {
            _webSocket = new ClientWebSocket();
            _cancellationTokenSource = new CancellationTokenSource();

            Debug.Log($"[WebSocketClient] 正在连接到 {_serverUrl}...");

            await _webSocket.ConnectAsync(new Uri(_serverUrl), _cancellationTokenSource.Token);

            Debug.Log("[WebSocketClient] 连接成功");

            _receiveTask = ReceiveMessageLoop(_cancellationTokenSource.Token);
            _heartbeatTask = HeartbeatLoop(_cancellationTokenSource.Token);

            OnConnected?.Invoke();
        }

        /// <summary>
        /// 断开与服务器的连接
        /// </summary>
        /// <returns>异步任务</returns>
        public async Task Disconnect()
        {
            if (_isDisconnecting)
            {
                return;
            }

            _isDisconnecting = true;

            try
            {
                _cancellationTokenSource?.Cancel();

                if (_heartbeatTask != null)
                {
                    try
                    {
                        await _heartbeatTask;
                    }
                    catch (OperationCanceledException)
                    {
                    }
                }

                if (_receiveTask != null)
                {
                    try
                    {
                        await _receiveTask;
                    }
                    catch (OperationCanceledException)
                    {
                    }
                }

                if (_webSocket != null && _webSocket.State == WebSocketState.Open)
                {
                    await _webSocket.CloseAsync(
                        WebSocketCloseStatus.NormalClosure,
                        "客户端主动断开",
                        CancellationToken.None);
                }

                Debug.Log("[WebSocketClient] 已断开连接");
                OnDisconnected?.Invoke();
            }
            catch (Exception ex)
            {
                Debug.LogError($"[WebSocketClient] 断开连接时出错: {ex.Message}");
                OnError?.Invoke(ex);
            }
            finally
            {
                Cleanup();
                _isDisconnecting = false;
            }
        }

        /// <summary>
        /// 发送消息
        /// </summary>
        /// <typeparam name="T">消息数据类型</typeparam>
        /// <param name="messageType">消息类型ID</param>
        /// <param name="data">消息数据对象</param>
        /// <returns>异步任务</returns>
        public async Task SendMessage<T>(int messageType, T data)
        {
            if (!IsConnected)
            {
                throw new InvalidOperationException("WebSocket未连接，无法发送消息");
            }

            try
            {
                byte[] serializedData = MessagePackExtensions.Serialize(data);
                await SendMessageInternal(messageType, serializedData);
            }
            catch (Exception ex)
            {
                Debug.LogError($"[WebSocketClient] 发送消息失败 (类型: {messageType}): {ex.Message}");
                OnError?.Invoke(ex);
                throw;
            }
        }

        /// <summary>
        /// 发送原始字节消息
        /// </summary>
        /// <param name="messageType">消息类型ID</param>
        /// <param name="data">消息数据字节数组</param>
        /// <returns>异步任务</returns>
        public async Task SendMessageRaw(int messageType, byte[] data)
        {
            if (!IsConnected)
            {
                throw new InvalidOperationException("WebSocket未连接，无法发送消息");
            }

            try
            {
                await SendMessageInternal(messageType, data);
            }
            catch (Exception ex)
            {
                Debug.LogError($"[WebSocketClient] 发送原始消息失败 (类型: {messageType}): {ex.Message}");
                OnError?.Invoke(ex);
                throw;
            }
        }

        /// <summary>
        /// 内部发送消息方法
        /// </summary>
        private async Task SendMessageInternal(int messageType, byte[] data)
        {
            var message = new NetworkMessage
            {
                Type = messageType,
                Data = data
            };

            byte[] messageBytes = MessagePackExtensions.Serialize(message);

            await _webSocket.SendAsync(
                new ArraySegment<byte>(messageBytes),
                WebSocketMessageType.Binary,
                true,
                _cancellationTokenSource.Token);
        }

        /// <summary>
        /// 接收消息循环
        /// </summary>
        private async Task ReceiveMessageLoop(CancellationToken cancellationToken)
        {
            var buffer = new byte[ReceiveBufferSize];
            var messageBuffer = new List<byte>();

            try
            {
                while (!cancellationToken.IsCancellationRequested && IsConnected)
                {
                    messageBuffer.Clear();
                    WebSocketReceiveResult result;

                    do
                    {
                        result = await _webSocket.ReceiveAsync(
                            new ArraySegment<byte>(buffer),
                            cancellationToken);

                        if (result.MessageType == WebSocketMessageType.Close)
                        {
                            Debug.Log("[WebSocketClient] 收到服务器关闭请求");
                            await HandleConnectionLost();
                            return;
                        }

                        messageBuffer.AddRange(new ArraySegment<byte>(buffer, 0, result.Count));
                    }
                    while (!result.EndOfMessage);

                    if (messageBuffer.Count > 0)
                    {
                        ProcessReceivedMessage(messageBuffer.ToArray());
                    }
                }
            }
            catch (OperationCanceledException)
            {
                Debug.Log("[WebSocketClient] 接收任务已取消");
            }
            catch (WebSocketException ex)
            {
                Debug.LogError($"[WebSocketClient] WebSocket异常: {ex.Message}");
                OnError?.Invoke(ex);
                await HandleConnectionLost();
            }
            catch (Exception ex)
            {
                Debug.LogError($"[WebSocketClient] 接收消息时出错: {ex.Message}");
                OnError?.Invoke(ex);
                await HandleConnectionLost();
            }
        }

        /// <summary>
        /// 处理接收到的消息
        /// </summary>
        private void ProcessReceivedMessage(byte[] data)
        {
            try
            {
                var message = MessagePackExtensions.Deserialize<NetworkMessage>(data);
                Debug.Log($"[WebSocketClient] 收到消息，类型: {message.Type}, 数据长度: {message.Data?.Length ?? 0}");
                OnMessageReceived?.Invoke(message.Type, message.Data);
            }
            catch (Exception ex)
            {
                Debug.LogError($"[WebSocketClient] 解析消息失败: {ex.Message}");
                OnError?.Invoke(ex);
            }
        }

        /// <summary>
        /// 心跳循环
        /// </summary>
        private async Task HeartbeatLoop(CancellationToken cancellationToken)
        {
            try
            {
                while (!cancellationToken.IsCancellationRequested && IsConnected)
                {
                    await Task.Delay(HeartbeatInterval, cancellationToken);

                    if (!cancellationToken.IsCancellationRequested && IsConnected)
                    {
                        var heartbeat = new HeartbeatRequest
                        {
                            PlayerID = _playerId,
                            Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
                        };

                        try
                        {
                            await SendMessage(301, heartbeat);
                            Debug.Log("[WebSocketClient] 已发送心跳包");
                        }
                        catch (Exception ex)
                        {
                            Debug.LogWarning($"[WebSocketClient] 发送心跳失败: {ex.Message}");
                        }
                    }
                }
            }
            catch (OperationCanceledException)
            {
                Debug.Log("[WebSocketClient] 心跳任务已取消");
            }
        }

        /// <summary>
        /// 处理连接丢失，尝试自动重连
        /// </summary>
        private async Task HandleConnectionLost()
        {
            if (_isDisconnecting)
            {
                return;
            }

            Debug.Log("[WebSocketClient] 连接丢失，准备尝试重连...");
            OnDisconnected?.Invoke();

            Cleanup();

            while (_reconnectAttempts < ReconnectMaxAttempts && !_isDisconnecting)
            {
                _reconnectAttempts++;
                Debug.Log($"[WebSocketClient] 正在尝试第 {_reconnectAttempts}/{ReconnectMaxAttempts} 次重连...");
                OnReconnectAttempt?.Invoke(_reconnectAttempts, ReconnectMaxAttempts);

                try
                {
                    await Task.Delay(ReconnectInterval);
                    await ConnectInternal();
                    Debug.Log("[WebSocketClient] 重连成功");
                    OnReconnected?.Invoke();
                    return;
                }
                catch (Exception ex)
                {
                    Debug.LogError($"[WebSocketClient] 第 {_reconnectAttempts} 次重连失败: {ex.Message}");
                    OnError?.Invoke(ex);
                }
            }

            if (_reconnectAttempts >= ReconnectMaxAttempts)
            {
                Debug.LogError("[WebSocketClient] 已达到最大重连次数，重连失败");
                OnReconnectFailed?.Invoke();
            }
        }

        /// <summary>
        /// 清理资源
        /// </summary>
        private void Cleanup()
        {
            try
            {
                _cancellationTokenSource?.Cancel();
                _cancellationTokenSource?.Dispose();
                _cancellationTokenSource = null;

                _webSocket?.Dispose();
                _webSocket = null;

                _receiveTask = null;
                _heartbeatTask = null;
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[WebSocketClient] 清理资源时出错: {ex.Message}");
            }
        }

        /// <summary>
        /// 释放资源
        /// </summary>
        public void Dispose()
        {
            Dispose(true);
            GC.SuppressFinalize(this);
        }

        /// <summary>
        /// 释放资源
        /// </summary>
        protected virtual void Dispose(bool disposing)
        {
            if (_disposed)
            {
                return;
            }

            if (disposing)
            {
                if (!_isDisconnecting && IsConnected)
                {
                    _ = Disconnect();
                }

                Cleanup();
            }

            _disposed = true;
        }

        /// <summary>
        /// 析构函数
        /// </summary>
        ~WebSocketClient()
        {
            Dispose(false);
        }
    }
}
