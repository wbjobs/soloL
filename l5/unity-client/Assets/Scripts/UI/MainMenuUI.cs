using System;
using System.Net;
using System.Net.Sockets;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.EventSystems;
using TMPro;

namespace UI
{
    /// <summary>
    /// 主菜单UI
    /// 提供房间创建、加入、玩家名称输入和本地IP显示功能
    /// 赛博朋克科技风格设计
    /// </summary>
    public class MainMenuUI : BasePanel
    {
        [Header("标题设置")]
        [SerializeField] private string _titleText = "时间线战争";
        [SerializeField] private float _titlePulseSpeed = 2f;
        [SerializeField] private float _titleGlowIntensity = 1.5f;

        [Header("UI元素引用")]
        [SerializeField] private TextMeshProUGUI _titleTMP;
        [SerializeField] private TMP_InputField _playerNameInput;
        [SerializeField] private TMP_InputField _roomCodeInput;
        [SerializeField] private TextMeshProUGUI _localIPText;
        [SerializeField] private Button _createRoomBtn;
        [SerializeField] private Button _joinRoomBtn;

        [Header("颜色配置 - 赛博朋克风格")]
        [SerializeField] private Color _primaryColor = new Color(0.024f, 0.714f, 0.831f, 1f);
        [SerializeField] private Color _accentColor = new Color(0.961f, 0.62f, 0.043f, 1f);
        [SerializeField] private Color _dangerColor = new Color(0.937f, 0.267f, 0.267f, 1f);
        [SerializeField] private Color _panelBgColor = new Color(0.059f, 0.09f, 0.165f, 0.9f);
        [SerializeField] private Color _textColor = new Color(0.9f, 0.95f, 1f, 1f);

        [Header("动画设置")]
        [SerializeField] private float _hoverScale = 1.05f;
        [SerializeField] private float _hoverDuration = 0.2f;

        public event Action<string> OnCreateRoom;
        public event Action<string, string> OnJoinRoom;

        private RectTransform _titleRect;
        private Vector2 _titleOriginalPos;
        private Color _titleOriginalColor;

        protected override void Awake()
        {
            base.Awake();
            _panelType = UIPanelType.MainMenu;

            if (_titleTMP != null)
            {
                _titleRect = _titleTMP.rectTransform;
                _titleOriginalPos = _titleRect.anchoredPosition;
                _titleOriginalColor = _titleTMP.color;
            }
        }

        /// <summary>
        /// 设置UI元素
        /// 如果没有通过Inspector指定，则动态创建UI
        /// </summary>
        protected override void SetupUI()
        {
            SetupPanelStyle();

            if (_titleTMP == null) CreateTitle();
            if (_playerNameInput == null) CreatePlayerNameInput();
            if (_roomCodeInput == null) CreateRoomCodeInput();
            if (_createRoomBtn == null) CreateCreateRoomButton();
            if (_joinRoomBtn == null) CreateJoinRoomButton();
            if (_localIPText == null) CreateLocalIPDisplay();

            UpdateLocalIP();
        }

        /// <summary>
        /// 设置面板整体样式
        /// </summary>
        private void SetupPanelStyle()
        {
            RectTransform rect = GetComponent<RectTransform>();
            if (rect == null)
            {
                rect = gameObject.AddComponent<RectTransform>();
            }
            rect.anchorMin = Vector2.zero;
            rect.anchorMax = Vector2.one;
            rect.offsetMin = Vector2.zero;
            rect.offsetMax = Vector2.zero;

            Image bgImage = GetComponent<Image>();
            if (bgImage == null)
            {
                bgImage = gameObject.AddComponent<Image>();
            }
            bgImage.color = new Color(0.059f, 0.09f, 0.165f, 1f);

            CreateGridBackground();
        }

