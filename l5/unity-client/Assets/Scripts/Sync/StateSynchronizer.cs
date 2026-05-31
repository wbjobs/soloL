using System;
using System.Collections.Generic;
using UnityEngine;
using Game;

namespace Sync
{
    /// <summary>
    /// 单位状态快照
    /// </summary>
    [Serializable]
    public class UnitStateSnapshot
    {
        public string UnitId;
        public int OwnerPlayerId;
        public UnitType UnitType;
        public Vector3 Position;
        public int CurrentHP;
        public int MaxHP;
        public UnitState State;
        public float Timestamp;

        public UnitStateSnapshot Clone()
        {
            return new UnitStateSnapshot
            {
                UnitId = UnitId,
                OwnerPlayerId = OwnerPlayerId,
                UnitType = UnitType,
                Position = Position,
                CurrentHP = CurrentHP,
                MaxHP = MaxHP,
                State = State,
                Timestamp = Timestamp
            };
        }
    }

    /// <summary>
    /// 建筑状态快照
    /// </summary>
    [Serializable]
    public class BuildingStateSnapshot
    {
        public string BuildingId;
        public int OwnerPlayerId;
        public BuildingType BuildingType;
        public Vector3 Position;
        public int CurrentHP;
        public int MaxHP;
        public float BuildProgress;
        public BuildingState State;
        public float Timestamp;

        public BuildingStateSnapshot Clone()
        {
            return new BuildingStateSnapshot
            {
                BuildingId = BuildingId,
                OwnerPlayerId = OwnerPlayerId,
                BuildingType = BuildingType,
                Position = Position,
                CurrentHP = CurrentHP,
                MaxHP = MaxHP,
                BuildProgress = BuildProgress,
                State = State,
                Timestamp = Timestamp
            };
        }
    }

    /// <summary>
    /// 游戏状态快照
    /// </summary>
    [Serializable]
    public class GameStateSnapshot
    {
        public long FrameNumber;
        public GamePhase Phase;
        public int CurrentRound;
        public float Timestamp;
        public Dictionary<string, UnitStateSnapshot> Units = new Dictionary<string, UnitStateSnapshot>();
        public Dictionary<string, BuildingStateSnapshot> Buildings = new Dictionary<string, BuildingStateSnapshot>();
        public PlayerResources Player1Resources;
        public PlayerResources Player2Resources;

        public GameStateSnapshot Clone()
        {
            var clone = new GameStateSnapshot
            {
                FrameNumber = FrameNumber,
                Phase = Phase,
                CurrentRound = CurrentRound,
                Timestamp = Timestamp,
                Player1Resources = new PlayerResources(Player1Resources.Gold, Player1Resources.Food, Player1Resources.Wood, Player1Resources.Stone),
                Player2Resources = new PlayerResources(Player2Resources.Gold, Player2Resources.Food, Player2Resources.Wood, Player2Resources.Stone)
            };

            foreach (var kvp in Units)
            {
                clone.Units[kvp.Key] = kvp.Value.Clone();
            }

            foreach (var kvp in Buildings)
            {
                clone.Buildings[kvp.Key] = kvp.Value.Clone();
            }

            return clone;
        }
    }

    /// <summary>
    /// 状态增量更新
    /// </summary>
    [Serializable]
    public class StateDelta
    {
        public long FromFrame;
        public long ToFrame;
        public float Timestamp;
        public List<UnitStateSnapshot> UpdatedUnits = new List<UnitStateSnapshot>();
        public List<string> RemovedUnits = new List<string>();
        public List<BuildingStateSnapshot> UpdatedBuildings = new List<BuildingStateSnapshot>();
        public List<string> RemovedBuildings = new List<string>();
        public PlayerResources Player1ResourcesDelta;
        public PlayerResources Player2ResourcesDelta;
        public GamePhase? PhaseChange;
        public int? RoundChange;
    }

    /// <summary>
    /// 预测状态
    /// </summary>
    public class PredictedState
    {
        public Vector3 PredictedPosition;
        public Vector3 Velocity;
        public float LastUpdateTime;
    }

    /// <summary>
    /// 状态同步器
    /// 负责状态快照缓冲、插值、预测和应用
    /// </summary>
    public class StateSynchronizer : MonoBehaviour
    {
        private static StateSynchronizer _instance;

