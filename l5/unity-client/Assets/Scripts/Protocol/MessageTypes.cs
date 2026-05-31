using System;
using MessagePack;

namespace Protocol
{
    /// <summary>
    /// 消息类型枚举，用于区分不同类别的消息
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public enum MessageType
    {
        /// <summary>
        /// 房间相关消息
        /// </summary>
        [Key(1)]
        MessageTypeRoom = 1,

        /// <summary>
        /// 游戏相关消息
        /// </summary>
        [Key(2)]
        MessageTypeGame = 2,

        /// <summary>
        /// 系统相关消息
        /// </summary>
        [Key(3)]
        MessageTypeSystem = 3
    }

    /// <summary>
    /// 动作类型枚举，定义玩家可以执行的操作
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public enum ActionType
    {
        /// <summary>
        /// 移动单位
        /// </summary>
        [Key(1)]
        ActionMove = 1,

        /// <summary>
        /// 攻击目标
        /// </summary>
        [Key(2)]
        ActionAttack = 2,

        /// <summary>
        /// 建造建筑
        /// </summary>
        [Key(3)]
        ActionBuild = 3
    }

    /// <summary>
    /// 单位类型枚举
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public enum UnitType
    {
        /// <summary>
        /// 战士单位 - 近战高血量
        /// </summary>
        [Key(1)]
        UnitWarrior = 1,

        /// <summary>
        /// 弓箭手单位 - 远程高伤害
        /// </summary>
        [Key(2)]
        UnitArcher = 2,

        /// <summary>
        /// 法师单位 - 范围攻击
        /// </summary>
        [Key(3)]
        UnitMage = 3
    }

    /// <summary>
    /// 建筑类型枚举
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public enum BuildingType
    {
        /// <summary>
        /// 基地建筑 - 核心建筑，被摧毁则失败
        /// </summary>
        [Key(1)]
        BuildingBase = 1,

        /// <summary>
        /// 炮塔建筑 - 防御建筑，自动攻击
        /// </summary>
        [Key(2)]
        BuildingTurret = 2,

        /// <summary>
        /// 兵营建筑 - 生产单位
        /// </summary>
        [Key(3)]
        BuildingBarracks = 3
    }

    /// <summary>
    /// 游戏阶段枚举
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public enum GamePhase
    {
        /// <summary>
        /// 大厅阶段 - 等待玩家加入
        /// </summary>
        [Key(1)]
        GamePhaseLobby = 1,

        /// <summary>
        /// 规划阶段 - 玩家规划行动
        /// </summary>
        [Key(2)]
        GamePhasePlanning = 2,

        /// <summary>
        /// 模拟阶段 - 执行玩家行动
        /// </summary>
        [Key(3)]
        GamePhaseSimulating = 3,

        /// <summary>
        /// 游戏结束阶段
        /// </summary>
        [Key(4)]
        GamePhaseGameOver = 4
    }
}