        /// <summary>
        /// 创建动态网格背景
        /// </summary>
        private void CreateGridBackground()
        {
            GameObject gridObj = new GameObject("GridBackground");
            gridObj.transform.SetParent(transform, false);

            RectTransform gridRect = gridObj.AddComponent<RectTransform>();
            gridRect.anchorMin = Vector2.zero;
            gridRect.anchorMax = Vector2.one;
            gridRect.offsetMin = Vector2.zero;
            gridRect.offsetMax = Vector2.zero;

            RawImage gridImage = gridObj.AddComponent<RawImage>();
            gridImage.color = new Color(0.024f, 0.714f, 0.831f, 0.05f);
            gridImage.uvRect = new Rect(0f, 0f, 20f, 12f);

            gridObj.transform.SetAsFirstSibling();
        }

        /// <summary>
        /// 创建标题
        /// </summary>
        private void CreateTitle()
        {
            GameObject titleObj = new GameObject("Title");
            titleObj.transform.SetParent(transform, false);

            _titleRect = titleObj.AddComponent<RectTransform>();
            _titleRect.anchorMin = new Vector2(0.5f, 0.75f);
            _titleRect.anchorMax = new Vector2(0.5f, 0.75f);
            _titleRect.sizeDelta = new Vector2(800f, 120f);
            _titleRect.anchoredPosition = Vector2.zero;
            _titleOriginalPos = Vector2.zero;

            _titleTMP = titleObj.AddComponent<TextMeshProUGUI>();
            _titleTMP.text = _titleText;
            _titleTMP.fontSize = 80f;
            _titleTMP.alignment = TextAlignmentOptions.Center;
            _titleTMP.color = _primaryColor;
            _titleTMP.fontStyle = FontStyles.Bold;
            _titleOriginalColor = _primaryColor;

            _titleTMP.outlineWidth = 0.5f;
            _titleTMP.outlineColor = new Color(0.024f, 0.714f, 0.831f, 0.8f);
        }

        /// <summary>
        /// 创建玩家名称输入框
        /// </summary>
        private void CreatePlayerNameInput()
        {
            GameObject inputObj = new GameObject("PlayerNameInput");
            inputObj.transform.SetParent(transform, false);

            RectTransform inputRect = inputObj.AddComponent<RectTransform>();
            inputRect.anchorMin = new Vector2(0.5f, 0.55f);
            inputRect.anchorMax = new Vector2(0.5f, 0.55f);
            inputRect.sizeDelta = new Vector2(400f, 60f);
            inputRect.anchoredPosition = new Vector2(0f, 30f);

            Image bgImage = inputObj.AddComponent<Image>();
            bgImage.color = _panelBgColor;
            bgImage.sprite = CreateRoundedSprite(8);
            bgImage.type = Image.Type.Sliced;

            Outline outline = inputObj.AddComponent<Outline>();
            outline.effectColor = _primaryColor;
            outline.effectDistance = new Vector2(2f, 2f);

            GameObject labelObj = new GameObject("Label");
            labelObj.transform.SetParent(inputObj.transform, false);
            RectTransform labelRect = labelObj.AddComponent<RectTransform>();
            labelRect.anchorMin = new Vector2(0f, 0f);
            labelRect.anchorMax = new Vector2(0.3f, 1f);
            labelRect.offsetMin = new Vector2(10f, 0f);
            labelRect.offsetMax = Vector2.zero;

            TextMeshProUGUI labelTMP = labelObj.AddComponent<TextMeshProUGUI>();
            labelTMP.text = "玩家名称";
            labelTMP.fontSize = 24f;
            labelTMP.alignment = TextAlignmentOptions.MidlineLeft;
            labelTMP.color = _textColor;

            _playerNameInput = inputObj.AddComponent<TMP_InputField>();
            _playerNameInput.text = "玩家" + UnityEngine.Random.Range(1000, 9999);

            GameObject textAreaObj = new GameObject("TextArea");
            textAreaObj.transform.SetParent(inputObj.transform, false);
            RectTransform textAreaRect = textAreaObj.AddComponent<RectTransform>();
            textAreaRect.anchorMin = new Vector2(0.3f, 0f);
            textAreaRect.anchorMax = new Vector2(1f, 1f);
            textAreaRect.offsetMin = new Vector2(5f, 5f);
            textAreaRect.offsetMax = new Vector2(-10f, -5f);

            GameObject textObj = new GameObject("Text");
            textObj.transform.SetParent(textAreaObj.transform, false);
            RectTransform textRect = textObj.AddComponent<RectTransform>();
            textRect.anchorMin = Vector2.zero;
            textRect.anchorMax = Vector2.one;
            textRect.offsetMin = Vector2.zero;
            textRect.offsetMax = Vector2.zero;

            TextMeshProUGUI textTMP = textObj.AddComponent<TextMeshProUGUI>();
            textTMP.fontSize = 24f;
            textTMP.color = _textColor;
            textTMP.alignment = TextAlignmentOptions.MidlineLeft;

            _playerNameInput.textViewport = textAreaRect;
            _playerNameInput.textComponent = textTMP;
            _playerNameInput.targetGraphic = bgImage;
            _playerNameInput.characterLimit = 12;
        }

