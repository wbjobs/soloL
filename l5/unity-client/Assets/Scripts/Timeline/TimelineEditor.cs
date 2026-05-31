using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using Protocol;
using Network;

namespace Timeline
{
    /// <summary>
    /// 时间轴编辑器主控制器
    /// 负责管理时间轴UI、操作点、以及与服务器的通信
    /// </summary>
    [RequireComponent(typeof(RectTransform))]
    public class TimelineEditor : MonoBehaviour
    {
        [Header("时间轴配置")]
        [SerializeField] private float _totalDuration = 5f;
        [SerializeField] private float _tickInterval = 0.5f;
        [SerializeField] private float _snapInterval = 0.1f;

        [Header("UI引用")]
        [SerializeField] private TimelineTrack _timelineTrack;
        [SerializeField] private ActionTypePanel _actionTypePanel;
        [SerializeField] private ActionDetailPanel _actionDetailPanel;
        [SerializeField] private Button _submitButton;
        [SerializeField] private RectTransform _actionPointsContainer;

        [Header("预制体")]
        [SerializeField] private TimelineActionPoint _actionPointPrefab;

        [Header("网络配置")]
        [SerializeField] private string _playerId;
        [SerializeField] private string _roomId;

        private TimelineData _currentTimeline;
        private readonly List<TimelineActionPoint> _actionPoints = new();
        private TimelineActionPoint _selectedActionPoint;
        private ActionType? _selectedActionType;

        /// <summary>
        /// 当前编辑的时间线数据
        /// </summary>
        public TimelineData CurrentTimeline => _currentTimeline;

        /// <summary>
        /// 当前选中的操作点
        /// </summary>
        public TimelineActionPoint SelectedAction => _selectedActionPoint;

        /// <summary>
        /// 当前选中的操作类型（用于添加新操作）
        /// </summary>
        public ActionType? SelectedActionType => _selectedActionType;

        /// <summary>
        /// 时间轴总时长（秒）
        /// </summary>
        public float TotalDuration => _totalDuration;

        /// <summary>
        /// 吸附间隔（秒）
        /// </summary>
        public float SnapInterval => _snapInterval;

        /// <summary>
        /// 操作点容器
        /// </summary>
        public RectTransform ActionPointsContainer => _actionPointsContainer;

        /// <summary>
        /// 时间轴轨道引用
        /// </summary>
        public TimelineTrack Track => _timelineTrack;

        /// <summary>
        /// 时间轴提交成功事件
        /// </summary>
        public event Action<TimelineData> OnTimelineSubmitted;

        /// <summary>
        /// 操作点选中变化事件
        /// </summary>
        public event Action<TimelineActionPoint> OnSelectedActionChanged;

        /// <summary>
        /// 时间轴数据变化事件
        /// </summary>
        public event Action OnTimelineChanged;

        /// <summary>
        /// 初始化时间轴编辑器
        /// </summary>
        private void Awake()
        {
            InitializeTimelineData();
            ValidateReferences();
        }

        /// <summary>
        /// 启动时注册事件
        /// </summary>
        private void Start()
        {
            RegisterEventHandlers();
            UpdateSubmitButtonState();
        }

        /// <summary>
        /// 销毁时清理事件
        /// </summary>
        private void OnDestroy()
        {
            UnregisterEventHandlers();
        }

        /// <summary>
        /// 初始化时间线数据
        /// </summary>
        private void InitializeTimelineData()
        {
            _currentTimeline = new TimelineData
            {
                Actions = new List<ActionData>()
            };
        }

        /// <summary>
        /// 验证所有必要的引用
        /// </summary>
        private void ValidateReferences()
        {
            if (_timelineTrack == null)
            {
                Debug.LogError("[TimelineEditor] 时间轴轨道引用未设置");
            }

            if (_actionTypePanel == null)
            {
                Debug.LogError("[TimelineEditor] 操作类型面板引用未设置");
            }

            if (_actionDetailPanel == null)
            {
                Debug.LogError("[TimelineEditor] 操作详情面板引用未设置");
            }

            if (_submitButton == null)
            {
                Debug.LogError("[TimelineEditor] 提交按钮引用未设置");
            }

            if (_actionPointsContainer == null)
            {
                Debug.LogError("[TimelineEditor] 操作点容器引用未设置");
            }

            if (_actionPointPrefab == null)
            {
                Debug.LogError("[TimelineEditor] 操作点预制体引用未设置");
            }
        }

