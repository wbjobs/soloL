using System;
using UnityEngine;
using UnityEngine.UI;
using Protocol;

namespace Timeline
{
    /// <summary>
    /// 操作类型选择面板
    /// 提供移动、攻击、建造三种操作类型的选择按钮
    /// </summary>
    public class ActionTypePanel : MonoBehaviour
    {
        [Header("按钮引用")]
        [SerializeField] private Button _moveButton;
        [SerializeField] private Button _attackButton;
        [SerializeField] private Button _buildButton;

        [Header("按钮图像引用")]
        [SerializeField] private Image _moveButtonImage;
        [SerializeField] private Image _attackButtonImage;
        [SerializeField] private Image _buildButtonImage;

        [Header("颜色配置")]
        [SerializeField] private Color _moveNormalColor = new(0.3f, 0.3f, 0.3f, 1f);
        [SerializeField] private Color _attackNormalColor = new(0.3f, 0.3f, 0.3f, 1f);
        [SerializeField] private Color _buildNormalColor = new(0.3f, 0.3f, 0.3f, 1f);

        [SerializeField] private Color _moveSelectedColor = new(0.2f, 0.8f, 0.2f, 1f);
        [SerializeField] private Color _attackSelectedColor = new(0.8f, 0.2f, 0.2f, 1f);
        [SerializeField] private Color _buildSelectedColor = new(0.2f, 0.4f, 0.8f, 1f);

        [Header("按钮标签")]
        [SerializeField] private Text _moveButtonText;
        [SerializeField] private Text _attackButtonText;
        [SerializeField] private Text _buildButtonText;

        [SerializeField] private Color _normalTextColor = Color.white;
        [SerializeField] private Color _selectedTextColor = Color.white;

        private ActionType? _selectedType;

        /// <summary>
        /// 当前选中的操作类型
        /// </summary>
        public ActionType? SelectedType => _selectedType;

        /// <summary>
        /// 操作类型被选中事件
        /// </summary>
        public event Action<ActionType> OnActionTypeSelected;

        /// <summary>
        /// 初始化
        /// </summary>
        private void Awake()
        {
            ValidateReferences();
            RegisterButtonEvents();
            UpdateButtonVisuals();
        }

        /// <summary>
        /// 验证所有必要的引用
        /// </summary>
        private void ValidateReferences()
        {
            if (_moveButton == null)
            {
                Debug.LogError("[ActionTypePanel] 移动按钮引用未设置");
            }

            if (_attackButton == null)
            {
                Debug.LogError("[ActionTypePanel] 攻击按钮引用未设置");
            }

            if (_buildButton == null)
            {
                Debug.LogError("[ActionTypePanel] 建造按钮引用未设置");
            }

            if (_moveButtonImage == null && _moveButton != null)
            {
                _moveButtonImage = _moveButton.GetComponent<Image>();
            }

            if (_attackButtonImage == null && _attackButton != null)
            {
                _attackButtonImage = _attackButton.GetComponent<Image>();
            }

            if (_buildButtonImage == null && _buildButton != null)
            {
                _buildButtonImage = _buildButton.GetComponent<Image>();
            }
        }

        /// <summary>
        /// 注册按钮点击事件
        /// </summary>
        private void RegisterButtonEvents()
        {
            if (_moveButton != null)
            {
                _moveButton.onClick.AddListener(() => SelectActionType(ActionType.ActionMove));
            }

            if (_attackButton != null)
            {
                _attackButton.onClick.AddListener(() => SelectActionType(ActionType.ActionAttack));
            }

            if (_buildButton != null)
            {
                _buildButton.onClick.AddListener(() => SelectActionType(ActionType.ActionBuild));
            }
        }

        /// <summary>
        /// 选择操作类型
        /// </summary>
        /// <param name="actionType">要选择的操作类型</param>
        public void SelectActionType(ActionType actionType)
        {
            if (_selectedType == actionType)
            {
                ClearSelection();
                return;
            }

            _selectedType = actionType;
            UpdateButtonVisuals();
            OnActionTypeSelected?.Invoke(actionType);

            Debug.Log($"[ActionTypePanel] 选择操作类型: {actionType}");
        }

