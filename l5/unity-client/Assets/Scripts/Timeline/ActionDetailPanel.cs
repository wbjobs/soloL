using System;
using UnityEngine;
using UnityEngine.UI;
using Protocol;

namespace Timeline
{
    /// <summary>
    /// 操作详情编辑面板
    /// 用于显示和编辑选中操作点的详细信息
    /// </summary>
    public class ActionDetailPanel : MonoBehaviour
    {
        [Header("UI引用 - 通用")]
        [SerializeField] private Text _actionTypeLabel;
        [SerializeField] private Text _executeTimeLabel;
        [SerializeField] private InputField _unitIdInputField;
        [SerializeField] private InputField _targetIdInputField;
        [SerializeField] private Dropdown _buildingTypeDropdown;

        [Header("UI引用 - 目标位置")]
        [SerializeField] private InputField _targetPosXInputField;
        [SerializeField] private InputField _targetPosYInputField;

        [Header("UI引用 - 按钮")]
        [SerializeField] private Button _deleteButton;
        [SerializeField] private Button _confirmButton;
        [SerializeField] private Button _cancelButton;

        [Header("UI引用 - 面板")]
        [SerializeField] private GameObject _movePanel;
        [SerializeField] private GameObject _attackPanel;
        [SerializeField] private GameObject _buildPanel;

        [Header("颜色配置")]
        [SerializeField] private Color _moveColor = new(0.2f, 0.8f, 0.2f, 1f);
        [SerializeField] private Color _attackColor = new(0.8f, 0.2f, 0.2f, 1f);
        [SerializeField] private Color _buildColor = new(0.2f, 0.4f, 0.8f, 1f);

        [SerializeField] private Image _panelBackground;
        [SerializeField] private Image _headerBackground;

        private ActionData _currentActionData;
        private bool _isEditing;

        /// <summary>
        /// 当前正在编辑的操作数据
        /// </summary>
        public ActionData CurrentActionData => _currentActionData;

        /// <summary>
        /// 是否正在编辑
        /// </summary>
        public bool IsEditing => _isEditing;

        /// <summary>
        /// 删除按钮点击事件
        /// </summary>
        public event Action OnDeleteClicked;

        /// <summary>
        /// 确认修改按钮点击事件
        /// </summary>
        public event Action<ActionData> OnConfirmClicked;

        /// <summary>
        /// 取消按钮点击事件
        /// </summary>
        public event Action OnCancelClicked;

        /// <summary>
        /// 初始化
        /// </summary>
        private void Awake()
        {
            ValidateReferences();
            RegisterButtonEvents();
            InitializeBuildingTypeDropdown();
            Hide();
        }

        /// <summary>
        /// 验证所有必要的引用
        /// </summary>
        private void ValidateReferences()
        {
            if (_actionTypeLabel == null)
            {
                Debug.LogError("[ActionDetailPanel] 操作类型标签引用未设置");
            }

            if (_executeTimeLabel == null)
            {
                Debug.LogError("[ActionDetailPanel] 执行时间标签引用未设置");
            }

            if (_deleteButton == null)
            {
                Debug.LogError("[ActionDetailPanel] 删除按钮引用未设置");
            }

            if (_confirmButton == null)
            {
                Debug.LogError("[ActionDetailPanel] 确认按钮引用未设置");
            }

            if (_cancelButton == null)
            {
                Debug.LogError("[ActionDetailPanel] 取消按钮引用未设置");
            }
        }

        /// <summary>
        /// 注册按钮点击事件
        /// </summary>
        private void RegisterButtonEvents()
        {
            if (_deleteButton != null)
            {
                _deleteButton.onClick.AddListener(HandleDeleteClicked);
            }

            if (_confirmButton != null)
            {
                _confirmButton.onClick.AddListener(HandleConfirmClicked);
            }

            if (_cancelButton != null)
            {
                _cancelButton.onClick.AddListener(HandleCancelClicked);
            }
        }

        /// <summary>
        /// 初始化建筑类型下拉菜单
        /// </summary>
        private void InitializeBuildingTypeDropdown()
        {
            if (_buildingTypeDropdown == null)
            {
                return;
            }

            _buildingTypeDropdown.options.Clear();

            Array buildingTypes = Enum.GetValues(typeof(BuildingType));
            foreach (BuildingType type in buildingTypes)
            {
                _buildingTypeDropdown.options.Add(
                    new Dropdown.OptionData(GetBuildingTypeName(type))
                );
            }

            _buildingTypeDropdown.RefreshShownValue();
        }

