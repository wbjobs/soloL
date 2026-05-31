using System;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace Timeline
{
    /// <summary>
    /// 时间轴轨道组件
    /// 负责显示时间轴背景、网格线、刻度标记，并处理轨道点击事件
    /// </summary>
    [RequireComponent(typeof(RectTransform))]
    [RequireComponent(typeof(Image))]
    public class TimelineTrack : MonoBehaviour,
        IPointerClickHandler,
        IPointerDownHandler,
        IPointerUpHandler
    {
        [Header("时间轴配置")]
        [SerializeField] private float _totalDuration = 5f;
        [SerializeField] private float _majorTickInterval = 0.5f;
        [SerializeField] private float _minorTickInterval = 0.1f;
        [SerializeField] private float _snapInterval = 0.1f;

        [Header("刻度样式")]
        [SerializeField] private Color _majorTickColor = new(0.8f, 0.8f, 0.8f, 1f);
        [SerializeField] private Color _minorTickColor = new(0.5f, 0.5f, 0.5f, 0.5f);
        [SerializeField] private Color _gridLineColor = new(0.3f, 0.3f, 0.3f, 0.3f);
        [SerializeField] private Color _trackBackgroundColor = new(0.15f, 0.15f, 0.15f, 1f);

        [Header("刻度大小")]
        [SerializeField] private float _majorTickHeight = 20f;
        [SerializeField] private float _minorTickHeight = 10f;
        [SerializeField] private float _tickWidth = 2f;

        [Header("缩放配置")]
        [SerializeField] private bool _enableZoom = false;
        [SerializeField] private float _minZoom = 0.5f;
        [SerializeField] private float _maxZoom = 2f;
        [SerializeField] private float _zoomSpeed = 0.1f;

        [Header("UI引用")]
        [SerializeField] private RectTransform _tickContainer;
        [SerializeField] private RectTransform _gridContainer;
        [SerializeField] private Text[] _timeLabels;
        [SerializeField] private Image _backgroundImage;

        private RectTransform _rectTransform;
        private float _currentZoom = 1f;
        private bool _isPointerDown;

        /// <summary>
        /// 时间轴总时长（秒）
        /// </summary>
        public float TotalDuration => _totalDuration;

        /// <summary>
        /// 吸附间隔（秒）
        /// </summary>
        public float SnapInterval => _snapInterval;

        /// <summary>
        /// 当前缩放级别
        /// </summary>
        public float CurrentZoom => _currentZoom;

        /// <summary>
        /// 轨道被点击事件（参数：点击位置对应的时间）
        /// </summary>
        public event Action<float> OnTrackClicked;

        /// <summary>
        /// 缩放级别变化事件
        /// </summary>
        public event Action<float> OnZoomChanged;

        /// <summary>
        /// 初始化
        /// </summary>
        private void Awake()
        {
            _rectTransform = GetComponent<RectTransform>();

            if (_backgroundImage == null)
            {
                _backgroundImage = GetComponent<Image>();
            }
        }

        /// <summary>
        /// 启动时生成刻度和网格
        /// </summary>
        private void Start()
        {
            UpdateBackgroundColor();
            GenerateTicks();
            GenerateGridLines();
            GenerateTimeLabels();
        }

        /// <summary>
        /// 每帧更新
        /// </summary>
        private void Update()
        {
            if (_enableZoom)
            {
                HandleZoomInput();
            }
        }

        /// <summary>
        /// 更新背景颜色
        /// </summary>
        private void UpdateBackgroundColor()
        {
            if (_backgroundImage != null)
            {
                _backgroundImage.color = _trackBackgroundColor;
            }
        }

        /// <summary>
        /// 生成刻度标记
        /// </summary>
        private void GenerateTicks()
        {
            if (_tickContainer == null)
            {
                Debug.LogWarning("[TimelineTrack] 刻度容器未设置");
                return;
            }

            for (int i = _tickContainer.childCount - 1; i >= 0; i--)
            {
                Destroy(_tickContainer.GetChild(i).gameObject);
            }

            float trackWidth = _rectTransform.rect.width;
            int totalMinorTicks = Mathf.FloorToInt(_totalDuration / _minorTickInterval) + 1;

            for (int i = 0; i < totalMinorTicks; i++)
            {
                float time = i * _minorTickInterval;
                bool isMajorTick = Mathf.Approximately(time % _majorTickInterval, 0f);

                float xPosition = (time / _totalDuration) * trackWidth;
                float tickHeight = isMajorTick ? _majorTickHeight : _minorTickHeight;
                Color tickColor = isMajorTick ? _majorTickColor : _minorTickColor;

                GameObject tickObj = new($"Tick_{time:F1}s");
                tickObj.transform.SetParent(_tickContainer, false);

                Image tickImage = tickObj.AddComponent<Image>();
                tickImage.color = tickColor;
                tickImage.raycastTarget = false;

                RectTransform tickRect = tickObj.GetComponent<RectTransform>();
                tickRect.anchorMin = new Vector2(0, 0.5f);
                tickRect.anchorMax = new Vector2(0, 0.5f);
                tickRect.pivot = new Vector2(0.5f, 0.5f);
                tickRect.sizeDelta = new Vector2(_tickWidth, tickHeight);
                tickRect.anchoredPosition = new Vector2(xPosition, 0f);
            }
        }

        /// <summary>
        /// 生成网格线
        /// </summary>
        private void GenerateGridLines()
        {
            if (_gridContainer == null)
            {
                Debug.LogWarning("[TimelineTrack] 网格容器未设置");
                return;
            }

            for (int i = _gridContainer.childCount - 1; i >= 0; i--)
            {
                Destroy(_gridContainer.GetChild(i).gameObject);
            }

            float trackWidth = _rectTransform.rect.width;
            float trackHeight = _rectTransform.rect.height;
            int totalGridLines = Mathf.FloorToInt(_totalDuration / _majorTickInterval) + 1;

            for (int i = 0; i < totalGridLines; i++)
            {
                float time = i * _majorTickInterval;
                float xPosition = (time / _totalDuration) * trackWidth;

                GameObject gridLineObj = new($"GridLine_{time:F1}s");
                gridLineObj.transform.SetParent(_gridContainer, false);

                Image gridLineImage = gridLineObj.AddComponent<Image>();
                gridLineImage.color = _gridLineColor;
                gridLineImage.raycastTarget = false;

                RectTransform gridLineRect = gridLineObj.GetComponent<RectTransform>();
                gridLineRect.anchorMin = new Vector2(0, 0);
                gridLineRect.anchorMax = new Vector2(0, 1);
                gridLineRect.pivot = new Vector2(0.5f, 0.5f);
                gridLineRect.sizeDelta = new Vector2(_tickWidth, 0f);
                gridLineRect.anchoredPosition = new Vector2(xPosition, 0f);
            }
        }

        /// <summary>
        /// 生成时间标签
        /// </summary>
        private void GenerateTimeLabels()
        {
            if (_timeLabels == null || _timeLabels.Length == 0)
            {
                return;
            }

            float trackWidth = _rectTransform.rect.width;
            int labelCount = Mathf.Min(
                _timeLabels.Length,
                Mathf.FloorToInt(_totalDuration / _majorTickInterval) + 1
            );

            for (int i = 0; i < labelCount; i++)
            {
                float time = i * _majorTickInterval;
                float xPosition = (time / _totalDuration) * trackWidth;

                if (_timeLabels[i] != null)
                {
                    _timeLabels[i].text = $"{time:F1}";
                    RectTransform labelRect = _timeLabels[i].GetComponent<RectTransform>();
                    if (labelRect != null)
                    {
                        labelRect.anchoredPosition = new Vector2(
                            xPosition,
                            labelRect.anchoredPosition.y
                        );
                    }
                }
            }
        }

        /// <summary>
        /// 处理缩放输入
        /// </summary>
        private void HandleZoomInput()
        {
            float scrollDelta = Input.mouseScrollDelta.y;

            if (Mathf.Abs(scrollDelta) > 0.01f)
            {
                float newZoom = _currentZoom + scrollDelta * _zoomSpeed;
                SetZoom(newZoom);
            }
        }

        /// <summary>
        /// 设置缩放级别
        /// </summary>
        /// <param name="newZoom">新的缩放级别</param>
        public void SetZoom(float newZoom)
        {
            _currentZoom = Mathf.Clamp(newZoom, _minZoom, _maxZoom);

            if (_tickContainer != null)
            {
                _tickContainer.localScale = new Vector3(_currentZoom, 1f, 1f);
            }

            if (_gridContainer != null)
            {
                _gridContainer.localScale = new Vector3(_currentZoom, 1f, 1f);
            }

            OnZoomChanged?.Invoke(_currentZoom);
        }

        /// <summary>
        /// 重置缩放
        /// </summary>
        public void ResetZoom()
        {
            SetZoom(1f);
        }

        /// <summary>
        /// 将屏幕坐标转换为时间轴时间
        /// </summary>
        /// <param name="screenPosition">屏幕坐标</param>
        /// <param name="camera">相机（可选）</param>
        /// <returns>对应的时间（秒）</returns>
        public float ScreenPositionToTime(Vector2 screenPosition, Camera camera = null)
        {
            if (RectTransformUtility.ScreenPointToLocalPointInRectangle(
                _rectTransform,
                screenPosition,
                camera,
                out Vector2 localPoint
            ))
            {
                float normalizedX = (localPoint.x + _rectTransform.rect.width * 0.5f) / _rectTransform.rect.width;
                float time = normalizedX * _totalDuration;
                return SnapTimeToInterval(time);
            }

            return 0f;
        }

        /// <summary>
        /// 将时间转换为轨道上的X坐标
        /// </summary>
        /// <param name="time">时间（秒）</param>
        /// <returns>对应的X坐标（相对于轨道）</returns>
        public float TimeToTrackPosition(float time)
        {
            float normalizedTime = Mathf.Clamp01(time / _totalDuration);
            return (normalizedTime - 0.5f) * _rectTransform.rect.width;
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
        /// 处理指针点击事件
        /// </summary>
        /// <param name="eventData">指针事件数据</param>
        public void OnPointerClick(PointerEventData eventData)
        {
            if (!_isPointerDown)
            {
                return;
            }

            float clickTime = ScreenPositionToTime(eventData.position, eventData.pressEventCamera);
            clickTime = Mathf.Clamp(clickTime, 0f, _totalDuration);

            OnTrackClicked?.Invoke(clickTime);
        }

        /// <summary>
        /// 处理指针按下事件
        /// </summary>
        /// <param name="eventData">指针事件数据</param>
        public void OnPointerDown(PointerEventData eventData)
        {
            _isPointerDown = true;
        }

        /// <summary>
        /// 处理指针抬起事件
        /// </summary>
        /// <param name="eventData">指针事件数据</param>
        public void OnPointerUp(PointerEventData eventData)
        {
            _isPointerDown = false;
        }

        /// <summary>
        /// 更新时间轴配置
        /// </summary>
        /// <param name="duration">总时长（秒）</param>
        /// <param name="majorInterval">大刻度间隔（秒）</param>
        /// <param name="minorInterval">小刻度间隔（秒）</param>
        /// <param name="snapInterval">吸附间隔（秒）</param>
        public void UpdateConfiguration(
            float duration,
            float majorInterval,
            float minorInterval,
            float snapInterval
        )
        {
            _totalDuration = duration;
            _majorTickInterval = majorInterval;
            _minorTickInterval = minorInterval;
            _snapInterval = snapInterval;

            GenerateTicks();
            GenerateGridLines();
            GenerateTimeLabels();
        }

        /// <summary>
        /// 重新生成刻度和网格（用于RectTransform尺寸变化时）
        /// </summary>
        public void Refresh()
        {
            GenerateTicks();
            GenerateGridLines();
            GenerateTimeLabels();
        }

        /// <summary>
        /// 当RectTransform尺寸变化时重新生成
        /// </summary>
        private void OnRectTransformDimensionsChange()
        {
            if (_rectTransform != null && gameObject.activeInHierarchy)
            {
                Refresh();
            }
        }
    }
}
