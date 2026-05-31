using System;
using MessagePack;

namespace Protocol
{
    /// <summary>
    /// WebSocket通用消息封装
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public class Message
    {
        /// <summary>
        /// 消息类型
        /// </summary>
        [Key("type")]
        public int Type { get; set; }

        /// <summary>
        /// 消息数据（序列化后的字节数组）
        /// </summary>
        [Key("data")]
        public byte[] Data { get; set; }
    }

    /// <summary>
    /// 创建房间请求
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public class CreateRoomRequest
    {
        /// <summary>
        /// 玩家ID
        /// </summary>
        [Key("playerId")]
        public string PlayerID { get; set; }

        /// <summary>
        /// 玩家名称
        /// </summary>
        [Key("playerName")]
        public string PlayerName { get; set; }

        /// <summary>
        /// 房间名称
        /// </summary>
        [Key("roomName")]
        public string RoomName { get; set; }

        /// <summary>
        /// 最大玩家数
        /// </summary>
        [Key("maxPlayers")]
        public int MaxPlayers { get; set; }

        /// <summary>
        /// 房间密码
        /// </summary>
        [Key("password")]
        public string Password { get; set; }
    }

    /// <summary>
    /// 加入房间请求
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public class JoinRoomRequest
    {
        /// <summary>
        /// 玩家ID
        /// </summary>
        [Key("playerId")]
        public string PlayerID { get; set; }

        /// <summary>
        /// 玩家名称
        /// </summary>
        [Key("playerName")]
        public string PlayerName { get; set; }

        /// <summary>
        /// 房间ID
        /// </summary>
        [Key("roomId")]
        public string RoomID { get; set; }

        /// <summary>
        /// 房间密码
        /// </summary>
        [Key("password")]
        public string Password { get; set; }
    }

    /// <summary>
    /// 离开房间请求
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public class LeaveRoomRequest
    {
        /// <summary>
        /// 玩家ID
        /// </summary>
        [Key("playerId")]
        public string PlayerID { get; set; }

        /// <summary>
        /// 房间ID
        /// </summary>
        [Key("roomId")]
        public string RoomID { get; set; }
    }

    /// <summary>
    /// 房间信息响应
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public class RoomInfoResponse
    {
        /// <summary>
        /// 房间ID
        /// </summary>
        [Key("roomId")]
        public string RoomID { get; set; }

        /// <summary>
        /// 房间名称
        /// </summary>
        [Key("roomName")]
        public string RoomName { get; set; }

        /// <summary>
        /// 房主ID
        /// </summary>
        [Key("hostId")]
        public string HostID { get; set; }

        /// <summary>
        /// 玩家列表
        /// </summary>
        [Key("players")]
        public Player[] Players { get; set; }

        /// <summary>
        /// 最大玩家数
        /// </summary>
        [Key("maxPlayers")]
        public int MaxPlayers { get; set; }

        /// <summary>
        /// 是否有密码
        /// </summary>
        [Key("hasPassword")]
        public bool HasPassword { get; set; }

        /// <summary>
        /// 游戏阶段
        /// </summary>
        [Key("phase")]
        public GamePhase Phase { get; set; }
    }

    /// <summary>
    /// 玩家列表更新消息
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public class PlayerListMessage
    {
        /// <summary>
        /// 房间ID
        /// </summary>
        [Key("roomId")]
        public string RoomID { get; set; }

        /// <summary>
        /// 玩家列表
        /// </summary>
        [Key("players")]
        public Player[] Players { get; set; }
    }

    /// <summary>
    /// 提交时间线请求
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public class TimelineSubmitRequest
    {
        /// <summary>
        /// 玩家ID
        /// </summary>
        [Key("playerId")]
        public string PlayerID { get; set; }

        /// <summary>
        /// 房间ID
        /// </summary>
        [Key("roomId")]
        public string RoomID { get; set; }

        /// <summary>
        /// 时间线数据
        /// </summary>
        [Key("timeline")]
        public Timeline Timeline { get; set; }
    }

