using System;
using MessagePack;

namespace Protocol
{
    /// <summary>
    /// 坐标位置
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public class Position
    {
        /// <summary>
        /// X坐标
        /// </summary>
        [Key("x")]
        public int X { get; set; }

        /// <summary>
        /// Y坐标
        /// </summary>
        [Key("y")]
        public int Y { get; set; }
    }

    /// <summary>
    /// 玩家信息
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public class Player
    {
        /// <summary>
        /// 玩家ID
        /// </summary>
        [Key("id")]
        public string ID { get; set; }

        /// <summary>
        /// 玩家名称
        /// </summary>
        [Key("name")]
        public string Name { get; set; }

        /// <summary>
        /// 队伍编号
        /// </summary>
        [Key("team")]
        public int Team { get; set; }

        /// <summary>
        /// 资源数量
        /// </summary>
        [Key("resources")]
        public int Resources { get; set; }

        /// <summary>
        /// 是否已准备
        /// </summary>
        [Key("ready")]
        public bool Ready { get; set; }
    }

    /// <summary>
    /// 玩家动作
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public class Action
    {
        /// <summary>
        /// 动作ID
        /// </summary>
        [Key("id")]
        public string ID { get; set; }

        /// <summary>
        /// 玩家ID
        /// </summary>
        [Key("playerId")]
        public string PlayerID { get; set; }

        /// <summary>
        /// 动作类型
        /// </summary>
        [Key("type")]
        public ActionType Type { get; set; }

        /// <summary>
        /// 单位ID
        /// </summary>
        [Key("unitId")]
        public string UnitID { get; set; }

        /// <summary>
        /// 目标位置
        /// </summary>
        [Key("targetPos")]
        public Position TargetPos { get; set; }

        /// <summary>
        /// 目标ID
        /// </summary>
        [Key("targetId")]
        public string TargetID { get; set; }

        /// <summary>
        /// 建筑类型
        /// </summary>
        [Key("buildingType")]
        public BuildingType BuildingType { get; set; }

        /// <summary>
        /// 执行时间戳（毫秒）
        /// </summary>
        [Key("executeTime")]
        public long ExecuteTime { get; set; }
    }

    /// <summary>
    /// 时间线，包含一组按时间排序的动作
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public class Timeline
    {
        /// <summary>
        /// 玩家ID
        /// </summary>
        [Key("playerId")]
        public string PlayerID { get; set; }

        /// <summary>
        /// 动作列表
        /// </summary>
        [Key("actions")]
        public Action[] Actions { get; set; }
    }

    /// <summary>
    /// 游戏单位
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public class Unit
    {
        /// <summary>
        /// 单位ID
        /// </summary>
        [Key("id")]
        public string ID { get; set; }

        /// <summary>
        /// 单位类型
        /// </summary>
        [Key("type")]
        public UnitType Type { get; set; }

        /// <summary>
        /// 所属玩家ID
        /// </summary>
        [Key("playerId")]
        public string PlayerID { get; set; }

        /// <summary>
        /// 当前生命值
        /// </summary>
        [Key("hp")]
        public int HP { get; set; }

        /// <summary>
        /// 最大生命值
        /// </summary>
        [Key("maxHp")]
        public int MaxHP { get; set; }

        /// <summary>
        /// 位置
        /// </summary>
        [Key("position")]
        public Position Position { get; set; }

        /// <summary>
        /// 攻击力
        /// </summary>
        [Key("attack")]
        public int Attack { get; set; }

        /// <summary>
        /// 攻击范围
        /// </summary>
        [Key("range")]
        public int Range { get; set; }

        /// <summary>
        /// 移动速度（格/秒）
        /// </summary>
        [Key("speed")]
        public int Speed { get; set; }
    }

    /// <summary>
    /// 游戏建筑
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public class Building
    {
        /// <summary>
        /// 建筑ID
        /// </summary>
        [Key("id")]
        public string ID { get; set; }

        /// <summary>
        /// 建筑类型
        /// </summary>
        [Key("type")]
        public BuildingType Type { get; set; }

        /// <summary>
        /// 所属玩家ID
        /// </summary>
        [Key("playerId")]
        public string PlayerID { get; set; }

        /// <summary>
        /// 当前生命值
        /// </summary>
        [Key("hp")]
        public int HP { get; set; }

        /// <summary>
        /// 最大生命值
        /// </summary>
        [Key("maxHp")]
        public int MaxHP { get; set; }

        /// <summary>
        /// 位置
        /// </summary>
        [Key("position")]
        public Position Position { get; set; }
    }

    /// <summary>
    /// 游戏状态快照
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public class GameState
    {
        /// <summary>
        /// 游戏阶段
        /// </summary>
        [Key("phase")]
        public GamePhase Phase { get; set; }

        /// <summary>
        /// 当前回合数
        /// </summary>
        [Key("turn")]
        public int Turn { get; set; }

        /// <summary>
        /// 单位列表
        /// </summary>
        [Key("units")]
        public Unit[] Units { get; set; }

        /// <summary>
        /// 建筑列表
        /// </summary>
        [Key("buildings")]
        public Building[] Buildings { get; set; }

        /// <summary>
        /// 玩家列表
        /// </summary>
        [Key("players")]
        public Player[] Players { get; set; }

        /// <summary>
        /// 时间戳（毫秒）
        /// </summary>
        [Key("timestamp")]
        public long Timestamp { get; set; }
    }

    /// <summary>
    /// 完整游戏状态，包含所有游戏信息
    /// </summary>
    [Serializable]
    [MessagePackObject]
    public class FullGameState
    {
        /// <summary>
        /// 房间ID
        /// </summary>
        [Key("roomId")]
        public string RoomID { get; set; }

        /// <summary>
        /// 当前玩家ID（重连时用于恢复控制权）
        /// </summary>
        [Key("playerId")]
        public string PlayerID { get; set; }

        /// <summary>
        /// 游戏状态
        /// </summary>
        [Key("gameState")]
        public GameState GameState { get; set; }

        /// <summary>
        /// 时间线列表
        /// </summary>
        [Key("timelines")]
        public Timeline[] Timelines { get; set; }
    }
}