        /// <summary>
        /// 创建房间号输入框
        /// </summary>
        private void CreateRoomCodeInput()
        {
            GameObject inputObj = new GameObject("RoomCodeInput");
            inputObj.transform.SetParent(transform, false);

            RectTransform inputRect = inputObj.AddComponent<RectTransform>();
            inputRect.anchorMin = new Vector2(0.5f, 0.45f);
            inputRect.anchorMax = new Vector2(0.5f, 0.45f);
            inputRect.sizeDelta = new Vector2(400f, 60f);
            inputRect.anchoredPosition = new Vector2(0f, -30f);

            Image bgImage = inputObj.AddComponent<Image>();
            bgImage.color = _panelBgColor;
            bgImage.sprite = CreateRoundedSprite(8);
            bgImage.type = Image.Type.Sliced;

            Outline outline = inputObj.AddComponent<Outline>();
            outline.effectColor = _accentColor;
            outline.effectDistance = new Vector2(2f, 2f);

            GameObject labelObj = new GameObject("Label");
            labelObj.transform.SetParent(inputObj.transform, false);
            RectTransform labelRect = labelObj.AddComponent<RectTransform>();
            labelRect.anchorMin = new Vector2(0f, 0f);
            labelRect.anchorMax = new Vector2(0.3f, 1f);
            labelRect.offsetMin = new Vector2(10f, 0f);
            labelRect.offsetMax = Vector2.zero;

            TextMeshProUGUI labelTMP = labelObj.AddComponent<TextMeshProUGUI>();
            labelTMP.text = "房间号";
            labelTMP.fontSize = 24f;
            labelTMP.alignment = TextAlignmentOptions.MidlineLeft;
            labelTMP.color = _textColor;

            _roomCodeInput = inputObj.AddComponent<TMP_InputField>();

            GameObject textAreaObj = new GameObject("TextArea");
            textAreaObj.transform.SetParent(inputObj.transform, false);
            RectTransform textAreaRect = textAreaObj.AddComponent<RectTransform>();
            textAreaRect.anchorMin = new Vector2(0.3f, 0f);
            textAreaRect.anchorMax = new Vector2(1f, 1f);
            textAreaRect.offsetMin = new Vector2(5f, 5f);
            textAreaRect.offsetMax = new Vector2(-10f, -5f);

            GameObject textObj = new GameObject("Text");
            textObj.transform.SetParent(textAreaObj.transform, false);
            RectTransform textRect = textObj.AddComponent<RectTransform>();
            textRect.anchorMin = Vector2.zero;
            textRect.anchorMax = Vector2.one;
            textRect.offsetMin = Vector2.zero;
            textRect.offsetMax = Vector2.zero;

            TextMeshProUGUI textTMP = textObj.AddComponent<TextMeshProUGUI>();
            textTMP.fontSize = 24f;
            textTMP.color = _textColor;
            textTMP.alignment = TextAlignmentOptions.MidlineLeft;

            _roomCodeInput.textViewport = textAreaRect;
            _roomCodeInput.textComponent = textTMP;
            _roomCodeInput.targetGraphic = bgImage;
            _roomCodeInput.characterLimit = 6;
            _roomCodeInput.inputType = TMP_InputField.InputType.Alphanumeric;
        }

