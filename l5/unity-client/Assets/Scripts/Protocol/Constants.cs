namespace Protocol
{
    /// <summary>
    /// 游戏常量定义
    /// </summary>
    public static class Constants
    {
        #region 地图配置常量

        /// <summary>
        /// 地图宽度（格子数）
        /// </summary>
        public const int MapWidth = 20;

        /// <summary>
        /// 地图高度（格子数）
        /// </summary>
        public const int MapHeight = 20;

        #endregion

        #region 游戏经济常量

        /// <summary>
        /// 玩家初始资源
        /// </summary>
        public const int InitialResources = 500;

        /// <summary>
        /// 每回合资源收入
        /// </summary>
        public const int ResourcePerTurn = 100;

        /// <summary>
        /// 每个兵营每回合额外资源
        /// </summary>
        public const int ResourcePerBarracks = 50;

        #endregion

        #region 时间配置常量

        /// <summary>
        /// 规划阶段持续时间（秒）
        /// </summary>
        public const int PlanningPhaseDuration = 30;

        /// <summary>
        /// 模拟阶段持续时间（秒）
        /// </summary>
        public const int SimulatingPhaseDuration = 15;

        /// <summary>
        /// 回合间隔时间（毫秒）
        /// </summary>
        public const int TurnInterval = 1000;

        #endregion

        #region 单位属性常量

        /// <summary>
        /// 战士生命值
        /// </summary>
        public const int WarriorHP = 150;

        /// <summary>
        /// 战士攻击力
        /// </summary>
        public const int WarriorAttack = 25;

        /// <summary>
        /// 战士攻击范围
        /// </summary>
        public const int WarriorRange = 1;

        /// <summary>
        /// 战士移动速度（格/秒）
        /// </summary>
        public const int WarriorSpeed = 2;

        /// <summary>
        /// 战士训练成本
        /// </summary>
        public const int WarriorCost = 100;

        /// <summary>
        /// 弓箭手生命值
        /// </summary>
        public const int ArcherHP = 80;

        /// <summary>
        /// 弓箭手攻击力
        /// </summary>
        public const int ArcherAttack = 30;

        /// <summary>
        /// 弓箭手攻击范围
        /// </summary>
        public const int ArcherRange = 4;

        /// <summary>
        /// 弓箭手移动速度
        /// </summary>
        public const int ArcherSpeed = 2;

        /// <summary>
        /// 弓箭手训练成本
        /// </summary>
        public const int ArcherCost = 120;

        /// <summary>
        /// 法师生命值
        /// </summary>
        public const int MageHP = 60;

        /// <summary>
        /// 法师攻击力
        /// </summary>
        public const int MageAttack = 40;

        /// <summary>
        /// 法师攻击范围
        /// </summary>
        public const int MageRange = 3;

        /// <summary>
        /// 法师移动速度
        /// </summary>
        public const int MageSpeed = 1;

        /// <summary>
        /// 法师训练成本
        /// </summary>
        public const int MageCost = 150;

        /// <summary>
        /// 法师AOE攻击半径
        /// </summary>
        public const int MageAOERadius = 1;

        #endregion

        #region 建筑属性常量

        /// <summary>
        /// 基地生命值
        /// </summary>
        public const int BaseHP = 1000;

        /// <summary>
        /// 基地建造成本（不可建造，仅作参考）
        /// </summary>
        public const int BaseCost = 0;

        /// <summary>
        /// 炮塔生命值
        /// </summary>
        public const int TurretHP = 200;

        /// <summary>
        /// 炮塔攻击力
        /// </summary>
        public const int TurretAttack = 20;

        /// <summary>
        /// 炮塔攻击范围
        /// </summary>
        public const int TurretRange = 3;

        /// <summary>
        /// 炮塔建造成本
        /// </summary>
        public const int TurretCost = 200;

        /// <summary>
        /// 炮塔攻击间隔（毫秒）
        /// </summary>
        public const int TurretFireRate = 2000;

        /// <summary>
        /// 兵营生命值
        /// </summary>
        public const int BarracksHP = 300;

        /// <summary>
        /// 兵营建造成本
        /// </summary>
        public const int BarracksCost = 300;

        #endregion

        #region 初始单位配置

        /// <summary>
        /// 初始战士数量
        /// </summary>
        public const int InitialWarriors = 3;

        /// <summary>
        /// 初始弓箭手数量
        /// </summary>
        public const int InitialArchers = 2;

        /// <summary>
        /// 初始法师数量
        /// </summary>
        public const int InitialMages = 1;

        #endregion

        #region 错误码常量

        /// <summary>
        /// 成功
        /// </summary>
        public const int ErrCodeSuccess = 0;

        /// <summary>
        /// 房间不存在
        /// </summary>
        public const int ErrCodeRoomNotFound = 1001;

        /// <summary>
        /// 房间已满
        /// </summary>
        public const int ErrCodeRoomFull = 1002;

        /// <summary>
        /// 密码错误
        /// </summary>
        public const int ErrCodeWrongPassword = 1003;

        /// <summary>
        /// 玩家不在房间内
        /// </summary>
        public const int ErrCodePlayerNotInRoom = 1004;

        /// <summary>
        /// 非房主操作
        /// </summary>
        public const int ErrCodeNotHost = 1005;

        /// <summary>
        /// 游戏已开始
        /// </summary>
        public const int ErrCodeGameAlreadyStarted = 1006;

        /// <summary>
        /// 游戏未开始
        /// </summary>
        public const int ErrCodeGameNotStarted = 1007;

        /// <summary>
        /// 无效动作
        /// </summary>
        public const int ErrCodeInvalidAction = 2001;

        /// <summary>
        /// 资源不足
        /// </summary>
        public const int ErrCodeInsufficientResources = 2002;

        /// <summary>
        /// 无效位置
        /// </summary>
        public const int ErrCodeInvalidPosition = 2003;

        /// <summary>
        /// 单位不存在
        /// </summary>
        public const int ErrCodeUnitNotFound = 2004;

        /// <summary>
        /// 错误的游戏阶段
        /// </summary>
        public const int ErrCodeWrongPhase = 2005;

        /// <summary>
        /// 内部错误
        /// </summary>
        public const int ErrCodeInternalError = 5000;

        /// <summary>
        /// 加速外挂
        /// </summary>
        public const int ErrCodeSpeedHack = 3001;

        /// <summary>
        /// 瞬移外挂
        /// </summary>
        public const int ErrCodeTeleport = 3002;

        /// <summary>
        /// 超出范围
        /// </summary>
        public const int ErrCodeOutOfRange = 3003;

        /// <summary>
        /// 非单位所有者
        /// </summary>
        public const int ErrCodeNotOwner = 3004;

        /// <summary>
        /// 单位已死亡
        /// </summary>
        public const int ErrCodeUnitDead = 3005;

        /// <summary>
        /// 动作数量超限
        /// </summary>
        public const int ErrCodeTooManyActions = 3006;

        /// <summary>
        /// 重复动作
        /// </summary>
        public const int ErrCodeDuplicateAction = 3007;

        /// <summary>
        /// 非法执行时间
        /// </summary>
        public const int ErrCodeInvalidTime = 3008;

        /// <summary>
        /// 目标不存在
        /// </summary>
        public const int ErrCodeTargetNotFound = 3009;

        /// <summary>
        /// 攻击友方目标
        /// </summary>
        public const int ErrCodeTargetFriendly = 3010;

        /// <summary>
        /// 观战人数已满
        /// </summary>
        public const int ErrCodeSpectatorLimit = 3011;

        /// <summary>
        /// 回放不存在
        /// </summary>
        public const int ErrCodeReplayNotFound = 3013;

        #endregion

        #region 消息类型常量

        /// <summary>
        /// 创建房间
        /// </summary>
        public const int MsgTypeCreateRoom = 101;

        /// <summary>
        /// 加入房间
        /// </summary>
        public const int MsgTypeJoinRoom = 102;

        /// <summary>
        /// 离开房间
        /// </summary>
        public const int MsgTypeLeaveRoom = 103;

        /// <summary>
        /// 房间信息
        /// </summary>
        public const int MsgTypeRoomInfo = 104;

        /// <summary>
        /// 玩家列表
        /// </summary>
        public const int MsgTypePlayerList = 105;

        /// <summary>
        /// 准备/取消准备
        /// </summary>
        public const int MsgTypeReady = 106;

        /// <summary>
        /// 开始游戏
        /// </summary>
        public const int MsgTypeStartGame = 107;

        /// <summary>
        /// 提交时间线
        /// </summary>
        public const int MsgTypeSubmitTimeline = 201;

        /// <summary>
        /// 时间线提交确认
        /// </summary>
        public const int MsgTypeTimelineAck = 202;

        /// <summary>
        /// 状态快照
        /// </summary>
        public const int MsgTypeStateSnapshot = 203;

        /// <summary>
        /// 完整状态
        /// </summary>
        public const int MsgTypeFullState = 204;

        /// <summary>
        /// 阶段变化
        /// </summary>
        public const int MsgTypePhaseChange = 205;

        /// <summary>
        /// 动作执行
        /// </summary>
        public const int MsgTypeActionExecution = 206;

        /// <summary>
        /// 游戏结束
        /// </summary>
        public const int MsgTypeGameOver = 207;

        /// <summary>
        /// 心跳
        /// </summary>
        public const int MsgTypeHeartbeat = 301;

        /// <summary>
        /// 重连请求
        /// </summary>
        public const int MsgTypeReconnect = 302;

        /// <summary>
        /// 重连响应
        /// </summary>
        public const int MsgTypeReconnectAck = 303;

        /// <summary>
        /// 观战加入
        /// </summary>
        public const int MsgTypeSpectateJoin = 401;

        /// <summary>
        /// 观战离开
        /// </summary>
        public const int MsgTypeSpectateLeave = 402;

        /// <summary>
        /// 观战状态推送
        /// </summary>
        public const int MsgTypeSpectateState = 403;

        /// <summary>
        /// 回放列表
        /// </summary>
        public const int MsgTypeReplayList = 501;

        /// <summary>
        /// 回放数据
        /// </summary>
        public const int MsgTypeReplayData = 502;

        /// <summary>
        /// 校验结果
        /// </summary>
        public const int MsgTypeValidationResult = 601;

        /// <summary>
        /// 错误消息
        /// </summary>
        public const int MsgTypeError = 500;

        #endregion
    }
}