        /// <summary>
        /// 注册所有事件处理器
        /// </summary>
        private void RegisterEventHandlers()
        {
            if (_actionTypePanel != null)
            {
                _actionTypePanel.OnActionTypeSelected += HandleActionTypeSelected;
            }

            if (_submitButton != null)
            {
                _submitButton.onClick.AddListener(HandleSubmitClicked);
            }

            if (_timelineTrack != null)
            {
                _timelineTrack.OnTrackClicked += HandleTrackClicked;
            }

            if (_actionDetailPanel != null)
            {
                _actionDetailPanel.OnDeleteClicked += HandleDeleteAction;
                _actionDetailPanel.OnConfirmClicked += HandleConfirmActionChanges;
            }

            NetworkManager.Instance?.RegisterHandler<TimelineSubmitResponse>(
                Constants.MsgTypeTimelineAck,
                HandleTimelineAck
            );
        }

        /// <summary>
        /// 取消注册所有事件处理器
        /// </summary>
        private void UnregisterEventHandlers()
        {
            if (_actionTypePanel != null)
            {
                _actionTypePanel.OnActionTypeSelected -= HandleActionTypeSelected;
            }

            if (_submitButton != null)
            {
                _submitButton.onClick.RemoveListener(HandleSubmitClicked);
            }

            if (_timelineTrack != null)
            {
                _timelineTrack.OnTrackClicked -= HandleTrackClicked;
            }

            if (_actionDetailPanel != null)
            {
                _actionDetailPanel.OnDeleteClicked -= HandleDeleteAction;
                _actionDetailPanel.OnConfirmClicked -= HandleConfirmActionChanges;
            }

            foreach (TimelineActionPoint point in _actionPoints)
            {
                if (point != null)
                {
                    point.OnActionClicked -= HandleActionPointClicked;
                    point.OnActionDragged -= HandleActionPointDragged;
                }
            }

            NetworkManager.Instance?.UnregisterHandler(Constants.MsgTypeTimelineAck);
        }

        /// <summary>
        /// 添加操作点
        /// </summary>
        /// <param name="actionType">操作类型</param>
        /// <param name="time">执行时间（秒）</param>
        /// <returns>创建的操作点</returns>
        public TimelineActionPoint AddAction(ActionType actionType, float time)
        {
            float snappedTime = SnapTimeToInterval(time);

            if (snappedTime < 0 || snappedTime > _totalDuration)
            {
                Debug.LogWarning($"[TimelineEditor] 时间 {snappedTime} 超出有效范围 [0, {_totalDuration}]");
                return null;
            }

            ActionData actionData = new()
            {
                ID = Guid.NewGuid().ToString(),
                Type = actionType,
                ExecuteTime = (long)(snappedTime * 1000),
                TargetPos = new Position { X = 0, Y = 0 }
            };

            _currentTimeline.Actions.Add(actionData);

            TimelineActionPoint actionPoint = CreateActionPointUI(actionData);
            _actionPoints.Add(actionPoint);

            SelectAction(actionPoint);
            UpdateSubmitButtonState();
            OnTimelineChanged?.Invoke();

            return actionPoint;
        }

        /// <summary>
        /// 删除操作点
        /// </summary>
        /// <param name="actionPoint">要删除的操作点</param>
        public void RemoveAction(TimelineActionPoint actionPoint)
        {
            if (actionPoint == null)
            {
                return;
            }

            if (_selectedActionPoint == actionPoint)
            {
                DeselectAction();
            }

            _ = _currentTimeline.Actions.Remove(actionPoint.ActionData);
            _ = _actionPoints.Remove(actionPoint);

            actionPoint.OnActionClicked -= HandleActionPointClicked;
            actionPoint.OnActionDragged -= HandleActionPointDragged;

            Destroy(actionPoint.gameObject);

            UpdateSubmitButtonState();
            OnTimelineChanged?.Invoke();
        }

        /// <summary>
        /// 选中操作点
        /// </summary>
        /// <param name="actionPoint">要选中的操作点</param>
        public void SelectAction(TimelineActionPoint actionPoint)
        {
            if (_selectedActionPoint != null)
            {
                _selectedActionPoint.SetSelected(false);
            }

            _selectedActionPoint = actionPoint;
            _selectedActionPoint?.SetSelected(true);

            _actionDetailPanel?.Show(actionPoint?.ActionData);
            OnSelectedActionChanged?.Invoke(_selectedActionPoint);
        }

        /// <summary>
        /// 取消选中
        /// </summary>
        public void DeselectAction()
        {
            if (_selectedActionPoint != null)
            {
                _selectedActionPoint.SetSelected(false);
                _selectedActionPoint = null;
            }

            _actionDetailPanel?.Hide();
            OnSelectedActionChanged?.Invoke(null);
        }

        /// <summary>
        /// 设置玩家ID和房间ID
        /// </summary>
        /// <param name="playerId">玩家ID</param>
        /// <param name="roomId">房间ID</param>
        public void SetNetworkIds(string playerId, string roomId)
        {
            _playerId = playerId;
            _roomId = roomId;
        }