        /// <summary>
        /// 创建创建房间按钮
        /// </summary>
        private void CreateCreateRoomButton()
        {
            _createRoomBtn = CreateButton("CreateRoomBtn", "创建房间", _primaryColor,
                new Vector2(0.35f, 0.3f), new Vector2(180f, 60f));
        }

        /// <summary>
        /// 创建加入房间按钮
        /// </summary>
        private void CreateJoinRoomButton()
        {
            _joinRoomBtn = CreateButton("JoinRoomBtn", "加入房间", _accentColor,
                new Vector2(0.65f, 0.3f), new Vector2(180f, 60f));
        }

        /// <summary>
        /// 创建本地IP显示
        /// </summary>
        private void CreateLocalIPDisplay()
        {
            GameObject ipObj = new GameObject("LocalIPDisplay");
            ipObj.transform.SetParent(transform, false);

            RectTransform ipRect = ipObj.AddComponent<RectTransform>();
            ipRect.anchorMin = new Vector2(0.5f, 0.1f);
            ipRect.anchorMax = new Vector2(0.5f, 0.1f);
            ipRect.sizeDelta = new Vector2(400f, 40f);
            ipRect.anchoredPosition = Vector2.zero;

            _localIPText = ipObj.AddComponent<TextMeshProUGUI>();
            _localIPText.fontSize = 20f;
            _localIPText.alignment = TextAlignmentOptions.Center;
            _localIPText.color = new Color(0.6f, 0.7f, 0.8f, 1f);
        }

        /// <summary>
        /// 创建通用按钮
        /// </summary>
        private Button CreateButton(string name, string text, Color color, Vector2 anchor, Vector2 size)
        {
            GameObject btnObj = new GameObject(name);
            btnObj.transform.SetParent(transform, false);

            RectTransform btnRect = btnObj.AddComponent<RectTransform>();
            btnRect.anchorMin = anchor;
            btnRect.anchorMax = anchor;
            btnRect.sizeDelta = size;
            btnRect.anchoredPosition = Vector2.zero;

            Image bgImage = btnObj.AddComponent<Image>();
            bgImage.color = new Color(color.r, color.g, color.b, 0.8f);
            bgImage.sprite = CreateRoundedSprite(8);
            bgImage.type = Image.Type.Sliced;

            Outline outline = btnObj.AddComponent<Outline>();
            outline.effectColor = color;
            outline.effectDistance = new Vector2(2f, 2f);

            Button button = btnObj.AddComponent<Button>();
            button.targetGraphic = bgImage;
            button.transition = Selectable.Transition.ColorTint;

            ColorBlock colors = button.colors;
            colors.normalColor = new Color(color.r, color.g, color.b, 0.8f);
            colors.highlightedColor = new Color(color.r, color.g, color.b, 1f);
            colors.pressedColor = new Color(color.r * 0.7f, color.g * 0.7f, color.b * 0.7f, 1f);
            colors.selectedColor = colors.normalColor;
            colors.disabledColor = new Color(0.3f, 0.3f, 0.3f, 0.5f);
            colors.fadeDuration = _hoverDuration;
            button.colors = colors;

            GameObject textObj = new GameObject("Text");
            textObj.transform.SetParent(btnObj.transform, false);
            RectTransform textRect = textObj.AddComponent<RectTransform>();
            textRect.anchorMin = Vector2.zero;
            textRect.anchorMax = Vector2.one;
            textRect.offsetMin = Vector2.zero;
            textRect.offsetMax = Vector2.zero;

            TextMeshProUGUI textTMP = textObj.AddComponent<TextMeshProUGUI>();
            textTMP.text = text;
            textTMP.fontSize = 28f;
            textTMP.alignment = TextAlignmentOptions.Center;
            textTMP.color = Color.white;
            textTMP.fontStyle = FontStyles.Bold;

            UIButtonEffects effects = btnObj.AddComponent<UIButtonEffects>();
            effects.Setup(bgImage, textTMP, color, _hoverScale, _hoverDuration);

            return button;
        }