        /// <summary>
        /// 单例实例
        /// </summary>
        public static StateSynchronizer Instance
        {
            get
            {
                if (_instance == null)
                {
                    GameObject go = new GameObject("StateSynchronizer");
                    _instance = go.AddComponent<StateSynchronizer>();
                    DontDestroyOnLoad(go);
                }
                return _instance;
            }
        }

        [Header("同步设置")]
        [SerializeField] private int _snapshotBufferSize = 20;
        [SerializeField] private float _playbackRate = 20f;
        [SerializeField] private float _interpolationDelay = 0.1f;
        [SerializeField] private float _maxPredictionTime = 0.5f;
        [SerializeField] private float _positionExtrapolationFactor = 1.5f;
        [SerializeField] private float _snapThreshold = 2f;

        [Header("Prefab引用")]
        [SerializeField] private UnitView _unitPrefab;
        [SerializeField] private BuildingView _buildingPrefab;

        [Header("父物体引用")]
        [SerializeField] private Transform _unitsParent;
        [SerializeField] private Transform _buildingsParent;

        private readonly CircularBuffer<GameStateSnapshot> _snapshotBuffer;
        private readonly Dictionary<string, UnitView> _activeUnits = new Dictionary<string, UnitView>();
        private readonly Dictionary<string, BuildingView> _activeBuildings = new Dictionary<string, BuildingView>();
        private readonly Dictionary<string, PredictedState> _predictedStates = new Dictionary<string, PredictedState>();
        private readonly Dictionary<UnitType, UnitView> _unitPrefabs = new Dictionary<UnitType, UnitView>();
        private readonly Dictionary<BuildingType, BuildingView> _buildingPrefabs = new Dictionary<BuildingType, BuildingView>();

        private Coroutine _playbackCoroutine;
        private GameStateSnapshot _previousSnapshot;
        private GameStateSnapshot _nextSnapshot;
        private float _interpolationTimer;
        private long _lastProcessedFrame;
        private bool _isPlaying;
        private int _localPlayerId = 1;

        /// <summary>
        /// 当前插值进度 (0.0 - 1.0)
        /// </summary>
        public float InterpolationAlpha => _interpolationTimer;

        /// <summary>
        /// 缓冲中的快照数量
        /// </summary>
        public int BufferedSnapshots => _snapshotBuffer.Count;

        /// <summary>
        /// 最后处理的帧号
        /// </summary>
        public long LastProcessedFrame => _lastProcessedFrame;

        /// <summary>
        /// 是否正在播放
        /// </summary>
        public bool IsPlaying => _isPlaying;

        /// <summary>
        /// 本地玩家ID
        /// </summary>
        public int LocalPlayerId
        {
            get => _localPlayerId;
            set => _localPlayerId = value;
        }

        /// <summary>
        /// 快照添加事件
        /// </summary>
        public event Action<GameStateSnapshot> OnSnapshotAdded;

        /// <summary>
        /// 完整状态应用事件
        /// </summary>
        public event Action<GameStateSnapshot> OnFullStateApplied;

        /// <summary>
        /// 增量状态应用事件
        /// </summary>
        public event Action<StateDelta> OnDeltaApplied;

        public StateSynchronizer()
        {
            _snapshotBuffer = new CircularBuffer<GameStateSnapshot>(_snapshotBufferSize);
        }

        private void Awake()
        {
            if (_instance != null && _instance != this)
            {
                Destroy(gameObject);
                return;
            }

            _instance = this;
            DontDestroyOnLoad(gameObject);
            InitializeParentTransforms();
        }

        private void Update()
        {
            if (_isPlaying && _previousSnapshot != null && _nextSnapshot != null)
            {
                ProcessInterpolation();
            }

            ProcessPrediction();
        }

        /// <summary>
        /// 初始化父物体变换
        /// </summary>
        private void InitializeParentTransforms()
        {
            if (_unitsParent == null)
            {
                GameObject unitsGo = new GameObject("Units");
                unitsGo.transform.SetParent(transform);
                _unitsParent = unitsGo.transform;
            }

            if (_buildingsParent == null)
            {
                GameObject buildingsGo = new GameObject("Buildings");
                buildingsGo.transform.SetParent(transform);
                _buildingsParent = buildingsGo.transform;
            }
        }