        /// <summary>
        /// 清除当前选择
        /// </summary>
        public void ClearSelection()
        {
            _selectedType = null;
            UpdateButtonVisuals();
            Debug.Log("[ActionTypePanel] 清除操作类型选择");
        }

        /// <summary>
        /// 更新所有按钮的视觉状态
        /// </summary>
        private void UpdateButtonVisuals()
        {
            UpdateMoveButtonVisual();
            UpdateAttackButtonVisual();
            UpdateBuildButtonVisual();
        }

        /// <summary>
        /// 更新移动按钮的视觉状态
        /// </summary>
        private void UpdateMoveButtonVisual()
        {
            if (_moveButtonImage != null)
            {
                _moveButtonImage.color = _selectedType == ActionType.ActionMove
                    ? _moveSelectedColor
                    : _moveNormalColor;
            }

            if (_moveButtonText != null)
            {
                _moveButtonText.color = _selectedType == ActionType.ActionMove
                    ? _selectedTextColor
                    : _normalTextColor;
            }
        }

        /// <summary>
        /// 更新攻击按钮的视觉状态
        /// </summary>
        private void UpdateAttackButtonVisual()
        {
            if (_attackButtonImage != null)
            {
                _attackButtonImage.color = _selectedType == ActionType.ActionAttack
                    ? _attackSelectedColor
                    : _attackNormalColor;
            }

            if (_attackButtonText != null)
            {
                _attackButtonText.color = _selectedType == ActionType.ActionAttack
                    ? _selectedTextColor
                    : _normalTextColor;
            }
        }

        /// <summary>
        /// 更新建造按钮的视觉状态
        /// </summary>
        private void UpdateBuildButtonVisual()
        {
            if (_buildButtonImage != null)
            {
                _buildButtonImage.color = _selectedType == ActionType.ActionBuild
                    ? _buildSelectedColor
                    : _buildNormalColor;
            }

            if (_buildButtonText != null)
            {
                _buildButtonText.color = _selectedType == ActionType.ActionBuild
                    ? _selectedTextColor
                    : _normalTextColor;
            }
        }

        /// <summary>
        /// 设置按钮是否可交互
        /// </summary>
        /// <param name="interactable">是否可交互</param>
        public void SetButtonsInteractable(bool interactable)
        {
            if (_moveButton != null)
            {
                _moveButton.interactable = interactable;
            }

            if (_attackButton != null)
            {
                _attackButton.interactable = interactable;
            }

            if (_buildButton != null)
            {
                _buildButton.interactable = interactable;
            }
        }

        /// <summary>
        /// 设置特定操作类型按钮是否可交互
        /// </summary>
        /// <param name="actionType">操作类型</param>
        /// <param name="interactable">是否可交互</param>
        public void SetButtonInteractable(ActionType actionType, bool interactable)
        {
            Button button = actionType switch
            {
                ActionType.ActionMove => _moveButton,
                ActionType.ActionAttack => _attackButton,
                ActionType.ActionBuild => _buildButton,
                _ => null
            };

            if (button != null)
            {
                button.interactable = interactable;
            }
        }

        /// <summary>
        /// 获取操作类型对应的颜色
        /// </summary>
        /// <param name="actionType">操作类型</param>
        /// <returns>对应的颜色</returns>
        public Color GetColorForActionType(ActionType actionType)
        {
            return actionType switch
            {
                ActionType.ActionMove => _moveSelectedColor,
                ActionType.ActionAttack => _attackSelectedColor,
                ActionType.ActionBuild => _buildSelectedColor,
                _ => Color.gray
            };
        }

        /// <summary>
        /// 获取操作类型的名称
        /// </summary>
        /// <param name="actionType">操作类型</param>
        /// <returns>操作类型名称</returns>
        public string GetNameForActionType(ActionType actionType)
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
        /// 销毁时清理事件
        /// </summary>
        private void OnDestroy()
        {
            if (_moveButton != null)
            {
                _moveButton.onClick.RemoveAllListeners();
            }

            if (_attackButton != null)
            {
                _attackButton.onClick.RemoveAllListeners();
            }

            if (_buildButton != null)
            {
                _buildButton.onClick.RemoveAllListeners();
            }

            OnActionTypeSelected = null;
        }
    }
}