    /// <summary>
    /// 时间线提交响应
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public class TimelineSubmitResponse
    {
        /// <summary>
        /// 是否提交成功
        /// </summary>
        [Key("success")]
        public bool Success { get; set; }

        /// <summary>
        /// 玩家ID
        /// </summary>
        [Key("playerId")]
        public string PlayerID { get; set; }

        /// <summary>
        /// 响应消息
        /// </summary>
        [Key("message")]
        public string Message { get; set; }
    }

    /// <summary>
    /// 游戏状态快照消息
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public class StateSnapshotMessage
    {
        /// <summary>
        /// 游戏状态
        /// </summary>
        [Key("gameState")]
        public GameState GameState { get; set; }

        /// <summary>
        /// 房间ID
        /// </summary>
        [Key("roomId")]
        public string RoomID { get; set; }
    }

    /// <summary>
    /// 完整游戏状态消息
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public class FullStateMessage
    {
        /// <summary>
        /// 完整游戏状态
        /// </summary>
        [Key("fullGameState")]
        public FullGameState FullGameState { get; set; }
    }

    /// <summary>
    /// 错误消息
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public class ErrorMessage
    {
        /// <summary>
        /// 错误码
        /// </summary>
        [Key("code")]
        public int Code { get; set; }

        /// <summary>
        /// 错误消息
        /// </summary>
        [Key("message")]
        public string Message { get; set; }
    }

    /// <summary>
    /// 准备请求
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public class ReadyRequest
    {
        /// <summary>
        /// 玩家ID
        /// </summary>
        [Key("playerId")]
        public string PlayerID { get; set; }

        /// <summary>
        /// 房间ID
        /// </summary>
        [Key("roomId")]
        public string RoomID { get; set; }

        /// <summary>
        /// 是否准备
        /// </summary>
        [Key("ready")]
        public bool Ready { get; set; }
    }

    /// <summary>
    /// 开始游戏请求
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public class StartGameRequest
    {
        /// <summary>
        /// 玩家ID
        /// </summary>
        [Key("playerId")]
        public string PlayerID { get; set; }

        /// <summary>
        /// 房间ID
        /// </summary>
        [Key("roomId")]
        public string RoomID { get; set; }
    }

    /// <summary>
    /// 游戏开始通知
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public class GameStartMessage
    {
        /// <summary>
        /// 房间ID
        /// </summary>
        [Key("roomId")]
        public string RoomID { get; set; }

        /// <summary>
        /// 游戏状态
        /// </summary>
        [Key("gameState")]
        public GameState GameState { get; set; }
    }

    /// <summary>
    /// 阶段变化通知
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public class PhaseChangeMessage
    {
        /// <summary>
        /// 房间ID
        /// </summary>
        [Key("roomId")]
        public string RoomID { get; set; }

        /// <summary>
        /// 当前阶段
        /// </summary>
        [Key("phase")]
        public GamePhase Phase { get; set; }

        /// <summary>
        /// 阶段结束时间戳（毫秒）
        /// </summary>
        [Key("phaseEndTime")]
        public long PhaseEndTime { get; set; }
    }

    /// <summary>
    /// 动作执行通知
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public class ActionExecutionMessage
    {
        /// <summary>
        /// 执行的动作
        /// </summary>
        [Key("action")]
        public Action Action { get; set; }

        /// <summary>
        /// 是否执行成功
        /// </summary>
        [Key("success")]
        public bool Success { get; set; }

        /// <summary>
        /// 执行结果
        /// </summary>
        [Key("result")]
        public string Result { get; set; }
    }

    /// <summary>
    /// 游戏结束消息
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public class GameOverMessage
    {
        /// <summary>
        /// 房间ID
        /// </summary>
        [Key("roomId")]
        public string RoomID { get; set; }

        /// <summary>
        /// 获胜队伍
        /// </summary>
        [Key("winnerTeam")]
        public int WinnerTeam { get; set; }

        /// <summary>
        /// 获胜玩家列表
        /// </summary>
        [Key("winnerPlayers")]
        public Player[] WinnerPlayers { get; set; }

        /// <summary>
        /// 游戏统计数据
        /// </summary>
        [Key("stats")]
        public string Stats { get; set; }
    }