        /// <summary>
        /// 提交时间线到服务器
        /// </summary>
        public void SubmitTimeline()
        {
            if (_currentTimeline.Actions.Count == 0)
            {
                Debug.LogWarning("[TimelineEditor] 时间线为空，无法提交");
                return;
            }

            if (string.IsNullOrEmpty(_playerId))
            {
                Debug.LogError("[TimelineEditor] 玩家ID未设置，无法提交时间线");
                return;
            }

            if (string.IsNullOrEmpty(_roomId))
            {
                Debug.LogError("[TimelineEditor] 房间ID未设置，无法提交时间线");
                return;
            }

            if (NetworkManager.Instance == null || !NetworkManager.Instance.IsConnected)
            {
                Debug.LogError("[TimelineEditor] 未连接到服务器，无法提交时间线");
                return;
            }

            try
            {
                Protocol.Timeline timeline = ConvertToProtocolTimeline();
                TimelineSubmitRequest request = new()
                {
                    PlayerID = _playerId,
                    RoomID = _roomId,
                    Timeline = timeline
                };

                NetworkManager.Instance.Send(Constants.MsgTypeSubmitTimeline, request);

                Debug.Log($"[TimelineEditor] 已提交时间线，包含 {timeline.Actions.Length} 个操作");
            }
            catch (Exception ex)
            {
                Debug.LogError($"[TimelineEditor] 提交时间线失败: {ex.Message}");
            }
        }

        /// <summary>
        /// 将内部时间线数据转换为协议格式
        /// </summary>
        /// <returns>协议格式的时间线</returns>
        private Protocol.Timeline ConvertToProtocolTimeline()
        {
            List<Protocol.Action> actions = new();

            foreach (ActionData actionData in _currentTimeline.Actions)
            {
                actions.Add(new Protocol.Action
                {
                    ID = actionData.ID,
                    Type = actionData.Type,
                    UnitID = actionData.UnitID,
                    TargetPos = actionData.TargetPos,
                    TargetID = actionData.TargetID,
                    BuildingType = actionData.BuildingType,
                    ExecuteTime = actionData.ExecuteTime
                });
            }

            return new Protocol.Timeline
            {
                Actions = actions.ToArray()
            };
        }

        /// <summary>
        /// 将时间吸附到刻度
        /// </summary>
        /// <param name="time">原始时间</param>
        /// <returns>吸附后的时间</returns>
        public float SnapTimeToInterval(float time)
        {
            return Mathf.Round(time / _snapInterval) * _snapInterval;
        }

        /// <summary>
        /// 创建操作点UI
        /// </summary>
        /// <param name="actionData">操作数据</param>
        /// <returns>创建的操作点</returns>
        private TimelineActionPoint CreateActionPointUI(ActionData actionData)
        {
            TimelineActionPoint actionPoint = Instantiate(
                _actionPointPrefab,
                _actionPointsContainer
            );

            actionPoint.Initialize(this, actionData);
            actionPoint.OnActionClicked += HandleActionPointClicked;
            actionPoint.OnActionDragged += HandleActionPointDragged;

            return actionPoint;
        }

        /// <summary>
        /// 更新提交按钮状态
        /// </summary>
        private void UpdateSubmitButtonState()
        {
            if (_submitButton != null)
            {
                _submitButton.interactable = _currentTimeline.Actions.Count > 0;
            }
        }

        /// <summary>
        /// 处理操作类型选择事件
        /// </summary>
        /// <param name="actionType">选中的操作类型</param>
        private void HandleActionTypeSelected(ActionType actionType)
        {
            _selectedActionType = actionType;
            Debug.Log($"[TimelineEditor] 选择操作类型: {actionType}");
        }

        /// <summary>
        /// 处理时间轴轨道点击事件
        /// </summary>
        /// <param name="clickTime">点击位置对应的时间</param>
        private void HandleTrackClicked(float clickTime)
        {
            if (_selectedActionType.HasValue)
            {
                _ = AddAction(_selectedActionType.Value, clickTime);
            }
        }

        /// <summary>
        /// 处理操作点点击事件
        /// </summary>
        /// <param name="actionPoint">被点击的操作点</param>
        private void HandleActionPointClicked(TimelineActionPoint actionPoint)
        {
            SelectAction(actionPoint);
        }

        /// <summary>
        /// 处理操作点拖拽事件
        /// </summary>
        /// <param name="actionPoint">被拖拽的操作点</param>
        private void HandleActionPointDragged(TimelineActionPoint actionPoint)
        {
            if (actionPoint == null)
            {
                return;
            }

            int index = _currentTimeline.Actions.FindIndex(
                a => a.ID == actionPoint.ActionData.ID
            );

            if (index >= 0)
            {
                _currentTimeline.Actions[index] = actionPoint.ActionData;
                OnTimelineChanged?.Invoke();
            }
        }