        /// <summary>
        /// 创建圆角Sprite
        /// </summary>
        private Sprite CreateRoundedSprite(int radius)
        {
            int size = radius * 2 + 2;
            Texture2D tex = new Texture2D(size, size);
            Color[] colors = new Color[size * size];

            for (int x = 0; x < size; x++)
            {
                for (int y = 0; y < size; y++)
                {
                    float dx = x - radius - 0.5f;
                    float dy = y - radius - 0.5f;
                    float dist = Mathf.Sqrt(dx * dx + dy * dy);
                    colors[y * size + x] = dist <= radius ? Color.white : Color.clear;
                }
            }

            tex.SetPixels(colors);
            tex.Apply();
            tex.wrapMode = TextureWrapMode.Clamp;

            Sprite sprite = Sprite.Create(tex, new Rect(0, 0, size, size),
                new Vector2(0.5f, 0.5f), 100f, 0, SpriteMeshType.FullRect,
                new Vector4(radius, radius, radius, radius));
            return sprite;
        }

        /// <summary>
        /// 注册事件
        /// </summary>
        protected override void RegisterEvents()
        {
            if (_createRoomBtn != null)
            {
                _createRoomBtn.onClick.AddListener(OnCreateRoomClicked);
            }

            if (_joinRoomBtn != null)
            {
                _joinRoomBtn.onClick.AddListener(OnJoinRoomClicked);
            }
        }

        /// <summary>
        /// 取消事件注册
        /// </summary>
        protected override void UnregisterEvents()
        {
            if (_createRoomBtn != null)
            {
                _createRoomBtn.onClick.RemoveListener(OnCreateRoomClicked);
            }

            if (_joinRoomBtn != null)
            {
                _joinRoomBtn.onClick.RemoveListener(OnJoinRoomClicked);
            }
        }

        /// <summary>
        /// 创建房间按钮点击
        /// </summary>
        private void OnCreateRoomClicked()
        {
            string playerName = GetPlayerName();
            if (string.IsNullOrEmpty(playerName))
            {
                Debug.LogWarning("玩家名称不能为空");
                return;
            }

            OnCreateRoom?.Invoke(playerName);
        }

        /// <summary>
        /// 加入房间按钮点击
        /// </summary>
        private void OnJoinRoomClicked()
        {
            string playerName = GetPlayerName();
            string roomCode = GetRoomCode();

            if (string.IsNullOrEmpty(playerName))
            {
                Debug.LogWarning("玩家名称不能为空");
                return;
            }

            if (string.IsNullOrEmpty(roomCode) || roomCode.Length != 6)
            {
                Debug.LogWarning("请输入有效的6位房间号");
                return;
            }

            OnJoinRoom?.Invoke(playerName, roomCode.ToUpper());
        }

        /// <summary>
        /// 获取玩家名称
        /// </summary>
        public string GetPlayerName()
        {
            return _playerNameInput != null ? _playerNameInput.text.Trim() : string.Empty;
        }

        /// <summary>
        /// 获取房间号
        /// </summary>
        public string GetRoomCode()
        {
            return _roomCodeInput != null ? _roomCodeInput.text.Trim() : string.Empty;
        }

        /// <summary>
        /// 更新本地IP显示
        /// </summary>
        public void UpdateLocalIP()
        {
            string ip = GetLocalIPAddress();
            if (_localIPText != null)
            {
                _localIPText.text = $"本机IP: {ip}";
            }
        }

        /// <summary>
        /// 获取本地IP地址
        /// </summary>
        private string GetLocalIPAddress()
        {
            try
            {
                IPHostEntry host = Dns.GetHostEntry(Dns.GetHostName());
                foreach (IPAddress ip in host.AddressList)
                {
                    if (ip.AddressFamily == AddressFamily.InterNetwork)
                    {
                        return ip.ToString();
                    }
                }
                return "127.0.0.1";
            }
            catch (Exception e)
            {
                Debug.LogError($"获取IP地址失败: {e.Message}");
                return "127.0.0.1";
            }
        }

        private void Update()
        {
            UpdateTitleAnimation();
        }