    /// <summary>
    /// 心跳请求
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public class HeartbeatRequest
    {
        /// <summary>
        /// 玩家ID
        /// </summary>
        [Key("playerId")]
        public string PlayerID { get; set; }

        /// <summary>
        /// 客户端时间戳（毫秒）
        /// </summary>
        [Key("timestamp")]
        public long Timestamp { get; set; }
    }

    /// <summary>
    /// 心跳响应
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public class HeartbeatResponse
    {
        /// <summary>
        /// 客户端时间戳（毫秒）
        /// </summary>
        [Key("timestamp")]
        public long Timestamp { get; set; }

        /// <summary>
        /// 服务器时间戳（毫秒）
        /// </summary>
        [Key("serverTime")]
        public long ServerTime { get; set; }
    }

    /// <summary>
    /// 重连请求
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public class ReconnectRequest
    {
        /// <summary>
        /// 玩家ID
        /// </summary>
        [Key("playerId")]
        public string PlayerID { get; set; }

        /// <summary>
        /// 房间ID
        /// </summary>
        [Key("roomId")]
        public string RoomID { get; set; }

        /// <summary>
        /// 重连令牌
        /// </summary>
        [Key("reconnectToken")]
        public string ReconnectToken { get; set; }
    }

    /// <summary>
    /// 重连响应
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public class ReconnectResponse
    {
        /// <summary>
        /// 是否重连成功
        /// </summary>
        [Key("success")]
        public bool Success { get; set; }

        /// <summary>
        /// 房间ID
        /// </summary>
        [Key("roomId")]
        public string RoomID { get; set; }

        /// <summary>
        /// 响应消息
        /// </summary>
        [Key("message")]
        public string Message { get; set; }
    }

    /// <summary>
    /// 观战加入请求
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public class SpectateJoinRequest
    {
        [Key("playerId")]
        public string PlayerID { get; set; }

        [Key("playerName")]
        public string PlayerName { get; set; }

        [Key("roomId")]
        public string RoomID { get; set; }
    }

    /// <summary>
    /// 观战离开请求
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public class SpectateLeaveRequest
    {
        [Key("playerId")]
        public string PlayerID { get; set; }

        [Key("roomId")]
        public string RoomID { get; set; }
    }

    /// <summary>
    /// 观战加入响应
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public class SpectateJoinResponse
    {
        [Key("success")]
        public bool Success { get; set; }

        [Key("roomId")]
        public string RoomID { get; set; }

        [Key("gameState")]
        public GameState GameState { get; set; }

        [Key("message")]
        public string Message { get; set; }
    }

    /// <summary>
    /// 回放列表请求
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public class ReplayListRequest
    {
        [Key("roomId")]
        public string RoomID { get; set; }

        [Key("limit")]
        public int Limit { get; set; }
    }

    /// <summary>
    /// 回放列表响应
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public class ReplayListResponse
    {
        [Key("replays")]
        public ReplaySummary[] Replays { get; set; }
    }

    /// <summary>
    /// 回放摘要
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public class ReplaySummary
    {
        [Key("roomId")]
        public string RoomID { get; set; }

        [Key("startTime")]
        public long StartTime { get; set; }

        [Key("endTime")]
        public long EndTime { get; set; }

        [Key("rounds")]
        public int Rounds { get; set; }

        [Key("winnerTeam")]
        public int WinnerTeam { get; set; }

        [Key("filePath")]
        public string FilePath { get; set; }
    }

    /// <summary>
    /// 回放数据请求
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public class ReplayDataRequest
    {
        [Key("filePath")]
        public string FilePath { get; set; }
    }

    /// <summary>
    /// 校验结果消息
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public class ValidationResultMessage
    {
        [Key("playerId")]
        public string PlayerID { get; set; }

        [Key("valid")]
        public bool Valid { get; set; }

        [Key("errors")]
        public ValidationErrData[] Errors { get; set; }
    }

    /// <summary>
    /// 校验错误数据
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public class ValidationErrData
    {
        [Key("actionId")]
        public string ActionID { get; set; }

        [Key("code")]
        public int Code { get; set; }

        [Key("message")]
        public string Message { get; set; }
    }
}