        /// <summary>
        /// 显示操作详情面板
        /// </summary>
        /// <param name="actionData">要显示的操作数据</param>
        public void Show(ActionData actionData)
        {
            if (actionData == null)
            {
                Hide();
                return;
            }

            _currentActionData = CloneActionData(actionData);
            _isEditing = true;

            gameObject.SetActive(true);

            UpdatePanelUI();
            UpdatePanelVisibility();
            UpdatePanelColor();

            Debug.Log($"[ActionDetailPanel] 显示操作详情: {actionData.Type}");
        }

        /// <summary>
        /// 隐藏操作详情面板
        /// </summary>
        public void Hide()
        {
            _currentActionData = null;
            _isEditing = false;
            gameObject.SetActive(false);

            OnCancelClicked?.Invoke();
        }

        /// <summary>
        /// 更新面板UI显示
        /// </summary>
        private void UpdatePanelUI()
        {
            if (_currentActionData == null)
            {
                return;
            }

            if (_actionTypeLabel != null)
            {
                _actionTypeLabel.text = GetActionTypeName(_currentActionData.Type);
            }

            if (_executeTimeLabel != null)
            {
                _executeTimeLabel.text = $"执行时间: {_currentActionData.ExecuteTimeSeconds:F1}s";
            }

            if (_unitIdInputField != null)
            {
                _unitIdInputField.text = _currentActionData.UnitID ?? string.Empty;
            }

            if (_targetIdInputField != null)
            {
                _targetIdInputField.text = _currentActionData.TargetID ?? string.Empty;
            }

            if (_targetPosXInputField != null && _currentActionData.TargetPos != null)
            {
                _targetPosXInputField.text = _currentActionData.TargetPos.X.ToString();
            }

            if (_targetPosYInputField != null && _currentActionData.TargetPos != null)
            {
                _targetPosYInputField.text = _currentActionData.TargetPos.Y.ToString();
            }

            if (_buildingTypeDropdown != null)
            {
                _buildingTypeDropdown.value = (int)_currentActionData.BuildingType - 1;
            }
        }

        /// <summary>
        /// 根据操作类型更新子面板可见性
        /// </summary>
        private void UpdatePanelVisibility()
        {
            if (_currentActionData == null)
            {
                return;
            }

            if (_movePanel != null)
            {
                _movePanel.SetActive(_currentActionData.Type == ActionType.ActionMove);
            }

            if (_attackPanel != null)
            {
                _attackPanel.SetActive(_currentActionData.Type == ActionType.ActionAttack);
            }

            if (_buildPanel != null)
            {
                _buildPanel.SetActive(_currentActionData.Type == ActionType.ActionBuild);
            }
        }

        /// <summary>
        /// 根据操作类型更新面板颜色
        /// </summary>
        private void UpdatePanelColor()
        {
            if (_currentActionData == null)
            {
                return;
            }

            Color color = GetColorForActionType(_currentActionData.Type);

            if (_headerBackground != null)
            {
                _headerBackground.color = color;
            }

            if (_panelBackground != null)
            {
                Color bgColor = color;
                bgColor.a = 0.1f;
                _panelBackground.color = bgColor;
            }
        }

        /// <summary>
        /// 从UI收集修改后的数据
        /// </summary>
        /// <returns>修改后的操作数据</returns>
        private ActionData CollectModifiedData()
        {
            if (_currentActionData == null)
            {
                return null;
            }

            ActionData modifiedData = CloneActionData(_currentActionData);

            if (_unitIdInputField != null)
            {
                modifiedData.UnitID = _unitIdInputField.text;
            }

            if (_targetIdInputField != null)
            {
                modifiedData.TargetID = _targetIdInputField.text;
            }

            if (_targetPosXInputField != null &&
                _targetPosYInputField != null)
            {
                if (int.TryParse(_targetPosXInputField.text, out int x) &&
                    int.TryParse(_targetPosYInputField.text, out int y))
                {
                    modifiedData.TargetPos = new Position { X = x, Y = y };
                }
            }

            if (_buildingTypeDropdown != null)
            {
                modifiedData.BuildingType = (BuildingType)(_buildingTypeDropdown.value + 1);
            }

            return modifiedData;
        }

