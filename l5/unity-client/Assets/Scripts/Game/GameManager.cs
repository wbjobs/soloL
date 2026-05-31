using System;
using System.Collections.Generic;
using UnityEngine;

namespace Game
{
    /// <summary>
    /// 游戏阶段枚举
    /// </summary>
    public enum GamePhase
    {
        Lobby,
        Planning,
        Simulating,
        GameOver
    }

    /// <summary>
    /// 玩家资源数据
    /// </summary>
    [Serializable]
    public class PlayerResources
    {
        public int Gold;
        public int Food;
        public int Wood;
        public int Stone;

        public PlayerResources(int gold, int food, int wood, int stone)
        {
            Gold = gold;
            Food = food;
            Wood = wood;
            Stone = stone;
        }

        public void AddResources(PlayerResources delta)
        {
            Gold += delta.Gold;
            Food += delta.Food;
            Wood += delta.Wood;
            Stone += delta.Stone;
        }

        public bool CanAfford(PlayerResources cost)
        {
            return Gold >= cost.Gold &&
                   Food >= cost.Food &&
                   Wood >= cost.Wood &&
                   Stone >= cost.Stone;
        }
    }

    /// <summary>
    /// 游戏管理器单例
    /// 负责游戏状态机、回合管理和资源管理
    /// </summary>
    public class GameManager : MonoBehaviour
    {
        private static readonly Lazy<GameManager> _instance = new Lazy<GameManager>(() =>
        {
            GameObject go = new GameObject("GameManager");
            go.AddComponent<GameManager>();
            DontDestroyOnLoad(go);
            return go.GetComponent<GameManager>();
        });

        /// <summary>
        /// 单例实例
        /// </summary>
        public static GameManager Instance => _instance.Value;

        [Header("游戏状态")]
        [SerializeField] private GamePhase _currentPhase = GamePhase.Lobby;
        [SerializeField] private int _currentRound = 0;

        [Header("玩家资源")]
        [SerializeField] private PlayerResources _playerResources = new PlayerResources(1000, 500, 300, 200);

        /// <summary>
        /// 当前游戏阶段
        /// </summary>
        public GamePhase CurrentPhase
        {
            get => _currentPhase;
            private set
            {
                if (_currentPhase != value)
                {
                    GamePhase oldPhase = _currentPhase;
                    _currentPhase = value;
                    OnPhaseChange?.Invoke(oldPhase, _currentPhase);
                }
            }
        }

        /// <summary>
        /// 当前回合数
        /// </summary>
        public int CurrentRound
        {
            get => _currentRound;
            private set => _currentRound = Mathf.Max(0, value);
        }

        /// <summary>
        /// 玩家资源
        /// </summary>
        public PlayerResources PlayerResources => _playerResources;

        /// <summary>
        /// 阶段变化事件
        /// 参数：旧阶段，新阶段
        /// </summary>
        public event Action<GamePhase, GamePhase> OnPhaseChange;

        /// <summary>
        /// 资源更新事件
        /// 参数：更新后的资源
        /// </summary>
        public event Action<PlayerResources> OnResourcesUpdated;

        /// <summary>
        /// 回合变化事件
        /// 参数：新回合数
        /// </summary>
        public event Action<int> OnRoundChanged;

        /// <summary>
        /// 游戏开始事件
        /// </summary>
        public event Action OnGameStarted;

        /// <summary>
        /// 游戏结束事件
        /// 参数：胜利方ID
        /// </summary>
        public event Action<int> OnGameOver;

        private void Awake()
        {
            if (_instance.IsValueCreated && _instance.Value != this)
            {
                Destroy(gameObject);
                return;
            }

            DontDestroyOnLoad(gameObject);
            InitializeGame();
        }

        /// <summary>
        /// 初始化游戏
        /// </summary>
        private void InitializeGame()
        {
            CurrentRound = 0;
            CurrentPhase = GamePhase.Lobby;
            _playerResources = new PlayerResources(1000, 500, 300, 200);
        }

        /// <summary>
        /// 开始游戏
        /// </summary>
        public void StartGame()
        {
            if (CurrentPhase != GamePhase.Lobby)
            {
                Debug.LogWarning($"无法在 {CurrentPhase} 阶段开始游戏");
                return;
            }

            CurrentRound = 1;
            CurrentPhase = GamePhase.Planning;
            OnGameStarted?.Invoke();
            OnRoundChanged?.Invoke(CurrentRound);
            Debug.Log($"游戏开始！第 {CurrentRound} 回合，进入规划阶段");
        }

        /// <summary>
        /// 开始规划阶段
        /// </summary>
        public void StartPlanningPhase()
        {
            if (CurrentPhase != GamePhase.Simulating && CurrentPhase != GamePhase.Lobby)
            {
                Debug.LogWarning($"无法从 {CurrentPhase} 阶段进入规划阶段");
                return;
            }

            if (CurrentPhase == GamePhase.Simulating)
            {
                CurrentRound++;
                OnRoundChanged?.Invoke(CurrentRound);
            }

            CurrentPhase = GamePhase.Planning;
            Debug.Log($"第 {CurrentRound} 回合 - 规划阶段开始");
        }

        /// <summary>
        /// 开始模拟阶段
        /// </summary>
        public void StartSimulatingPhase()
        {
            if (CurrentPhase != GamePhase.Planning)
            {
                Debug.LogWarning($"无法从 {CurrentPhase} 阶段进入模拟阶段");
                return;
            }

            CurrentPhase = GamePhase.Simulating;
            Debug.Log($"第 {CurrentRound} 回合 - 模拟阶段开始");
        }

        /// <summary>
        /// 结束游戏
        /// </summary>
        /// <param name="winnerPlayerId">胜利方玩家ID</param>
        public void EndGame(int winnerPlayerId)
        {
            if (CurrentPhase == GamePhase.GameOver)
            {
                return;
            }

            CurrentPhase = GamePhase.GameOver;
            OnGameOver?.Invoke(winnerPlayerId);
            Debug.Log($"游戏结束！玩家 {winnerPlayerId} 获胜");
        }

        /// <summary>
        /// 更新玩家资源
        /// </summary>
        /// <param name="delta">资源变化量（正数增加，负数减少）</param>
        public void UpdateResources(PlayerResources delta)
        {
            _playerResources.AddResources(delta);
            OnResourcesUpdated?.Invoke(_playerResources);
        }

        /// <summary>
        /// 检查是否有足够资源
        /// </summary>
        /// <param name="cost">消耗的资源</param>
        /// <returns>是否足够</returns>
        public bool CanAfford(PlayerResources cost)
        {
            return _playerResources.CanAfford(cost);
        }

        /// <summary>
        /// 消耗资源
        /// </summary>
        /// <param name="cost">消耗的资源量</param>
        /// <returns>是否成功消耗</returns>
        public bool SpendResources(PlayerResources cost)
        {
            if (!CanAfford(cost))
            {
                Debug.LogWarning("资源不足！");
                return false;
            }

            _playerResources.Gold -= cost.Gold;
            _playerResources.Food -= cost.Food;
            _playerResources.Wood -= cost.Wood;
            _playerResources.Stone -= cost.Stone;
            OnResourcesUpdated?.Invoke(_playerResources);
            return true;
        }

        /// <summary>
        /// 重置游戏
        /// </summary>
        public void ResetGame()
        {
            StopAllCoroutines();
            InitializeGame();
            Debug.Log("游戏已重置");
        }
    }
}
