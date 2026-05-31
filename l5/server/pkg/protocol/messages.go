package protocol

// Message WebSocket通用消息封装
type Message struct {
	Type int    `msgpack:"type"`
	Data []byte `msgpack:"data"`
}

// CreateRoomRequest 创建房间请求
type CreateRoomRequest struct {
	PlayerID   string `msgpack:"playerId"`
	PlayerName string `msgpack:"playerName"`
	RoomName   string `msgpack:"roomName"`
	MaxPlayers int    `msgpack:"maxPlayers"`
	Password   string `msgpack:"password"`
}

// JoinRoomRequest 加入房间请求
type JoinRoomRequest struct {
	PlayerID   string `msgpack:"playerId"`
	PlayerName string `msgpack:"playerName"`
	RoomID     string `msgpack:"roomId"`
	Password   string `msgpack:"password"`
}

// LeaveRoomRequest 离开房间请求
type LeaveRoomRequest struct {
	PlayerID string `msgpack:"playerId"`
	RoomID   string `msgpack:"roomId"`
}

// RoomInfoResponse 房间信息响应
type RoomInfoResponse struct {
	RoomID     string   `msgpack:"roomId"`
	RoomName   string   `msgpack:"roomName"`
	HostID     string   `msgpack:"hostId"`
	Players    []Player `msgpack:"players"`
	MaxPlayers int      `msgpack:"maxPlayers"`
	HasPassword bool    `msgpack:"hasPassword"`
	Phase      GamePhase `msgpack:"phase"`
}

// PlayerListMessage 玩家列表更新消息
type PlayerListMessage struct {
	RoomID  string   `msgpack:"roomId"`
	Players []Player `msgpack:"players"`
}

// TimelineSubmitRequest 提交时间线请求
type TimelineSubmitRequest struct {
	PlayerID string   `msgpack:"playerId"`
	RoomID   string   `msgpack:"roomId"`
	Timeline Timeline `msgpack:"timeline"`
}

// TimelineSubmitResponse 时间线提交响应
type TimelineSubmitResponse struct {
	RoomID   string `msgpack:"roomId"`
	Success  bool   `msgpack:"success"`
	PlayerID string `msgpack:"playerId"`
	Message  string `msgpack:"message"`
}

// StateSnapshotMessage 游戏状态快照消息
type StateSnapshotMessage struct {
	GameState GameState `msgpack:"gameState"`
	RoomID    string    `msgpack:"roomId"`
}

// FullStateMessage 完整游戏状态消息
type FullStateMessage struct {
	FullGameState FullGameState `msgpack:"fullGameState"`
}

// ErrorMessage 错误消息
type ErrorMessage struct {
	Code    int    `msgpack:"code"`
	Message string `msgpack:"message"`
}

// ReadyRequest 准备请求
type ReadyRequest struct {
	PlayerID string `msgpack:"playerId"`
	RoomID   string `msgpack:"roomId"`
	Ready    bool   `msgpack:"ready"`
}

// StartGameRequest 开始游戏请求
type StartGameRequest struct {
	PlayerID string `msgpack:"playerId"`
	RoomID   string `msgpack:"roomId"`
}

// GameStartMessage 游戏开始通知
type GameStartMessage struct {
	RoomID    string    `msgpack:"roomId"`
	GameState GameState `msgpack:"gameState"`
	Timestamp int64     `msgpack:"timestamp"`
}

// PhaseChangeMessage 阶段变化通知
type PhaseChangeMessage struct {
	RoomID      string    `msgpack:"roomId"`
	Phase       string    `msgpack:"phase"`
	Turn        int       `msgpack:"turn"`
	DurationSec int32     `msgpack:"durationSec"`
	PhaseEndTime int64    `msgpack:"phaseEndTime"`
	Timestamp   int64     `msgpack:"timestamp"`
}

// ActionExecutionMessage 动作执行通知
type ActionExecutionMessage struct {
	Action  Action `msgpack:"action"`
	Success bool   `msgpack:"success"`
	Result  string `msgpack:"result"`
}

// GameOverMessage 游戏结束消息
type GameOverMessage struct {
	RoomID        string   `msgpack:"roomId"`
	WinnerTeam    int      `msgpack:"winnerTeam"`
	WinnerPlayers []Player `msgpack:"winnerPlayers"`
	Stats         string   `msgpack:"stats"`
	Timestamp     int64    `msgpack:"timestamp"`
}

// HeartbeatRequest 心跳请求
type HeartbeatRequest struct {
	PlayerID string `msgpack:"playerId"`
	Timestamp int64 `msgpack:"timestamp"`
}

// HeartbeatResponse 心跳响应
type HeartbeatResponse struct {
	Timestamp int64 `msgpack:"timestamp"`
}

// ReconnectRequest 重连请求
type ReconnectRequest struct {
	PlayerID       string `msgpack:"playerId"`
	RoomID         string `msgpack:"roomId"`
	ReconnectToken string `msgpack:"reconnectToken"`
}

// ReconnectResponse 重连响应
type ReconnectResponse struct {
	Success bool   `msgpack:"success"`
	RoomID  string `msgpack:"roomId"`
	Message string `msgpack:"message"`
}

// SpectateJoinRequest 观战加入请求
type SpectateJoinRequest struct {
	PlayerID   string `msgpack:"playerId"`
	PlayerName string `msgpack:"playerName"`
	RoomID     string `msgpack:"roomId"`
}

// SpectateLeaveRequest 观战离开请求
type SpectateLeaveRequest struct {
	PlayerID string `msgpack:"playerId"`
	RoomID   string `msgpack:"roomId"`
}

// SpectateJoinResponse 观战加入响应
type SpectateJoinResponse struct {
	Success  bool        `msgpack:"success"`
	RoomID   string      `msgpack:"roomId"`
	GameState GameState  `msgpack:"gameState"`
	Message  string      `msgpack:"message"`
}

// ReplayListRequest 回放列表请求
type ReplayListRequest struct {
	RoomID string `msgpack:"roomId"`
	Limit  int    `msgpack:"limit"`
}

// ReplayListResponse 回放列表响应
type ReplayListResponse struct {
	Replays []ReplaySummary `msgpack:"replays"`
}

// ReplaySummary 回放摘要
type ReplaySummary struct {
	RoomID     string `msgpack:"roomId"`
	StartTime  int64  `msgpack:"startTime"`
	EndTime    int64  `msgpack:"endTime"`
	Rounds     int    `msgpack:"rounds"`
	WinnerTeam int    `msgpack:"winnerTeam"`
	FilePath   string `msgpack:"filePath"`
}

// ReplayDataRequest 回放数据请求
type ReplayDataRequest struct {
	FilePath string `msgpack:"filePath"`
}

// ValidationResultMessage 校验结果消息
type ValidationResultMessage struct {
	PlayerID string              `msgpack:"playerId"`
	Valid    bool                `msgpack:"valid"`
	Errors   []ValidationErrData `msgpack:"errors"`
}

// ValidationErrData 校验错误数据
type ValidationErrData struct {
	ActionID string `msgpack:"actionId"`
	Code     int    `msgpack:"code"`
	Message  string `msgpack:"message"`
}