        /// <summary>
        /// 注册单位预制体
        /// </summary>
        /// <param name="type">单位类型</param>
        /// <param name="prefab">预制体</param>
        public void RegisterUnitPrefab(UnitType type, UnitView prefab)
        {
            _unitPrefabs[type] = prefab;
        }

        /// <summary>
        /// 注册建筑预制体
        /// </summary>
        /// <param name="type">建筑类型</param>
        /// <param name="prefab">预制体</param>
        public void RegisterBuildingPrefab(BuildingType type, BuildingView prefab)
        {
            _buildingPrefabs[type] = prefab;
        }

        /// <summary>
        /// 添加状态快照
        /// </summary>
        /// <param name="snapshot">状态快照</param>
        public void AddSnapshot(GameStateSnapshot snapshot)
        {
            if (snapshot == null)
            {
                Debug.LogWarning("不能添加空的状态快照");
                return;
            }

            if (snapshot.FrameNumber <= _lastProcessedFrame)
            {
                Debug.LogWarning($"丢弃过期快照，帧号: {snapshot.FrameNumber}, 已处理到: {_lastProcessedFrame}");
                return;
            }

            _snapshotBuffer.Add(snapshot);
            OnSnapshotAdded?.Invoke(snapshot);
            Debug.Log($"添加快照，帧号: {snapshot.FrameNumber}, 缓冲大小: {_snapshotBuffer.Count}");
        }

        /// <summary>
        /// 应用完整状态（重连时使用）
        /// </summary>
        /// <param name="fullState">完整游戏状态</param>
        /// <param name="playerID">当前玩家ID，用于恢复控制权</param>
        public void ApplyFullState(GameStateSnapshot fullState, string playerID = null)
        {
            if (fullState == null)
            {
                Debug.LogError("完整状态为空");
                return;
            }

            StopPlayback();
            ClearAllEntities();
            _snapshotBuffer.Clear();

            if (!string.IsNullOrEmpty(playerID))
            {
                _localPlayerId = int.Parse(playerID.Replace("player_", "").Split('_')[0]);
                Debug.Log($"[StateSynchronizer] 重连恢复玩家ID: {playerID}, LocalPlayerId: {_localPlayerId}");
            }

            _lastProcessedFrame = fullState.FrameNumber;

            foreach (var unitSnapshot in fullState.Units.Values)
            {
                CreateOrUpdateUnit(unitSnapshot);
            }

            foreach (var buildingSnapshot in fullState.Buildings.Values)
            {
                CreateOrUpdateBuilding(buildingSnapshot);
            }

            UpdateGamePhase(fullState.Phase);
            UpdateCurrentRound(fullState.CurrentRound);
            UpdatePlayerResources(fullState);

            _snapshotBuffer.Add(fullState.Clone());
            StartPlayback();

            OnFullStateApplied?.Invoke(fullState);
            Debug.Log($"应用完整状态，帧号: {fullState.FrameNumber}, 单位: {fullState.Units.Count}, 建筑: {fullState.Buildings.Count}, 本地玩家: {_localPlayerId}");
        }

        /// <summary>
        /// 应用增量状态更新
        /// </summary>
        /// <param name="delta">状态增量</param>
        public void ApplyDelta(StateDelta delta)
        {
            if (delta == null)
            {
                Debug.LogError("增量状态为空");
                return;
            }

            if (delta.FromFrame > _lastProcessedFrame + 1)
            {
                Debug.LogWarning($"增量状态不连续，期望帧号: {_lastProcessedFrame + 1}, 收到: {delta.FromFrame}");
                RequestFullState();
                return;
            }

            foreach (var unitSnapshot in delta.UpdatedUnits)
            {
                CreateOrUpdateUnit(unitSnapshot);
                UpdatePrediction(unitSnapshot);
            }

            foreach (var unitId in delta.RemovedUnits)
            {
                RemoveUnit(unitId);
            }

            foreach (var buildingSnapshot in delta.UpdatedBuildings)
            {
                CreateOrUpdateBuilding(buildingSnapshot);
            }

            foreach (var buildingId in delta.RemovedBuildings)
            {
                RemoveBuilding(buildingId);
            }

            if (delta.Player1ResourcesDelta != null && _localPlayerId == 1)
            {
                GameManager.Instance.UpdateResources(delta.Player1ResourcesDelta);
            }
            if (delta.Player2ResourcesDelta != null && _localPlayerId == 2)
            {
                GameManager.Instance.UpdateResources(delta.Player2ResourcesDelta);
            }

            if (delta.PhaseChange.HasValue)
            {
                UpdateGamePhase(delta.PhaseChange.Value);
            }

            if (delta.RoundChange.HasValue)
            {
                UpdateCurrentRound(delta.RoundChange.Value);
            }

            _lastProcessedFrame = delta.ToFrame;
            OnDeltaApplied?.Invoke(delta);
        }