        /// <summary>
        /// 处理删除操作按钮点击
        /// </summary>
        private void HandleDeleteAction()
        {
            if (_selectedActionPoint != null)
            {
                RemoveAction(_selectedActionPoint);
            }
        }

        /// <summary>
        /// 处理确认修改按钮点击
        /// </summary>
        /// <param name="modifiedData">修改后的操作数据</param>
        private void HandleConfirmActionChanges(ActionData modifiedData)
        {
            if (_selectedActionPoint == null || modifiedData == null)
            {
                return;
            }

            _selectedActionPoint.UpdateActionData(modifiedData);

            int index = _currentTimeline.Actions.FindIndex(
                a => a.ID == modifiedData.ID
            );

            if (index >= 0)
            {
                _currentTimeline.Actions[index] = modifiedData;
                OnTimelineChanged?.Invoke();
            }

            DeselectAction();
        }

        /// <summary>
        /// 处理提交按钮点击
        /// </summary>
        private void HandleSubmitClicked()
        {
            SubmitTimeline();
        }

        /// <summary>
        /// 处理时间线提交确认
        /// </summary>
        /// <param name="response">确认消息</param>
        private void HandleTimelineAck(TimelineSubmitResponse response)
        {
            if (response.Success)
            {
                Debug.Log("[TimelineEditor] 时间线提交成功");
                OnTimelineSubmitted?.Invoke(_currentTimeline);
            }
            else
            {
                Debug.LogError($"[TimelineEditor] 时间线提交失败: {response.Message}");
            }
        }

        /// <summary>
        /// 清空时间轴
        /// </summary>
        public void ClearTimeline()
        {
            foreach (TimelineActionPoint point in _actionPoints)
            {
                if (point != null)
                {
                    point.OnActionClicked -= HandleActionPointClicked;
                    point.OnActionDragged -= HandleActionPointDragged;
                    Destroy(point.gameObject);
                }
            }

            _actionPoints.Clear();
            _currentTimeline.Actions.Clear();
            _selectedActionPoint = null;
            _selectedActionType = null;

            _actionTypePanel?.ClearSelection();
            _actionDetailPanel?.Hide();
            UpdateSubmitButtonState();
            OnTimelineChanged?.Invoke();
        }

        /// <summary>
        /// 从协议数据加载时间线
        /// </summary>
        /// <param name="timeline">协议格式的时间线</param>
        public void LoadTimeline(Protocol.Timeline timeline)
        {
            ClearTimeline();

            if (timeline?.Actions == null)
            {
                return;
            }

            foreach (Protocol.Action action in timeline.Actions)
            {
                ActionData actionData = new()
                {
                    ID = action.ID,
                    Type = action.Type,
                    UnitID = action.UnitID,
                    TargetPos = action.TargetPos,
                    TargetID = action.TargetID,
                    BuildingType = action.BuildingType,
                    ExecuteTime = action.ExecuteTime
                };

                _currentTimeline.Actions.Add(actionData);

                TimelineActionPoint actionPoint = CreateActionPointUI(actionData);
                _actionPoints.Add(actionPoint);
            }

            UpdateSubmitButtonState();
            OnTimelineChanged?.Invoke();
        }
    }

    /// <summary>
    /// 时间轴数据，存储当前编辑的时间线
    /// </summary>
    [Serializable]
    public class TimelineData
    {
        /// <summary>
        /// 操作列表
        /// </summary>
        public List<ActionData> Actions { get; set; } = new();
    }

    /// <summary>
    /// 操作数据，存储单个操作的详细信息
    /// </summary>
    [Serializable]
    public class ActionData
    {
        /// <summary>
        /// 操作ID
        /// </summary>
        public string ID { get; set; }

        /// <summary>
        /// 操作类型
        /// </summary>
        public ActionType Type { get; set; }

        /// <summary>
        /// 单位ID
        /// </summary>
        public string UnitID { get; set; }

        /// <summary>
        /// 目标位置
        /// </summary>
        public Position TargetPos { get; set; }

        /// <summary>
        /// 目标ID（攻击目标或建造目标）
        /// </summary>
        public string TargetID { get; set; }

        /// <summary>
        /// 建筑类型（仅建造操作使用）
        /// </summary>
        public BuildingType BuildingType { get; set; }

        /// <summary>
        /// 执行时间戳（毫秒）
        /// </summary>
        public long ExecuteTime { get; set; }

        /// <summary>
        /// 执行时间（秒）
        /// </summary>
        public float ExecuteTimeSeconds
        {
            get => ExecuteTime / 1000f;
            set => ExecuteTime = (long)(value * 1000);
        }
    }
}
