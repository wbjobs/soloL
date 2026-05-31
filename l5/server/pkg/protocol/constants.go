package protocol

// 地图配置常量
const (
	// MapWidth 地图宽度（格子数）
	MapWidth = 20
	// MapHeight 地图高度（格子数）
	MapHeight = 20
)

// 游戏经济常量
const (
	// InitialResources 玩家初始资源
	InitialResources = 500
	// ResourcePerTurn 每回合资源收入
	ResourcePerTurn = 100
	// ResourcePerBarracks 每个兵营每回合额外资源
	ResourcePerBarracks = 50
)

// 时间配置常量（秒）
const (
	// PlanningPhaseDuration 规划阶段持续时间（秒）
	PlanningPhaseDuration = 30
	// SimulatingPhaseDuration 模拟阶段持续时间（秒）
	SimulatingPhaseDuration = 15
	// TurnInterval 回合间隔时间（毫秒）
	TurnInterval = 1000
)

// 单位属性常量
const (
	// WarriorHP 战士生命值
	WarriorHP = 150
	// WarriorAttack 战士攻击力
	WarriorAttack = 25
	// WarriorRange 战士攻击范围
	WarriorRange = 1
	// WarriorSpeed 战士移动速度（格/秒）
	WarriorSpeed = 2
	// WarriorCost 战士训练成本
	WarriorCost = 100

	// ArcherHP 弓箭手生命值
	ArcherHP = 80
	// ArcherAttack 弓箭手攻击力
	ArcherAttack = 30
	// ArcherRange 弓箭手攻击范围
	ArcherRange = 4
	// ArcherSpeed 弓箭手移动速度
	ArcherSpeed = 2
	// ArcherCost 弓箭手训练成本
	ArcherCost = 120

	// MageHP 法师生命值
	MageHP = 60
	// MageAttack 法师攻击力
	MageAttack = 40
	// MageRange 法师攻击范围
	MageRange = 3
	// MageSpeed 法师移动速度
	MageSpeed = 1
	// MageCost 法师训练成本
	MageCost = 150
	// MageAOERadius 法师AOE攻击半径
	MageAOERadius = 1
)

// 建筑属性常量
const (
	// BaseHP 基地生命值
	BaseHP = 1000
	// BaseCost 基地建造成本（不可建造，仅作参考）
	BaseCost = 0

	// TurretHP 炮塔生命值
	TurretHP = 200
	// TurretAttack 炮塔攻击力
	TurretAttack = 20
	// TurretRange 炮塔攻击范围
	TurretRange = 3
	// TurretCost 炮塔建造成本
	TurretCost = 200
	// TurretFireRate 炮塔攻击间隔（毫秒）
	TurretFireRate = 2000

	// BarracksHP 兵营生命值
	BarracksHP = 300
	// BarracksCost 兵营建造成本
	BarracksCost = 300
)

// 初始单位配置
const (
	// InitialWarriors 初始战士数量
	InitialWarriors = 3
	// InitialArchers 初始弓箭手数量
	InitialArchers = 2
	// InitialMages 初始法师数量
	InitialMages = 1
)