        /// <summary>
        /// 开始播放快照序列
        /// </summary>
        public void StartPlayback()
        {
            if (_isPlaying) return;

            _isPlaying = true;
            if (_playbackCoroutine != null)
            {
                StopCoroutine(_playbackCoroutine);
            }
            _playbackCoroutine = StartCoroutine(PlaybackSnapshots());
            Debug.Log("开始播放快照序列");
        }

        /// <summary>
        /// 停止播放快照序列
        /// </summary>
        public void StopPlayback()
        {
            _isPlaying = false;
            if (_playbackCoroutine != null)
            {
                StopCoroutine(_playbackCoroutine);
                _playbackCoroutine = null;
            }
            Debug.Log("停止播放快照序列");
        }

        /// <summary>
        /// 快照播放协程，按20fps播放
        /// </summary>
        private System.Collections.IEnumerator PlaybackSnapshots()
        {
            WaitForSeconds wait = new WaitForSeconds(1f / _playbackRate);

            while (_isPlaying)
            {
                if (_snapshotBuffer.Count >= 2)
                {
                    if (_previousSnapshot == null)
                    {
                        _previousSnapshot = _snapshotBuffer[0];
                    }

                    if (_nextSnapshot == null || _interpolationTimer >= 1f)
                    {
                        AdvanceToNextSnapshot();
                    }
                }
                else
                {
                    Debug.LogWarning($"快照缓冲不足: {_snapshotBuffer.Count}/{_snapshotBufferSize}");
                }

                yield return wait;
            }
        }

        /// <summary>
        /// 前进到下一个快照
        /// </summary>
        private void AdvanceToNextSnapshot()
        {
            if (_snapshotBuffer.Count < 2) return;

            _previousSnapshot = _snapshotBuffer[0];
            _nextSnapshot = _snapshotBuffer[1];
            _interpolationTimer = 0f;

            _snapshotBuffer.RemoveAt(0);
            _lastProcessedFrame = _previousSnapshot.FrameNumber;
        }

        /// <summary>
        /// 处理插值
        /// </summary>
        private void ProcessInterpolation()
        {
            float deltaTime = Time.deltaTime;
            float frameDuration = 1f / _playbackRate;
            _interpolationTimer += deltaTime / frameDuration;

            if (_interpolationTimer >= 1f)
            {
                _interpolationTimer = 1f;
            }

            float t = Mathf.SmoothStep(0f, 1f, _interpolationTimer);

            foreach (var kvp in _nextSnapshot.Units)
            {
                string unitId = kvp.Key;
                UnitStateSnapshot nextUnitState = kvp.Value;

                if (_activeUnits.TryGetValue(unitId, out UnitView unitView))
                {
                    if (_previousSnapshot.Units.TryGetValue(unitId, out UnitStateSnapshot prevUnitState))
                    {
                        Vector3 interpolatedPosition = Vector3.Lerp(
                            prevUnitState.Position,
                            nextUnitState.Position,
                            t
                        );

                        unitView.SetPosition(interpolatedPosition);
                        unitView.UpdateHP(nextUnitState.CurrentHP);
                    }
                    else
                    {
                        CreateOrUpdateUnit(nextUnitState);
                    }
                }
                else
                {
                    CreateOrUpdateUnit(nextUnitState);
                }
            }

            foreach (var kvp in _nextSnapshot.Buildings)
            {
                string buildingId = kvp.Key;
                BuildingStateSnapshot nextBuildingState = kvp.Value;

                if (_activeBuildings.TryGetValue(buildingId, out BuildingView buildingView))
                {
                    buildingView.UpdateHP(nextBuildingState.CurrentHP);
                    buildingView.UpdateBuildProgress(nextBuildingState.BuildProgress);
                }
                else
                {
                    CreateOrUpdateBuilding(nextBuildingState);
                }
            }

            CheckForRemovedEntities();
        }