        /// <summary>
        /// 更新标题动画
        /// 脉冲发光 + 轻微浮动效果
        /// </summary>
        private void UpdateTitleAnimation()
        {
            if (_titleTMP == null || _titleRect == null) return;

            float pulse = Mathf.Sin(Time.time * _titlePulseSpeed) * 0.5f + 0.5f;

            _titleTMP.color = Color.Lerp(
                _titleOriginalColor,
                new Color(_titleOriginalColor.r, _titleOriginalColor.g, _titleOriginalColor.b, 1f) * _titleGlowIntensity,
                pulse
            );

            float floatY = Mathf.Sin(Time.time * _titlePulseSpeed * 0.5f) * 5f;
            _titleRect.anchoredPosition = _titleOriginalPos + new Vector2(0f, floatY);
        }

        /// <summary>
        /// 面板显示时调用
        /// </summary>
        protected override void OnShow()
        {
            base.OnShow();
            UpdateLocalIP();
        }
    }

    /// <summary>
    /// 按钮效果组件
    /// 提供悬停缩放、颜色变化等视觉反馈
    /// </summary>
    public class UIButtonEffects : MonoBehaviour
    {
        private Image _targetImage;
        private TextMeshProUGUI _targetText;
        private Color _baseColor;
        private float _hoverScale;
        private float _duration;

        private Vector3 _originalScale;
        private bool _isHovering;

        public void Setup(Image image, TextMeshProUGUI text, Color color, float scale, float duration)
        {
            _targetImage = image;
            _targetText = text;
            _baseColor = color;
            _hoverScale = scale;
            _duration = duration;

            _originalScale = transform.localScale;

            AddTriggerEvents();
        }

        private void AddTriggerEvents()
        {
            EventTrigger trigger = gameObject.GetComponent<EventTrigger>();
            if (trigger == null)
            {
                trigger = gameObject.AddComponent<EventTrigger>();
            }

            EventTrigger.Entry pointerEnter = new EventTrigger.Entry();
            pointerEnter.eventID = EventTriggerType.PointerEnter;
            pointerEnter.callback.AddListener((data) => { OnPointerEnter(); });
            trigger.triggers.Add(pointerEnter);

            EventTrigger.Entry pointerExit = new EventTrigger.Entry();
            pointerExit.eventID = EventTriggerType.PointerExit;
            pointerExit.callback.AddListener((data) => { OnPointerExit(); });
            trigger.triggers.Add(pointerExit);

            EventTrigger.Entry pointerDown = new EventTrigger.Entry();
            pointerDown.eventID = EventTriggerType.PointerDown;
            pointerDown.callback.AddListener((data) => { OnPointerDown(); });
            trigger.triggers.Add(pointerDown);

            EventTrigger.Entry pointerUp = new EventTrigger.Entry();
            pointerUp.eventID = EventTriggerType.PointerUp;
            pointerUp.callback.AddListener((data) => { OnPointerUp(); });
            trigger.triggers.Add(pointerUp);
        }

        private void OnPointerEnter()
        {
            _isHovering = true;
            StopAllCoroutines();
            StartCoroutine(TweenScale(_originalScale * _hoverScale, _duration));
        }

        private void OnPointerExit()
        {
            _isHovering = false;
            StopAllCoroutines();
            StartCoroutine(TweenScale(_originalScale, _duration));
        }

        private void OnPointerDown()
        {
            StopAllCoroutines();
            StartCoroutine(TweenScale(_originalScale * 0.95f, _duration * 0.5f));
        }

        private void OnPointerUp()
        {
            StopAllCoroutines();
            Vector3 targetScale = _isHovering ? _originalScale * _hoverScale : _originalScale;
            StartCoroutine(TweenScale(targetScale, _duration));
        }

        private System.Collections.IEnumerator TweenScale(Vector3 target, float duration)
        {
            Vector3 start = transform.localScale;
            float elapsed = 0f;

            while (elapsed < duration)
            {
                elapsed += Time.unscaledDeltaTime;
                float t = elapsed / duration;
                t = 1f - Mathf.Pow(1f - t, 3f);
                transform.localScale = Vector3.Lerp(start, target, t);
                yield return null;
            }

            transform.localScale = target;
        }
    }
}