// 错误码常量
const (
	// ErrCodeSuccess 成功
	ErrCodeSuccess = 0
	// ErrCodeRoomNotFound 房间不存在
	ErrCodeRoomNotFound = 1001
	// ErrCodeRoomFull 房间已满
	ErrCodeRoomFull = 1002
	// ErrCodeWrongPassword 密码错误
	ErrCodeWrongPassword = 1003
	// ErrCodePlayerNotInRoom 玩家不在房间内
	ErrCodePlayerNotInRoom = 1004
	// ErrCodeNotHost 非房主操作
	ErrCodeNotHost = 1005
	// ErrCodeNotAllReady 玩家未全部准备
	ErrCodeNotAllReady = 1006
	// ErrCodeGameAlreadyStarted 游戏已开始
	ErrCodeGameAlreadyStarted = 1007
	// ErrCodeGameNotStarted 游戏未开始
	ErrCodeGameNotStarted = 1008
	// ErrCodePlayerTimeout 玩家超时
	ErrCodePlayerTimeout = 1009

	// ErrCodeInvalidAction 无效动作
	ErrCodeInvalidAction = 2001
	// ErrCodeInsufficientResources 资源不足
	ErrCodeInsufficientResources = 2002
	// ErrCodeInvalidPosition 无效位置
	ErrCodeInvalidPosition = 2003
	// ErrCodeUnitNotFound 单位不存在
	ErrCodeUnitNotFound = 2004
	// ErrCodeWrongPhase 错误的游戏阶段
	ErrCodeWrongPhase = 2005
	// ErrCodeInvalidTimeline 无效时间线
	ErrCodeInvalidTimeline = 2006

	// ErrCodeInternalError 内部错误
	ErrCodeInternalError = 5000

	// ErrCodeSpeedHack 加速外挂
	ErrCodeSpeedHack = 3001
	// ErrCodeTeleport 瞬移外挂
	ErrCodeTeleport = 3002
	// ErrCodeOutOfRange 超出范围
	ErrCodeOutOfRange = 3003
	// ErrCodeNotOwner 非单位所有者
	ErrCodeNotOwner = 3004
	// ErrCodeUnitDead 单位已死亡
	ErrCodeUnitDead = 3005
	// ErrCodeTooManyActions 动作数量超限
	ErrCodeTooManyActions = 3006
	// ErrCodeDuplicateAction 重复动作
	ErrCodeDuplicateAction = 3007
	// ErrCodeInvalidTime 非法执行时间
	ErrCodeInvalidTime = 3008
	// ErrCodeTargetNotFound 目标不存在
	ErrCodeTargetNotFound = 3009
	// ErrCodeTargetFriendly 攻击友方目标
	ErrCodeTargetFriendly = 3010
	// ErrCodeSpectatorLimit 观战人数已满
	ErrCodeSpectatorLimit = 3011
	// ErrCodeAlreadySpectator 已在观战列表
	ErrCodeAlreadySpectator = 3012
	// ErrCodeReplayNotFound 回放不存在
	ErrCodeReplayNotFound = 3013
)

// 消息类型常量（对应MessageType枚举）
const (
	// MsgTypeCreateRoom 创建房间
	MsgTypeCreateRoom = 101
	// MsgTypeJoinRoom 加入房间
	MsgTypeJoinRoom = 102
	// MsgTypeLeaveRoom 离开房间
	MsgTypeLeaveRoom = 103
	// MsgTypeRoomInfo 房间信息
	MsgTypeRoomInfo = 104
	// MsgTypePlayerList 玩家列表
	MsgTypePlayerList = 105
	// MsgTypeReady 准备/取消准备
	MsgTypeReady = 106
	// MsgTypeStartGame 开始游戏
	MsgTypeStartGame = 107
	// MsgTypeGameStart 游戏开始广播
	MsgTypeGameStart = 108

	// MsgTypeSubmitTimeline 提交时间线
	MsgTypeSubmitTimeline = 201
	// MsgTypeTimelineAck 时间线提交确认
	MsgTypeTimelineAck = 202
	// MsgTypeSubmitTimelineAck 时间线提交确认(别名)
	MsgTypeSubmitTimelineAck = 202
	// MsgTypeStateSnapshot 状态快照
	MsgTypeStateSnapshot = 203
	// MsgTypeFullState 完整状态
	MsgTypeFullState = 204
	// MsgTypePhaseChange 阶段变化
	MsgTypePhaseChange = 205
	// MsgTypeActionExecution 动作执行
	MsgTypeActionExecution = 206
	// MsgTypeGameOver 游戏结束
	MsgTypeGameOver = 207

	// MsgTypeHeartbeat 心跳
	MsgTypeHeartbeat = 301
	// MsgTypeReconnect 重连请求
	MsgTypeReconnect = 302
	// MsgTypeReconnectAck 重连响应
	MsgTypeReconnectAck = 303
	// MsgTypeSpectateJoin 观战加入
	MsgTypeSpectateJoin = 401
	// MsgTypeSpectateLeave 观战离开
	MsgTypeSpectateLeave = 402
	// MsgTypeSpectateState 观战状态推送
	MsgTypeSpectateState = 403
	// MsgTypeReplayList 回放列表
	MsgTypeReplayList = 501
	// MsgTypeReplayData 回放数据
	MsgTypeReplayData = 502
	// MsgTypeValidationResult 校验结果
	MsgTypeValidationResult = 601
	// MsgTypeError 错误消息
	MsgTypeError = 500
)