        /// <summary>
        /// 处理预测逻辑
        /// </summary>
        private void ProcessPrediction()
        {
            float currentTime = Time.time;

            foreach (var kvp in _predictedStates)
            {
                string entityId = kvp.Key;
                PredictedState predictedState = kvp.Value;

                if (_activeUnits.TryGetValue(entityId, out UnitView unitView))
                {
                    float timeSinceLastUpdate = currentTime - predictedState.LastUpdateTime;

                    if (timeSinceLastUpdate > _interpolationDelay && timeSinceLastUpdate < _maxPredictionTime)
                    {
                        Vector3 predictedPosition = unitView.transform.position +
                            predictedState.Velocity * timeSinceLastUpdate * _positionExtrapolationFactor;

                        float distance = Vector3.Distance(unitView.transform.position, predictedPosition);
                        if (distance < _snapThreshold)
                        {
                            unitView.transform.position = Vector3.Lerp(
                                unitView.transform.position,
                                predictedPosition,
                                Time.deltaTime * 5f
                            );
                        }
                    }
                }
            }
        }

        /// <summary>
        /// 更新预测状态
        /// </summary>
        /// <param name="unitSnapshot">单位快照</param>
        private void UpdatePrediction(UnitStateSnapshot unitSnapshot)
        {
            if (!_activeUnits.TryGetValue(unitSnapshot.UnitId, out UnitView unitView)) return;

            if (!_predictedStates.TryGetValue(unitSnapshot.UnitId, out PredictedState predictedState))
            {
                predictedState = new PredictedState();
                _predictedStates[unitSnapshot.UnitId] = predictedState;
            }

            Vector3 deltaPosition = unitSnapshot.Position - unitView.transform.position;
            float deltaTime = Time.time - predictedState.LastUpdateTime;

            if (deltaTime > 0.01f)
            {
                predictedState.Velocity = deltaPosition / deltaTime;
            }

            predictedState.LastUpdateTime = Time.time;
            predictedState.PredictedPosition = unitSnapshot.Position;
        }

        /// <summary>
        /// 创建或更新单位
        /// </summary>
        /// <param name="unitSnapshot">单位状态快照</param>
        private void CreateOrUpdateUnit(UnitStateSnapshot unitSnapshot)
        {
            if (_activeUnits.TryGetValue(unitSnapshot.UnitId, out UnitView unitView))
            {
                unitView.UpdateFromNetwork(
                    unitSnapshot.Position,
                    unitSnapshot.CurrentHP,
                    unitSnapshot.State
                );
            }
            else
            {
                UnitView prefab = GetUnitPrefab(unitSnapshot.UnitType);
                if (prefab == null)
                {
                    Debug.LogError($"未找到单位预制体: {unitSnapshot.UnitType}");
                    return;
                }

                unitView = Instantiate(prefab, _unitsParent);
                unitView.name = $"Unit_{unitSnapshot.UnitId}";

                UnitData unitData = new UnitData
                {
                    UnitId = unitSnapshot.UnitId,
                    UnitType = unitSnapshot.UnitType,
                    OwnerPlayerId = unitSnapshot.OwnerPlayerId,
                    MaxHP = unitSnapshot.MaxHP,
                    SpawnPosition = unitSnapshot.Position
                };

                unitView.Initialize(unitData);
                unitView.UpdateFromNetwork(
                    unitSnapshot.Position,
                    unitSnapshot.CurrentHP,
                    unitSnapshot.State
                );

                unitView.OnUnitDeath += HandleUnitDeath;

                _activeUnits[unitSnapshot.UnitId] = unitView;
                Debug.Log($"创建单位: {unitSnapshot.UnitId}, 类型: {unitSnapshot.UnitType}");
            }
        }

