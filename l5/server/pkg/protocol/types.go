package protocol

// MessageType 消息类型枚举，用于区分不同类别的消息
type MessageType int

const (
	// MessageTypeRoom 房间相关消息
	MessageTypeRoom MessageType = iota + 1
	// MessageTypeGame 游戏相关消息
	MessageTypeGame
	// MessageTypeSystem 系统相关消息
	MessageTypeSystem
)

// ActionType 动作类型枚举，定义玩家可以执行的操作
type ActionType int

const (
	// ActionMove 移动单位
	ActionMove ActionType = iota + 1
	// ActionAttack 攻击目标
	ActionAttack
	// ActionBuild 建造建筑
	ActionBuild
)

// UnitType 单位类型枚举
type UnitType int

const (
	// UnitWarrior 战士单位 - 近战高血量
	UnitWarrior UnitType = iota + 1
	// UnitArcher 弓箭手单位 - 远程高伤害
	UnitArcher
	// UnitMage 法师单位 - 范围攻击
	UnitMage
)

// BuildingType 建筑类型枚举
type BuildingType int

const (
	// BuildingBase 基地建筑 - 核心建筑，被摧毁则失败
	BuildingBase BuildingType = iota + 1
	// BuildingTurret 炮塔建筑 - 防御建筑，自动攻击
	BuildingTurret
	// BuildingBarracks 兵营建筑 - 生产单位
	BuildingBarracks
)

// GamePhase 游戏阶段枚举
type GamePhase int

const (
	// GamePhaseLobby 大厅阶段 - 等待玩家加入
	GamePhaseLobby GamePhase = iota + 1
	// GamePhasePlanning 规划阶段 - 玩家规划行动
	GamePhasePlanning
	// GamePhaseSimulating 模拟阶段 - 执行玩家行动
	GamePhaseSimulating
	// GamePhaseGameOver 游戏结束阶段
	GamePhaseGameOver
)

// Position 坐标位置
type Position struct {
	X int `msgpack:"x"`
	Y int `msgpack:"y"`
}

// Player 玩家信息
type Player struct {
	ID       string `msgpack:"id"`
	Name     string `msgpack:"name"`
	Team     int    `msgpack:"team"`
	Resources int   `msgpack:"resources"`
	Ready    bool   `msgpack:"ready"`
}

// Action 玩家动作
type Action struct {
	ID         string      `msgpack:"id"`
	PlayerID   string      `msgpack:"playerId"`
	Type       ActionType  `msgpack:"type"`
	UnitID     string      `msgpack:"unitId"`
	TargetPos  *Position   `msgpack:"targetPos"`
	TargetID   string      `msgpack:"targetId"`
	BuildingType BuildingType `msgpack:"buildingType"`
	ExecuteTime int64     `msgpack:"executeTime"`
}

// Timeline 时间线，包含一组按时间排序的动作
type Timeline struct {
	PlayerID string   `msgpack:"playerId"`
	Actions  []Action `msgpack:"actions"`
}

// Unit 游戏单位
type Unit struct {
	ID       string    `msgpack:"id"`
	Type     UnitType  `msgpack:"type"`
	PlayerID string    `msgpack:"playerId"`
	HP       int       `msgpack:"hp"`
	MaxHP    int       `msgpack:"maxHp"`
	Position Position  `msgpack:"position"`
	Attack   int       `msgpack:"attack"`
	Range    int       `msgpack:"range"`
	Speed    int       `msgpack:"speed"`
}

// Building 游戏建筑
type Building struct {
	ID       string       `msgpack:"id"`
	Type     BuildingType `msgpack:"type"`
	PlayerID string       `msgpack:"playerId"`
	HP       int          `msgpack:"hp"`
	MaxHP    int          `msgpack:"maxHp"`
	Position Position     `msgpack:"position"`
}

// GameState 游戏状态快照
type GameState struct {
	Phase     GamePhase `msgpack:"phase"`
	Turn      int       `msgpack:"turn"`
	Units     []Unit    `msgpack:"units"`
	Buildings []Building `msgpack:"buildings"`
	Players   []Player  `msgpack:"players"`
	Timestamp int64     `msgpack:"timestamp"`
}

// FullGameState 完整游戏状态，包含所有游戏信息
type FullGameState struct {
	RoomID      string    `msgpack:"roomId"`
	PlayerID    string    `msgpack:"playerId"`
	GameState   GameState `msgpack:"gameState"`
	Timelines   []Timeline `msgpack:"timelines"`
}