        /// <summary>
        /// 克隆操作数据
        /// </summary>
        /// <param name="original">原始数据</param>
        /// <returns>克隆的数据</returns>
        private ActionData CloneActionData(ActionData original)
        {
            if (original == null)
            {
                return null;
            }

            return new ActionData
            {
                ID = original.ID,
                Type = original.Type,
                UnitID = original.UnitID,
                TargetPos = original.TargetPos != null
                    ? new Position { X = original.TargetPos.X, Y = original.TargetPos.Y }
                    : null,
                TargetID = original.TargetID,
                BuildingType = original.BuildingType,
                ExecuteTime = original.ExecuteTime
            };
        }

        /// <summary>
        /// 处理删除按钮点击
        /// </summary>
        private void HandleDeleteClicked()
        {
            OnDeleteClicked?.Invoke();
            Hide();
        }

        /// <summary>
        /// 处理确认按钮点击
        /// </summary>
        private void HandleConfirmClicked()
        {
            ActionData modifiedData = CollectModifiedData();
            if (modifiedData != null)
            {
                OnConfirmClicked?.Invoke(modifiedData);
            }
            Hide();
        }

        /// <summary>
        /// 处理取消按钮点击
        /// </summary>
        private void HandleCancelClicked()
        {
            Hide();
        }

        /// <summary>
        /// 获取操作类型名称
        /// </summary>
        /// <param name="actionType">操作类型</param>
        /// <returns>操作类型名称</returns>
        private string GetActionTypeName(ActionType actionType)
        {
            return actionType switch
            {
                ActionType.ActionMove => "移动",
                ActionType.ActionAttack => "攻击",
                ActionType.ActionBuild => "建造",
                _ => "未知"
            };
        }

        /// <summary>
        /// 获取建筑类型名称
        /// </summary>
        /// <param name="buildingType">建筑类型</param>
        /// <returns>建筑类型名称</returns>
        private string GetBuildingTypeName(BuildingType buildingType)
        {
            return buildingType switch
            {
                BuildingType.BuildingBase => "基地",
                BuildingType.BuildingTurret => "炮塔",
                BuildingType.BuildingBarracks => "兵营",
                _ => "未知"
            };
        }

        /// <summary>
        /// 获取操作类型对应的颜色
        /// </summary>
        /// <param name="actionType">操作类型</param>
        /// <returns>对应的颜色</returns>
        private Color GetColorForActionType(ActionType actionType)
        {
            return actionType switch
            {
                ActionType.ActionMove => _moveColor,
                ActionType.ActionAttack => _attackColor,
                ActionType.ActionBuild => _buildColor,
                _ => Color.gray
            };
        }

        /// <summary>
        /// 设置面板是否可交互
        /// </summary>
        /// <param name="interactable">是否可交互</param>
        public void SetInteractable(bool interactable)
        {
            if (_unitIdInputField != null)
            {
                _unitIdInputField.interactable = interactable;
            }

            if (_targetIdInputField != null)
            {
                _targetIdInputField.interactable = interactable;
            }

            if (_targetPosXInputField != null)
            {
                _targetPosXInputField.interactable = interactable;
            }

            if (_targetPosYInputField != null)
            {
                _targetPosYInputField.interactable = interactable;
            }

            if (_buildingTypeDropdown != null)
            {
                _buildingTypeDropdown.interactable = interactable;
            }

            if (_deleteButton != null)
            {
                _deleteButton.interactable = interactable;
            }

            if (_confirmButton != null)
            {
                _confirmButton.interactable = interactable;
            }

            if (_cancelButton != null)
            {
                _cancelButton.interactable = interactable;
            }
        }

        /// <summary>
        /// 销毁时清理事件
        /// </summary>
        private void OnDestroy()
        {
            if (_deleteButton != null)
            {
                _deleteButton.onClick.RemoveAllListeners();
            }

            if (_confirmButton != null)
            {
                _confirmButton.onClick.RemoveAllListeners();
            }

            if (_cancelButton != null)
            {
                _cancelButton.onClick.RemoveAllListeners();
            }

            OnDeleteClicked = null;
            OnConfirmClicked = null;
            OnCancelClicked = null;
        }
    }
}