        /// <summary>
        /// 创建或更新建筑
        /// </summary>
        /// <param name="buildingSnapshot">建筑状态快照</param>
        private void CreateOrUpdateBuilding(BuildingStateSnapshot buildingSnapshot)
        {
            if (_activeBuildings.TryGetValue(buildingSnapshot.BuildingId, out BuildingView buildingView))
            {
                buildingView.UpdateFromNetwork(
                    buildingSnapshot.CurrentHP,
                    buildingSnapshot.BuildProgress,
                    buildingSnapshot.State
                );
            }
            else
            {
                BuildingView prefab = GetBuildingPrefab(buildingSnapshot.BuildingType);
                if (prefab == null)
                {
                    Debug.LogError($"未找到建筑预制体: {buildingSnapshot.BuildingType}");
                    return;
                }

                buildingView = Instantiate(prefab, _buildingsParent);
                buildingView.name = $"Building_{buildingSnapshot.BuildingId}";

                BuildingData buildingData = new BuildingData
                {
                    BuildingId = buildingSnapshot.BuildingId,
                    BuildingType = buildingSnapshot.BuildingType,
                    OwnerPlayerId = buildingSnapshot.OwnerPlayerId,
                    MaxHP = buildingSnapshot.MaxHP,
                    Position = buildingSnapshot.Position,
                    BuildCost = new PlayerResources(0, 0, 0, 0)
                };

                buildingView.Initialize(buildingData);
                buildingView.UpdateFromNetwork(
                    buildingSnapshot.CurrentHP,
                    buildingSnapshot.BuildProgress,
                    buildingSnapshot.State
                );

                buildingView.OnBuildingDestroyed += HandleBuildingDestroyed;

                _activeBuildings[buildingSnapshot.BuildingId] = buildingView;
                Debug.Log($"创建建筑: {buildingSnapshot.BuildingId}, 类型: {buildingSnapshot.BuildingType}");
            }
        }

        /// <summary>
        /// 移除单位
        /// </summary>
        /// <param name="unitId">单位ID</param>
        private void RemoveUnit(string unitId)
        {
            if (_activeUnits.TryGetValue(unitId, out UnitView unitView))
            {
                unitView.OnUnitDeath -= HandleUnitDeath;
                if (unitView.CurrentState != UnitState.Dead)
                {
                    unitView.PlayDeathAnimation();
                }
                _activeUnits.Remove(unitId);
                _predictedStates.Remove(unitId);
                Debug.Log($"移除单位: {unitId}");
            }
        }

        /// <summary>
        /// 移除建筑
        /// </summary>
        /// <param name="buildingId">建筑ID</param>
        private void RemoveBuilding(string buildingId)
        {
            if (_activeBuildings.TryGetValue(buildingId, out BuildingView buildingView))
            {
                buildingView.OnBuildingDestroyed -= HandleBuildingDestroyed;
                if (buildingView.CurrentState != BuildingState.Destroyed)
                {
                    buildingView.PlayDestroyAnimation();
                }
                _activeBuildings.Remove(buildingId);
                Debug.Log($"移除建筑: {buildingId}");
            }
        }

        /// <summary>
        /// 检查并移除不在快照中的实体
        /// </summary>
        private void CheckForRemovedEntities()
        {
            if (_nextSnapshot == null) return;

            List<string> unitsToRemove = new List<string>();
            foreach (var unitId in _activeUnits.Keys)
            {
                if (!_nextSnapshot.Units.ContainsKey(unitId))
                {
                    unitsToRemove.Add(unitId);
                }
            }

            foreach (var unitId in unitsToRemove)
            {
                RemoveUnit(unitId);
            }

            List<string> buildingsToRemove = new List<string>();
            foreach (var buildingId in _activeBuildings.Keys)
            {
                if (!_nextSnapshot.Buildings.ContainsKey(buildingId))
                {
                    buildingsToRemove.Add(buildingId);
                }
            }

            foreach (var buildingId in buildingsToRemove)
            {
                RemoveBuilding(buildingId);
            }
        }

        /// <summary>
        /// 处理单位死亡
        /// </summary>
        /// <param name="unitView">单位视图</param>
        private void HandleUnitDeath(UnitView unitView)
        {
            if (_activeUnits.ContainsKey(unitView.UnitData.UnitId))
            {
                _predictedStates.Remove(unitView.UnitData.UnitId);
            }
        }

        /// <summary>
        /// 处理建筑摧毁
        /// </summary>
        /// <param name="buildingView">建筑视图</param>
        private void HandleBuildingDestroyed(BuildingView buildingView)
        {
        }

