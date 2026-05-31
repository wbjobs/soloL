using System;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;
using Protocol;

namespace Timeline
{
    /// <summary>
    /// 时间轴操作点UI组件
    /// 负责显示单个操作点，处理拖拽、点击等交互
    /// </summary>
    [RequireComponent(typeof(RectTransform))]
    [RequireComponent(typeof(Image))]
    [RequireComponent(typeof(CanvasGroup))]
    public class TimelineActionPoint : MonoBehaviour,
        IPointerClickHandler,
        IBeginDragHandler,
        IDragHandler,
        IEndDragHandler
    {
        [Header("颜色配置")]
        [SerializeField] private Color _moveColor = new(0.2f, 0.8f, 0.2f, 1f);
        [SerializeField] private Color _attackColor = new(0.8f, 0.2f, 0.2f, 1f);
        [SerializeField] private Color _buildColor = new(0.2f, 0.4f, 0.8f, 1f);
        [SerializeField] private Color _selectedColor = new(1f, 0.8f, 0.2f, 1f);

        [Header("动画配置")]
        [SerializeField] private float _pulseSpeed = 2f;
        [SerializeField] private float _pulseMinScale = 0.9f;
        [SerializeField] private float _pulseMaxScale = 1.1f;
        [SerializeField] private float _dragAlpha = 0.7f;

        [Header("UI引用")]
        [SerializeField] private Image _backgroundImage;
        [SerializeField] private Text _timeLabel;
        [SerializeField] private GameObject _pulseEffect;

        private TimelineEditor _editor;
        private ActionData _actionData;
        private RectTransform _rectTransform;
        private CanvasGroup _canvasGroup;
        private Vector2 _dragOffset;
        private bool _isDragging;
        private bool _isSelected;
        private float _pulseTime;

        /// <summary>
        /// 操作数据
        /// </summary>
        public ActionData ActionData => _actionData;

        /// <summary>
        /// 是否正在拖拽
        /// </summary>
        public bool IsDragging => _isDragging;

        /// <summary>
        /// 是否被选中
        /// </summary>
        public bool IsSelected => _isSelected;

        /// <summary>
        /// 操作点被点击事件
        /// </summary>
        public event Action<TimelineActionPoint> OnActionClicked;

        /// <summary>
        /// 操作点被拖拽事件
        /// </summary>
        public event Action<TimelineActionPoint> OnActionDragged;

        /// <summary>
        /// 初始化操作点
        /// </summary>
        /// <param name="editor">时间轴编辑器引用</param>
        /// <param name="actionData">操作数据</param>
        public void Initialize(TimelineEditor editor, ActionData actionData)
        {
            _editor = editor;
            _actionData = actionData;

            _rectTransform = GetComponent<RectTransform>();
            _canvasGroup = GetComponent<CanvasGroup>();

            if (_backgroundImage == null)
            {
                _backgroundImage = GetComponent<Image>();
            }

            UpdateVisuals();
            UpdatePosition();
            StartPulseAnimation();
        }

        /// <summary>
        /// 更新操作数据
        /// </summary>
        /// <param name="newData">新的操作数据</param>
        public void UpdateActionData(ActionData newData)
        {
            if (newData == null)
            {
                return;
            }

            _actionData = newData;
            UpdateVisuals();
            UpdatePosition();
        }

        /// <summary>
        /// 设置选中状态
        /// </summary>
        /// <param name="selected">是否选中</param>
        public void SetSelected(bool selected)
        {
            _isSelected = selected;
            UpdateColor();

            if (_pulseEffect != null)
            {
                _pulseEffect.SetActive(selected);
            }
        }

        /// <summary>
        /// 更新视觉表现
        /// </summary>
        private void UpdateVisuals()
        {
            UpdateColor();
            UpdateTimeLabel();
        }

        /// <summary>
        /// 根据操作类型更新颜色
        /// </summary>
        private void UpdateColor()
        {
            if (_backgroundImage == null)
            {
                return;
            }

            if (_isSelected)
            {
                _backgroundImage.color = _selectedColor;
                return;
            }

            _backgroundImage.color = _actionData.Type switch
            {
                ActionType.ActionMove => _moveColor,
                ActionType.ActionAttack => _attackColor,
                ActionType.ActionBuild => _buildColor,
                _ => Color.gray
            };
        }

        /// <summary>
        /// 更新时间标签
        /// </summary>
        private void UpdateTimeLabel()
        {
            if (_timeLabel != null)
            {
                float time = _actionData.ExecuteTimeSeconds;
                _timeLabel.text = $"{time:F1}s";
            }
        }

        /// <summary>
        /// 更新位置
        /// </summary>
        private void UpdatePosition()
        {
            if (_editor == null || _rectTransform == null)
            {
                return;
            }

            float normalizedTime = _actionData.ExecuteTimeSeconds / _editor.TotalDuration;
            float xPosition = normalizedTime * _editor.ActionPointsContainer.rect.width;

            _rectTransform.anchoredPosition = new Vector2(
                xPosition - _rectTransform.rect.width * 0.5f,
                _rectTransform.anchoredPosition.y
            );
        }

        /// <summary>
        /// 启动脉冲动画
        /// </summary>
        private void StartPulseAnimation()
        {
            if (_pulseEffect != null)
            {
                _pulseEffect.SetActive(false);
            }
        }

        /// <summary>
        /// 每帧更新
        /// </summary>
        private void Update()
        {
            UpdatePulseAnimation();
        }

        /// <summary>
        /// 更新脉冲动画
        /// </summary>
        private void UpdatePulseAnimation()
        {
            if (_pulseEffect == null || !_pulseEffect.activeSelf)
            {
                return;
            }

            _pulseTime += Time.deltaTime * _pulseSpeed;
            float scale = Mathf.Lerp(
                _pulseMinScale,
                _pulseMaxScale,
                (Mathf.Sin(_pulseTime) + 1f) * 0.5f
            );

            _pulseEffect.transform.localScale = new Vector3(scale, scale, 1f);
        }

        /// <summary>
        /// 处理点击事件
        /// </summary>
        /// <param name="eventData">指针事件数据</param>
        public void OnPointerClick(PointerEventData eventData)
        {
            if (_isDragging)
            {
                return;
            }

            OnActionClicked?.Invoke(this);
        }

        /// <summary>
        /// 处理开始拖拽事件
        /// </summary>
        /// <param name="eventData">指针事件数据</param>
        public void OnBeginDrag(PointerEventData eventData)
        {
            _isDragging = true;

            if (_canvasGroup != null)
            {
                _canvasGroup.alpha = _dragAlpha;
                _canvasGroup.blocksRaycasts = false;
            }

            if (RectTransformUtility.ScreenPointToLocalPointInRectangle(
                _rectTransform,
                eventData.position,
                eventData.pressEventCamera,
                out Vector2 localPoint
            ))
            {
                _dragOffset = localPoint;
            }

            OnActionClicked?.Invoke(this);
        }

        /// <summary>
        /// 处理拖拽中事件
        /// </summary>
        /// <param name="eventData">指针事件数据</param>
        public void OnDrag(PointerEventData eventData)
        {
            if (!_isDragging || _editor == null || _editor.Track == null)
            {
                return;
            }

            if (RectTransformUtility.ScreenPointToLocalPointInRectangle(
                _editor.ActionPointsContainer,
                eventData.position,
                eventData.pressEventCamera,
                out Vector2 localPoint
            ))
            {
                float containerWidth = _editor.ActionPointsContainer.rect.width;
                float xPosition = Mathf.Clamp(
                    localPoint.x - _dragOffset.x,
                    0f,
                    containerWidth - _rectTransform.rect.width
                );

                float normalizedX = (xPosition + _rectTransform.rect.width * 0.5f) / containerWidth;
                float newTime = normalizedX * _editor.TotalDuration;
                float snappedTime = _editor.SnapTimeToInterval(newTime);

                _actionData.ExecuteTimeSeconds = snappedTime;
                UpdatePosition();
                UpdateTimeLabel();

                OnActionDragged?.Invoke(this);
            }
        }

        /// <summary>
        /// 处理结束拖拽事件
        /// </summary>
        /// <param name="eventData">指针事件数据</param>
        public void OnEndDrag(PointerEventData eventData)
        {
            _isDragging = false;

            if (_canvasGroup != null)
            {
                _canvasGroup.alpha = 1f;
                _canvasGroup.blocksRaycasts = true;
            }

            _dragOffset = Vector2.zero;
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
                ActionType.ActionMove => _moveColor,
                ActionType.ActionAttack => _attackColor,
                ActionType.ActionBuild => _buildColor,
                _ => Color.gray
            };
        }

        /// <summary>
        /// 销毁时清理
        /// </summary>
        private void OnDestroy()
        {
            OnActionClicked = null;
            OnActionDragged = null;
        }
    }
}