        /// <summary>
        /// 清除所有实体
        /// </summary>
        private void ClearAllEntities()
        {
            foreach (var unitView in _activeUnits.Values)
            {
                if (unitView != null)
                {
                    unitView.OnUnitDeath -= HandleUnitDeath;
                    Destroy(unitView.gameObject);
                }
            }

            foreach (var buildingView in _activeBuildings.Values)
            {
                if (buildingView != null)
                {
                    buildingView.OnBuildingDestroyed -= HandleBuildingDestroyed;
                    Destroy(buildingView.gameObject);
                }
            }

            _activeUnits.Clear();
            _activeBuildings.Clear();
            _predictedStates.Clear();
            Debug.Log("已清除所有实体");
        }

        /// <summary>
        /// 更新游戏阶段
        /// </summary>
        /// <param name="phase">新阶段</param>
        private void UpdateGamePhase(GamePhase phase)
        {
            switch (phase)
            {
                case GamePhase.Planning:
                    if (GameManager.Instance.CurrentPhase != GamePhase.Planning)
                    {
                        GameManager.Instance.StartPlanningPhase();
                    }
                    break;
                case GamePhase.Simulating:
                    if (GameManager.Instance.CurrentPhase != GamePhase.Simulating)
                    {
                        GameManager.Instance.StartSimulatingPhase();
                    }
                    break;
                case GamePhase.GameOver:
                    if (GameManager.Instance.CurrentPhase != GamePhase.GameOver)
                    {
                        GameManager.Instance.EndGame(0);
                    }
                    break;
            }
        }

        /// <summary>
        /// 更新当前回合
        /// </summary>
        /// <param name="round">新回合数</param>
        private void UpdateCurrentRound(int round)
        {
            if (GameManager.Instance.CurrentRound != round)
            {
                Debug.Log($"回合更新: {GameManager.Instance.CurrentRound} -> {round}");
            }
        }

        /// <summary>
        /// 更新玩家资源
        /// </summary>
        /// <param name="snapshot">状态快照</param>
        private void UpdatePlayerResources(GameStateSnapshot snapshot)
        {
            PlayerResources resources = _localPlayerId == 1 ? snapshot.Player1Resources : snapshot.Player2Resources;
            if (resources != null)
            {
                PlayerResources delta = new PlayerResources(
                    resources.Gold - GameManager.Instance.PlayerResources.Gold,
                    resources.Food - GameManager.Instance.PlayerResources.Food,
                    resources.Wood - GameManager.Instance.PlayerResources.Wood,
                    resources.Stone - GameManager.Instance.PlayerResources.Stone
                );
                GameManager.Instance.UpdateResources(delta);
            }
        }

        /// <summary>
        /// 请求完整状态
        /// </summary>
        private void RequestFullState()
        {
            Debug.LogWarning("状态不同步，请求完整状态...");
        }

        /// <summary>
        /// 获取单位预制体
        /// </summary>
        /// <param name="type">单位类型</param>
        /// <returns>单位预制体</returns>
        private UnitView GetUnitPrefab(UnitType type)
        {
            if (_unitPrefabs.TryGetValue(type, out UnitView prefab))
            {
                return prefab;
            }
            return _unitPrefab;
        }

        /// <summary>
        /// 获取建筑预制体
        /// </summary>
        /// <param name="type">建筑类型</param>
        /// <returns>建筑预制体</returns>
        private BuildingView GetBuildingPrefab(BuildingType type)
        {
            if (_buildingPrefabs.TryGetValue(type, out BuildingView prefab))
            {
                return prefab;
            }
            return _buildingPrefab;
        }

        /// <summary>
        /// 获取单位视图
        /// </summary>
        /// <param name="unitId">单位ID</param>
        /// <returns>单位视图</returns>
        public UnitView GetUnit(string unitId)
        {
            _activeUnits.TryGetValue(unitId, out UnitView unitView);
            return unitView;
        }

        /// <summary>
        /// 获取建筑视图
        /// </summary>
        /// <param name="buildingId">建筑ID</param>
        /// <returns>建筑视图</returns>
        public BuildingView GetBuilding(string buildingId)
        {
            _activeBuildings.TryGetValue(buildingId, out BuildingView buildingView);
            return buildingView;
        }

        /// <summary>
        /// 获取所有单位
        /// </summary>
        /// <returns>单位枚举</returns>
        public IEnumerable<UnitView> GetAllUnits()
        {
            return _activeUnits.Values;
        }

        /// <summary>
        /// 获取本地玩家可控单位
        /// </summary>
        /// <returns>可控单位枚举</returns>
        public IEnumerable<UnitView> GetMyUnits()
        {
            foreach (var kvp in _activeUnits)
            {
                if (kvp.Value.UnitData != null && kvp.Value.UnitData.OwnerPlayerId == _localPlayerId)
                {
                    yield return kvp.Value;
                }
            }
        }

        /// <summary>
        /// 获取本地玩家可控建筑
        /// </summary>
        /// <returns>可控建筑枚举</returns>
        public IEnumerable<BuildingView> GetMyBuildings()
        {
            foreach (var kvp in _activeBuildings)
            {
                if (kvp.Value.BuildingData != null && kvp.Value.BuildingData.OwnerPlayerId == _localPlayerId)
                {
                    yield return kvp.Value;
                }
            }
        }

        /// <summary>
        /// 获取所有建筑
        /// </summary>
        /// <returns>建筑枚举</returns>
        public IEnumerable<BuildingView> GetAllBuildings()
        {
            return _activeBuildings.Values;
        }

        /// <summary>
        /// 重置同步器
        /// </summary>
        public void Reset()
        {
            StopPlayback();
            ClearAllEntities();
            _snapshotBuffer.Clear();
            _previousSnapshot = null;
            _nextSnapshot = null;
            _interpolationTimer = 0f;
            _lastProcessedFrame = 0;
            Debug.Log("状态同步器已重置");
        }

        private void OnDestroy()
        {
            if (_instance == this)
            {
                _instance = null;
            }
        }
    }

    /// <summary>
    /// 循环缓冲区
    /// </summary>
    /// <typeparam name="T">元素类型</typeparam>
    public class CircularBuffer<T>
    {
        private readonly T[] _buffer;
        private int _head;
        private int _tail;
        private int _count;

        /// <summary>
        /// 缓冲区容量
        /// </summary>
        public int Capacity => _buffer.Length;

        /// <summary>
        /// 当前元素数量
        /// </summary>
        public int Count => _count;

        /// <summary>
        /// 构造函数
        /// </summary>
        /// <param name="capacity">容量</param>
        public CircularBuffer(int capacity)
        {
            if (capacity <= 0)
            {
                throw new ArgumentException("容量必须大于0", nameof(capacity));
            }

            _buffer = new T[capacity];
            _head = 0;
            _tail = 0;
            _count = 0;
        }

        /// <summary>
        /// 添加元素
        /// </summary>
        /// <param name="item">元素</param>
        public void Add(T item)
        {
            if (_count == Capacity)
            {
                _buffer[_head] = item;
                _head = (_head + 1) % Capacity;
                _tail = (_tail + 1) % Capacity;
            }
            else
            {
                _buffer[_tail] = item;
                _tail = (_tail + 1) % Capacity;
                _count++;
            }
        }

        /// <summary>
        /// 移除指定索引处的元素
        /// </summary>
        /// <param name="index">索引</param>
        public void RemoveAt(int index)
        {
            if (index < 0 || index >= _count)
            {
                throw new ArgumentOutOfRangeException(nameof(index));
            }

            int actualIndex = (_head + index) % Capacity;

            for (int i = index; i < _count - 1; i++)
            {
                int current = (_head + i) % Capacity;
                int next = (_head + i + 1) % Capacity;
                _buffer[current] = _buffer[next];
            }

            _count--;
            _tail = (_tail - 1 + Capacity) % Capacity;
        }

        /// <summary>
        /// 清空缓冲区
        /// </summary>
        public void Clear()
        {
            Array.Clear(_buffer, 0, _buffer.Length);
            _head = 0;
            _tail = 0;
            _count = 0;
        }

        /// <summary>
        /// 索引器
        /// </summary>
        /// <param name="index">索引</param>
        /// <returns>元素</returns>
        public T this[int index]
        {
            get
            {
                if (index < 0 || index >= _count)
                {
                    throw new ArgumentOutOfRangeException(nameof(index));
                }

                int actualIndex = (_head + index) % Capacity;
                return _buffer[actualIndex];
            }
        }
    }
}
