using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.EventSystems;
using TMPro;
using Protocol;

namespace UI
{
    /// <summary>
    /// 房间大厅UI
    /// 显示玩家列表、房间设置，提供准备/开始游戏等功能
    /// </summary>
    public class RoomLobbyUI : BasePanel
    {
        [Header("房间信息")]
        [SerializeField] private string _roomCode = "ABC123";
        [SerializeField] private int _maxPlayers = 4;
        [SerializeField] private string _selectedMap = "标准战场";
        [SerializeField] private bool _isRoomOwner = false;

        [Header("UI元素引用")]
        [SerializeField] private TextMeshProUGUI _roomCodeText;
        [SerializeField] private Button _copyRoomCodeBtn;
        [SerializeField] private Transform _playerListContainer;
        [SerializeField] private TMP_Dropdown _maxPlayersDropdown;
        [SerializeField] private TMP_Dropdown _mapDropdown;
        [SerializeField] private Button _readyBtn;
        [SerializeField] private Button _startGameBtn;
        [SerializeField] private Button _leaveRoomBtn;
        [SerializeField] private TextMeshProUGUI _readyBtnText;

        [Header("颜色配置")]
        [SerializeField] private Color _primaryColor = new Color(0.024f, 0.714f, 0.831f, 1f);
        [SerializeField] private Color _accentColor = new Color(0.961f, 0.62f, 0.043f, 1f);
        [SerializeField] private Color _successColor = new Color(0.345f, 0.875f, 0.42f, 1f);
        [SerializeField] private Color _dangerColor = new Color(0.937f, 0.267f, 0.267f, 1f);
        [SerializeField] private Color _panelBgColor = new Color(0.059f, 0.09f, 0.165f, 0.9f);
        [SerializeField] private Color _textColor = new Color(0.9f, 0.95f, 1f, 1f);

        [Header("玩家颜色")]
        [SerializeField] private Color[] _playerColors = new Color[]
        {
            new Color(0.024f, 0.714f, 0.831f, 1f),
            new Color(0.937f, 0.267f, 0.267f, 1f),
            new Color(0.345f, 0.875f, 0.42f, 1f),
            new Color(0.961f, 0.62f, 0.043f, 1f)
        };

        public event Action OnReady;
        public event Action OnCancelReady;
        public event Action OnStartGame;
        public event Action OnLeaveRoom;
        public event Action<int> OnMaxPlayersChanged;
        public event Action<string> OnMapChanged;

        private readonly List<PlayerListItem> _playerItems = new List<PlayerListItem>();
        private bool _isReady = false;
        private List<Player> _players = new List<Player>();

        protected override void Awake()
        {
            base.Awake();
            _panelType = UIPanelType.RoomLobby;
        }

        /// <summary>
        /// 设置UI元素
        /// </summary>
        protected override void SetupUI()
        {
            SetupPanelStyle();

            CreateRoomHeader();
            CreatePlayerListPanel();
            CreateRoomSettingsPanel();
            CreateBottomButtons();
        }

        /// <summary>
        /// 设置面板样式
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
            bgImage.color = new Color(0.059f, 0.09f, 0.165f, 0.95f);
        }

        /// <summary>
        /// 创建房间顶部信息栏
        /// </summary>
        private void CreateRoomHeader()
        {
            GameObject headerObj = new GameObject("RoomHeader");
            headerObj.transform.SetParent(transform, false);

            RectTransform headerRect = headerObj.AddComponent<RectTransform>();
            headerRect.anchorMin = new Vector2(0f, 1f);
            headerRect.anchorMax = new Vector2(1f, 1f);
            headerRect.sizeDelta = new Vector2(0f, 80f);
            headerRect.pivot = new Vector2(0.5f, 1f);
            headerRect.anchoredPosition = Vector2.zero;

            Image headerBg = headerObj.AddComponent<Image>();
            headerBg.color = new Color(0.039f, 0.063f, 0.125f, 1f);

            GameObject titleObj = new GameObject("Title");
            titleObj.transform.SetParent(headerObj.transform, false);
            RectTransform titleRect = titleObj.AddComponent<RectTransform>();
            titleRect.anchorMin = new Vector2(0f, 0f);
            titleRect.anchorMax = new Vector2(0.4f, 1f);
            titleRect.offsetMin = new Vector2(20f, 0f);
            titleRect.offsetMax = Vector2.zero;

            TextMeshProUGUI titleTMP = titleObj.AddComponent<TextMeshProUGUI>();
            titleTMP.text = "房间大厅";
            titleTMP.fontSize = 36f;
            titleTMP.alignment = TextAlignmentOptions.MidlineLeft;
            titleTMP.color = _primaryColor;
            titleTMP.fontStyle = FontStyles.Bold;

            GameObject roomCodeObj = new GameObject("RoomCode");
            roomCodeObj.transform.SetParent(headerObj.transform, false);
            RectTransform roomCodeRect = roomCodeObj.AddComponent<RectTransform>();
            roomCodeRect.anchorMin = new Vector2(0.4f, 0f);
            roomCodeRect.anchorMax = new Vector2(0.7f, 1f);
            roomCodeRect.offsetMin = Vector2.zero;
            roomCodeRect.offsetMax = Vector2.zero;

            _roomCodeText = roomCodeObj.AddComponent<TextMeshProUGUI>();
            _roomCodeText.text = $"房间号: {_roomCode}";
            _roomCodeText.fontSize = 28f;
            _roomCodeText.alignment = TextAlignmentOptions.MidlineCenter;
            _roomCodeText.color = _accentColor;
            _roomCodeText.fontStyle = FontStyles.Bold;

            _copyRoomCodeBtn = CreateButton("CopyBtn", "复制", _primaryColor,
                headerObj.transform, new Vector2(0.85f, 0.5f), new Vector2(100f, 40f), 20f);
        }

        /// <summary>
        /// 创建玩家列表面板
        /// </summary>
        private void CreatePlayerListPanel()
        {
            GameObject panelObj = new GameObject("PlayerListPanel");
            panelObj.transform.SetParent(transform, false);

            RectTransform panelRect = panelObj.AddComponent<RectTransform>();
            panelRect.anchorMin = new Vector2(0f, 0.15f);
            panelRect.anchorMax = new Vector2(0.5f, 0.92f);
            panelRect.offsetMin = new Vector2(20f, 20f);
            panelRect.offsetMax = new Vector2(-10f, -20f);

            Image panelBg = panelObj.AddComponent<Image>();
            panelBg.color = _panelBgColor;
            panelBg.sprite = CreateRoundedSprite(12);
            panelBg.type = Image.Type.Sliced;

            Outline panelOutline = panelObj.AddComponent<Outline>();
            panelOutline.effectColor = new Color(_primaryColor.r, _primaryColor.g, _primaryColor.b, 0.5f);
            panelOutline.effectDistance = new Vector2(2f, 2f);

            GameObject titleObj = new GameObject("Title");
            titleObj.transform.SetParent(panelObj.transform, false);
            RectTransform titleRect = titleObj.AddComponent<RectTransform>();
            titleRect.anchorMin = new Vector2(0f, 1f);
            titleRect.anchorMax = new Vector2(1f, 1f);
            titleRect.sizeDelta = new Vector2(0f, 50f);
            titleRect.pivot = new Vector2(0.5f, 1f);
            titleRect.anchoredPosition = Vector2.zero;

            TextMeshProUGUI titleTMP = titleObj.AddComponent<TextMeshProUGUI>();
            titleTMP.text = $"玩家列表 ({_players.Count}/{_maxPlayers})";
            titleTMP.fontSize = 24f;
            titleTMP.alignment = TextAlignmentOptions.MidlineLeft;
            titleTMP.color = _textColor;
            titleTMP.margin = new Vector4(15f, 0f, 0f, 0f);

            Image titleDivider = titleObj.AddComponent<Image>();
            titleDivider.color = new Color(_primaryColor.r, _primaryColor.g, _primaryColor.b, 0.3f);
            RectTransform dividerRect = titleDivider.rectTransform;
            dividerRect.anchorMin = new Vector2(0f, 0f);
            dividerRect.anchorMax = new Vector2(1f, 0f);
            dividerRect.sizeDelta = new Vector2(0f, 2f);

            GameObject scrollObj = new GameObject("ScrollView");
            scrollObj.transform.SetParent(panelObj.transform, false);
            RectTransform scrollRect = scrollObj.AddComponent<RectTransform>();
            scrollRect.anchorMin = Vector2.zero;
            scrollRect.anchorMax = Vector2.one;
            scrollRect.offsetMin = new Vector2(10f, 10f);
            scrollRect.offsetMax = new Vector2(-10f, -60f);

            ScrollRect scrollView = scrollObj.AddComponent<ScrollRect>();
            scrollView.horizontal = false;
            scrollView.vertical = true;
            scrollView.elasticity = 0.1f;

            Image scrollBg = scrollObj.AddComponent<Image>();
            scrollBg.color = new Color(0f, 0f, 0f, 0.2f);

            GameObject viewportObj = new GameObject("Viewport");
            viewportObj.transform.SetParent(scrollObj.transform, false);
            RectTransform viewportRect = viewportObj.AddComponent<RectTransform>();
            viewportRect.anchorMin = Vector2.zero;
            viewportRect.anchorMax = Vector2.one;
            viewportRect.offsetMin = Vector2.zero;
            viewportRect.offsetMax = Vector2.zero;

            viewportObj.AddComponent<RectMask2D>();

            GameObject contentObj = new GameObject("Content");
            contentObj.transform.SetParent(viewportObj.transform, false);
            _playerListContainer = contentObj.AddComponent<RectTransform>();
            _playerListContainer.anchorMin = new Vector2(0.5f, 1f);
            _playerListContainer.anchorMax = new Vector2(0.5f, 1f);
            _playerListContainer.pivot = new Vector2(0.5f, 1f);
            _playerListContainer.sizeDelta = new Vector2(scrollRect.rect.width - 20f, 200f);

            VerticalLayoutGroup layoutGroup = contentObj.AddComponent<VerticalLayoutGroup>();
            layoutGroup.childAlignment = TextAnchor.UpperCenter;
            layoutGroup.childControlHeight = true;
            layoutGroup.childControlWidth = true;
            layoutGroup.childForceExpandWidth = true;
            layoutGroup.childForceExpandHeight = false;
            layoutGroup.spacing = 10f;
            layoutGroup.padding = new RectOffset(10, 10, 10, 10);

            ContentSizeFitter fitter = contentObj.AddComponent<ContentSizeFitter>();
            fitter.verticalFit = ContentSizeFitter.FitMode.PreferredSize;

            scrollView.viewport = viewportRect;
            scrollView.content = _playerListContainer;

            GameObject scrollbarObj = new GameObject("Scrollbar");
            scrollbarObj.transform.SetParent(scrollObj.transform, false);
            RectTransform scrollbarRect = scrollbarObj.AddComponent<RectTransform>();
            scrollbarRect.anchorMin = new Vector2(1f, 0f);
            scrollbarRect.anchorMax = new Vector2(1f, 1f);
            scrollbarRect.sizeDelta = new Vector2(8f, 0f);
            scrollbarRect.pivot = new Vector2(1f, 1f);

            Scrollbar scrollbar = scrollbarObj.AddComponent<Scrollbar>();
            scrollbar.direction = Scrollbar.Direction.BottomToTop;

            Image scrollbarBg = scrollbarObj.AddComponent<Image>();
            scrollbarBg.color = new Color(0f, 0f, 0f, 0.3f);

            GameObject handleObj = new GameObject("Handle");
            handleObj.transform.SetParent(scrollbarObj.transform, false);
            RectTransform handleRect = handleObj.AddComponent<RectTransform>();
            handleRect.sizeDelta = new Vector2(0f, 30f);

            Image handleImage = handleObj.AddComponent<Image>();
            handleImage.color = new Color(_primaryColor.r, _primaryColor.g, _primaryColor.b, 0.5f);

            scrollbar.handleRect = handleRect;
            scrollbar.targetGraphic = handleImage;
            scrollView.verticalScrollbar = scrollbar;
            scrollView.verticalScrollbarVisibility = ScrollRect.ScrollbarVisibility.AutoHide;
        }

        /// <summary>
        /// 创建房间设置面板
        /// </summary>
        private void CreateRoomSettingsPanel()
        {
            GameObject panelObj = new GameObject("RoomSettingsPanel");
            panelObj.transform.SetParent(transform, false);

            RectTransform panelRect = panelObj.AddComponent<RectTransform>();
            panelRect.anchorMin = new Vector2(0.5f, 0.15f);
            panelRect.anchorMax = new Vector2(1f, 0.92f);
            panelRect.offsetMin = new Vector2(10f, 20f);
            panelRect.offsetMax = new Vector2(-20f, -20f);

            Image panelBg = panelObj.AddComponent<Image>();
            panelBg.color = _panelBgColor;
            panelBg.sprite = CreateRoundedSprite(12);
            panelBg.type = Image.Type.Sliced;

            Outline panelOutline = panelObj.AddComponent<Outline>();
            panelOutline.effectColor = new Color(_accentColor.r, _accentColor.g, _accentColor.b, 0.5f);
            panelOutline.effectDistance = new Vector2(2f, 2f);

            GameObject titleObj = new GameObject("Title");
            titleObj.transform.SetParent(panelObj.transform, false);
            RectTransform titleRect = titleObj.AddComponent<RectTransform>();
            titleRect.anchorMin = new Vector2(0f, 1f);
            titleRect.anchorMax = new Vector2(1f, 1f);
            titleRect.sizeDelta = new Vector2(0f, 50f);
            titleRect.pivot = new Vector2(0.5f, 1f);
            titleRect.anchoredPosition = Vector2.zero;

            TextMeshProUGUI titleTMP = titleObj.AddComponent<TextMeshProUGUI>();
            titleTMP.text = "房间设置";
            titleTMP.fontSize = 24f;
            titleTMP.alignment = TextAlignmentOptions.MidlineLeft;
            titleTMP.color = _textColor;
            titleTMP.margin = new Vector4(15f, 0f, 0f, 0f);

            Image titleDivider = titleObj.AddComponent<Image>();
            titleDivider.color = new Color(_accentColor.r, _accentColor.g, _accentColor.b, 0.3f);
            RectTransform dividerRect = titleDivider.rectTransform;
            dividerRect.anchorMin = new Vector2(0f, 0f);
            dividerRect.anchorMax = new Vector2(1f, 0f);
            dividerRect.sizeDelta = new Vector2(0f, 2f);

            CreateMaxPlayersDropdown(panelObj.transform);
            CreateMapDropdown(panelObj.transform);
        }

        /// <summary>
        /// 创建最大玩家数下拉菜单
        /// </summary>
        private void CreateMaxPlayersDropdown(Transform parent)
        {
            GameObject dropdownObj = new GameObject("MaxPlayersDropdown");
            dropdownObj.transform.SetParent(parent, false);

            RectTransform dropdownRect = dropdownObj.AddComponent<RectTransform>();
            dropdownRect.anchorMin = new Vector2(0f, 0.7f);
            dropdownRect.anchorMax = new Vector2(1f, 0.7f);
            dropdownRect.sizeDelta = new Vector2(0f, 80f);
            dropdownRect.anchoredPosition = new Vector2(0f, -20f);

            GameObject labelObj = new GameObject("Label");
            labelObj.transform.SetParent(dropdownObj.transform, false);
            RectTransform labelRect = labelObj.AddComponent<RectTransform>();
            labelRect.anchorMin = new Vector2(0f, 0.5f);
            labelRect.anchorMax = new Vector2(0.4f, 1f);
            labelRect.offsetMin = new Vector2(20f, 0f);
            labelRect.offsetMax = Vector2.zero;

            TextMeshProUGUI labelTMP = labelObj.AddComponent<TextMeshProUGUI>();
            labelTMP.text = "最大玩家数";
            labelTMP.fontSize = 20f;
            labelTMP.alignment = TextAlignmentOptions.MidlineLeft;
            labelTMP.color = _textColor;

            _maxPlayersDropdown = dropdownObj.AddComponent<TMP_Dropdown>();

            Image dropdownBg = dropdownObj.AddComponent<Image>();
            dropdownBg.color = new Color(0.02f, 0.04f, 0.08f, 1f);
            dropdownBg.sprite = CreateRoundedSprite(6);
            dropdownBg.type = Image.Type.Sliced;

            RectTransform templateRect = new GameObject("Template").AddComponent<RectTransform>();
            templateRect.SetParent(dropdownObj.transform, false);
            templateRect.anchorMin = new Vector2(0f, 0f);
            templateRect.anchorMax = new Vector2(1f, 0f);
            templateRect.pivot = new Vector2(0.5f, 1f);
            templateRect.sizeDelta = new Vector2(0f, 150f);
            templateRect.anchoredPosition = new Vector2(0f, 0f);

            Image templateBg = templateRect.gameObject.AddComponent<Image>();
            templateBg.color = new Color(0.059f, 0.09f, 0.165f, 1f);

            templateRect.gameObject.AddComponent<RectMask2D>();

            GameObject viewportObj = new GameObject("Viewport");
            viewportObj.transform.SetParent(templateRect.transform, false);
            RectTransform viewportRect = viewportObj.AddComponent<RectTransform>();
            viewportRect.anchorMin = Vector2.zero;
            viewportRect.anchorMax = Vector2.one;
            viewportRect.offsetMin = new Vector2(0f, 0f);
            viewportRect.offsetMax = new Vector2(-18f, 0f);

            viewportObj.AddComponent<RectMask2D>();

            GameObject contentObj = new GameObject("Content");
            contentObj.transform.SetParent(viewportObj.transform, false);
            RectTransform contentRect = contentObj.AddComponent<RectTransform>();
            contentRect.anchorMin = new Vector2(0f, 1f);
            contentRect.anchorMax = new Vector2(1f, 1f);
            contentRect.pivot = new Vector2(0.5f, 1f);
            contentRect.sizeDelta = new Vector2(0f, 150f);

            VerticalLayoutGroup contentLayout = contentObj.AddComponent<VerticalLayoutGroup>();
            contentLayout.childControlHeight = true;
            contentLayout.childControlWidth = true;
            contentLayout.childForceExpandHeight = false;
            contentLayout.childForceExpandWidth = true;

            ContentSizeFitter contentFitter = contentObj.AddComponent<ContentSizeFitter>();
            contentFitter.verticalFit = ContentSizeFitter.FitMode.PreferredSize;

            GameObject itemObj = new GameObject("Item");
            itemObj.transform.SetParent(contentObj.transform, false);
            RectTransform itemRect = itemObj.AddComponent<RectTransform>();
            itemRect.sizeDelta = new Vector2(0f, 40f);

            Toggle itemToggle = itemObj.AddComponent<Toggle>();
            itemToggle.isOn = true;

            Image itemBg = itemObj.AddComponent<Image>();
            itemBg.color = new Color(0.059f, 0.09f, 0.165f, 1f);

            GameObject itemLabelObj = new GameObject("ItemLabel");
            itemLabelObj.transform.SetParent(itemObj.transform, false);
            RectTransform itemLabelRect = itemLabelObj.AddComponent<RectTransform>();
            itemLabelRect.anchorMin = Vector2.zero;
            itemLabelRect.anchorMax = Vector2.one;
            itemLabelRect.offsetMin = new Vector2(20f, 0f);
            itemLabelRect.offsetMax = Vector2.zero;

            TextMeshProUGUI itemLabel = itemLabelObj.AddComponent<TextMeshProUGUI>();
            itemLabel.fontSize = 20f;
            itemLabel.color = _textColor;

            itemToggle.targetGraphic = itemBg;
            itemToggle.graphic = itemBg;

            GameObject captionObj = new GameObject("Caption");
            captionObj.transform.SetParent(dropdownObj.transform, false);
            RectTransform captionRect = captionObj.AddComponent<RectTransform>();
            captionRect.anchorMin = new Vector2(0.4f, 0f);
            captionRect.anchorMax = new Vector2(1f, 1f);
            captionRect.offsetMin = new Vector2(10f, 0f);
            captionRect.offsetMax = new Vector2(-40f, 0f);

            TextMeshProUGUI captionTMP = captionObj.AddComponent<TextMeshProUGUI>();
            captionTMP.fontSize = 20f;
            captionTMP.alignment = TextAlignmentOptions.MidlineLeft;
            captionTMP.color = _textColor;

            GameObject arrowObj = new GameObject("Arrow");
            arrowObj.transform.SetParent(dropdownObj.transform, false);
            RectTransform arrowRect = arrowObj.AddComponent<RectTransform>();
            arrowRect.anchorMin = new Vector2(1f, 0.5f);
            arrowRect.anchorMax = new Vector2(1f, 0.5f);
            arrowRect.sizeDelta = new Vector2(30f, 30f);
            arrowRect.anchoredPosition = new Vector2(-10f, 0f);

            TextMeshProUGUI arrowTMP = arrowObj.AddComponent<TextMeshProUGUI>();
            arrowTMP.text = "▼";
            arrowTMP.fontSize = 20f;
            arrowTMP.alignment = TextAlignmentOptions.Center;
            arrowTMP.color = _primaryColor;

            _maxPlayersDropdown.targetGraphic = dropdownBg;
            _maxPlayersDropdown.template = templateRect;
            _maxPlayersDropdown.captionText = captionTMP;
            _maxPlayersDropdown.itemText = itemLabel;

            _maxPlayersDropdown.options.Clear();
            _maxPlayersDropdown.options.Add(new TMP_Dropdown.OptionData("2 人"));
            _maxPlayersDropdown.options.Add(new TMP_Dropdown.OptionData("3 人"));
            _maxPlayersDropdown.options.Add(new TMP_Dropdown.OptionData("4 人"));
            _maxPlayersDropdown.value = _maxPlayers - 2;
            _maxPlayersDropdown.RefreshShownValue();

            templateRect.gameObject.SetActive(false);
        }

        /// <summary>
        /// 创建地图选择下拉菜单
        /// </summary>
        private void CreateMapDropdown(Transform parent)
        {
            GameObject dropdownObj = new GameObject("MapDropdown");
            dropdownObj.transform.SetParent(parent, false);

            RectTransform dropdownRect = dropdownObj.AddComponent<RectTransform>();
            dropdownRect.anchorMin = new Vector2(0f, 0.5f);
            dropdownRect.anchorMax = new Vector2(1f, 0.5f);
            dropdownRect.sizeDelta = new Vector2(0f, 80f);
            dropdownRect.anchoredPosition = new Vector2(0f, -60f);

            GameObject labelObj = new GameObject("Label");
            labelObj.transform.SetParent(dropdownObj.transform, false);
            RectTransform labelRect = labelObj.AddComponent<RectTransform>();
            labelRect.anchorMin = new Vector2(0f, 0.5f);
            labelRect.anchorMax = new Vector2(0.4f, 1f);
            labelRect.offsetMin = new Vector2(20f, 0f);
            labelRect.offsetMax = Vector2.zero;

            TextMeshProUGUI labelTMP = labelObj.AddComponent<TextMeshProUGUI>();
            labelTMP.text = "选择地图";
            labelTMP.fontSize = 20f;
            labelTMP.alignment = TextAlignmentOptions.MidlineLeft;
            labelTMP.color = _textColor;

            _mapDropdown = dropdownObj.AddComponent<TMP_Dropdown>();

            Image dropdownBg = dropdownObj.AddComponent<Image>();
            dropdownBg.color = new Color(0.02f, 0.04f, 0.08f, 1f);
            dropdownBg.sprite = CreateRoundedSprite(6);
            dropdownBg.type = Image.Type.Sliced;

            RectTransform templateRect = new GameObject("Template").AddComponent<RectTransform>();
            templateRect.SetParent(dropdownObj.transform, false);
            templateRect.anchorMin = new Vector2(0f, 0f);
            templateRect.anchorMax = new Vector2(1f, 0f);
            templateRect.pivot = new Vector2(0.5f, 1f);
            templateRect.sizeDelta = new Vector2(0f, 150f);
            templateRect.anchoredPosition = new Vector2(0f, 0f);

            Image templateBg = templateRect.gameObject.AddComponent<Image>();
            templateBg.color = new Color(0.059f, 0.09f, 0.165f, 1f);

            templateRect.gameObject.AddComponent<RectMask2D>();

            GameObject viewportObj = new GameObject("Viewport");
            viewportObj.transform.SetParent(templateRect.transform, false);
            RectTransform viewportRect = viewportObj.AddComponent<RectTransform>();
            viewportRect.anchorMin = Vector2.zero;
            viewportRect.anchorMax = Vector2.one;
            viewportRect.offsetMin = new Vector2(0f, 0f);
            viewportRect.offsetMax = new Vector2(-18f, 0f);

            viewportObj.AddComponent<RectMask2D>();

            GameObject contentObj = new GameObject("Content");
            contentObj.transform.SetParent(viewportObj.transform, false);
            RectTransform contentRect = contentObj.AddComponent<RectTransform>();
            contentRect.anchorMin = new Vector2(0f, 1f);
            contentRect.anchorMax = new Vector2(1f, 1f);
            contentRect.pivot = new Vector2(0.5f, 1f);
            contentRect.sizeDelta = new Vector2(0f, 150f);

            VerticalLayoutGroup contentLayout = contentObj.AddComponent<VerticalLayoutGroup>();
            contentLayout.childControlHeight = true;
            contentLayout.childControlWidth = true;
            contentLayout.childForceExpandHeight = false;
            contentLayout.childForceExpandWidth = true;

            ContentSizeFitter contentFitter = contentObj.AddComponent<ContentSizeFitter>();
            contentFitter.verticalFit = ContentSizeFitter.FitMode.PreferredSize;

            GameObject itemObj = new GameObject("Item");
            itemObj.transform.SetParent(contentObj.transform, false);
            RectTransform itemRect = itemObj.AddComponent<RectTransform>();
            itemRect.sizeDelta = new Vector2(0f, 40f);

            Toggle itemToggle = itemObj.AddComponent<Toggle>();
            itemToggle.isOn = true;

            Image itemBg = itemObj.AddComponent<Image>();
            itemBg.color = new Color(0.059f, 0.09f, 0.165f, 1f);

            GameObject itemLabelObj = new GameObject("ItemLabel");
            itemLabelObj.transform.SetParent(itemObj.transform, false);
            RectTransform itemLabelRect = itemLabelObj.AddComponent<RectTransform>();
            itemLabelRect.anchorMin = Vector2.zero;
            itemLabelRect.anchorMax = Vector2.one;
            itemLabelRect.offsetMin = new Vector2(20f, 0f);
            itemLabelRect.offsetMax = Vector2.zero;

            TextMeshProUGUI itemLabel = itemLabelObj.AddComponent<TextMeshProUGUI>();
            itemLabel.fontSize = 20f;
            itemLabel.color = _textColor;

            itemToggle.targetGraphic = itemBg;
            itemToggle.graphic = itemBg;

            GameObject captionObj = new GameObject("Caption");
            captionObj.transform.SetParent(dropdownObj.transform, false);
            RectTransform captionRect = captionObj.AddComponent<RectTransform>();
            captionRect.anchorMin = new Vector2(0.4f, 0f);
            captionRect.anchorMax = new Vector2(1f, 1f);
            captionRect.offsetMin = new Vector2(10f, 0f);
            captionRect.offsetMax = new Vector2(-40f, 0f);

            TextMeshProUGUI captionTMP = captionObj.AddComponent<TextMeshProUGUI>();
            captionTMP.fontSize = 20f;
            captionTMP.alignment = TextAlignmentOptions.MidlineLeft;
            captionTMP.color = _textColor;

            GameObject arrowObj = new GameObject("Arrow");
            arrowObj.transform.SetParent(dropdownObj.transform, false);
            RectTransform arrowRect = arrowObj.AddComponent<RectTransform>();
            arrowRect.anchorMin = new Vector2(1f, 0.5f);
            arrowRect.anchorMax = new Vector2(1f, 0.5f);
            arrowRect.sizeDelta = new Vector2(30f, 30f);
            arrowRect.anchoredPosition = new Vector2(-10f, 0f);

            TextMeshProUGUI arrowTMP = arrowObj.AddComponent<TextMeshProUGUI>();
            arrowTMP.text = "▼";
            arrowTMP.fontSize = 20f;
            arrowTMP.alignment = TextAlignmentOptions.Center;
            arrowTMP.color = _primaryColor;

            _mapDropdown.targetGraphic = dropdownBg;
            _mapDropdown.template = templateRect;
            _mapDropdown.captionText = captionTMP;
            _mapDropdown.itemText = itemLabel;

            _mapDropdown.options.Clear();
            _mapDropdown.options.Add(new TMP_Dropdown.OptionData("标准战场"));
            _mapDropdown.options.Add(new TMP_Dropdown.OptionData("沙漠战场"));
            _mapDropdown.options.Add(new TMP_Dropdown.OptionData("雪地战场"));
            _mapDropdown.options.Add(new TMP_Dropdown.OptionData("城市战场"));
            _mapDropdown.value = 0;
            _mapDropdown.RefreshShownValue();

            templateRect.gameObject.SetActive(false);
        }

        /// <summary>
        /// 创建底部按钮
        /// </summary>
        private void CreateBottomButtons()
        {
            GameObject buttonsObj = new GameObject("BottomButtons");
            buttonsObj.transform.SetParent(transform, false);

            RectTransform buttonsRect = buttonsObj.AddComponent<RectTransform>();
            buttonsRect.anchorMin = new Vector2(0f, 0f);
            buttonsRect.anchorMax = new Vector2(1f, 0f);
            buttonsRect.sizeDelta = new Vector2(0f, 100f);
            buttonsRect.pivot = new Vector2(0.5f, 0f);
            buttonsRect.anchoredPosition = Vector2.zero;

            _readyBtn = CreateButton("ReadyBtn", "准备", _successColor,
                buttonsObj.transform, new Vector2(0.3f, 0.5f), new Vector2(160f, 50f), 24f);

            _startGameBtn = CreateButton("StartGameBtn", "开始游戏", _accentColor,
                buttonsObj.transform, new Vector2(0.5f, 0.5f), new Vector2(180f, 50f), 24f);
            _startGameBtn.gameObject.SetActive(_isRoomOwner);

            _leaveRoomBtn = CreateButton("LeaveBtn", "离开房间", _dangerColor,
                buttonsObj.transform, new Vector2(0.7f, 0.5f), new Vector2(160f, 50f), 24f);

            _readyBtnText = _readyBtn.GetComponentInChildren<TextMeshProUGUI>();
        }

        /// <summary>
        /// 创建通用按钮
        /// </summary>
        private Button CreateButton(string name, string text, Color color,
            Transform parent, Vector2 anchor, Vector2 size, float fontSize)
        {
            GameObject btnObj = new GameObject(name);
            btnObj.transform.SetParent(parent, false);

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
            colors.fadeDuration = 0.2f;
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
            textTMP.fontSize = fontSize;
            textTMP.alignment = TextAlignmentOptions.Center;
            textTMP.color = Color.white;
            textTMP.fontStyle = FontStyles.Bold;

            UIButtonEffects effects = btnObj.AddComponent<UIButtonEffects>();
            effects.Setup(bgImage, textTMP, color, 1.05f, 0.2f);

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
            if (_copyRoomCodeBtn != null)
            {
                _copyRoomCodeBtn.onClick.AddListener(OnCopyRoomCode);
            }

            if (_readyBtn != null)
            {
                _readyBtn.onClick.AddListener(OnReadyClicked);
            }

            if (_startGameBtn != null)
            {
                _startGameBtn.onClick.AddListener(OnStartGameClicked);
            }

            if (_leaveRoomBtn != null)
            {
                _leaveRoomBtn.onClick.AddListener(OnLeaveRoomClicked);
            }

            if (_maxPlayersDropdown != null)
            {
                _maxPlayersDropdown.onValueChanged.AddListener(OnMaxPlayersDropdownChanged);
            }

            if (_mapDropdown != null)
            {
                _mapDropdown.onValueChanged.AddListener(OnMapDropdownChanged);
            }
        }

        /// <summary>
        /// 取消事件注册
        /// </summary>
        protected override void UnregisterEvents()
        {
            if (_copyRoomCodeBtn != null)
            {
                _copyRoomCodeBtn.onClick.RemoveListener(OnCopyRoomCode);
            }

            if (_readyBtn != null)
            {
                _readyBtn.onClick.RemoveListener(OnReadyClicked);
            }

            if (_startGameBtn != null)
            {
                _startGameBtn.onClick.RemoveListener(OnStartGameClicked);
            }

            if (_leaveRoomBtn != null)
            {
                _leaveRoomBtn.onClick.RemoveListener(OnLeaveRoomClicked);
            }

            if (_maxPlayersDropdown != null)
            {
                _maxPlayersDropdown.onValueChanged.RemoveListener(OnMaxPlayersDropdownChanged);
            }

            if (_mapDropdown != null)
            {
                _mapDropdown.onValueChanged.RemoveListener(OnMapDropdownChanged);
            }
        }

        /// <summary>
        /// 复制房间号
        /// </summary>
        private void OnCopyRoomCode()
        {
            GUIUtility.systemCopyBuffer = _roomCode;
            Debug.Log($"房间号 {_roomCode} 已复制到剪贴板");
        }

        /// <summary>
        /// 准备按钮点击
        /// </summary>
        private void OnReadyClicked()
        {
            _isReady = !_isReady;
            UpdateReadyButton();

            if (_isReady)
            {
                OnReady?.Invoke();
            }
            else
            {
                OnCancelReady?.Invoke();
            }
        }

        /// <summary>
        /// 更新准备按钮显示
        /// </summary>
        private void UpdateReadyButton()
        {
            if (_readyBtnText == null) return;

            _readyBtnText.text = _isReady ? "取消准备" : "准备";

            Image btnImage = _readyBtn.GetComponent<Image>();
            if (btnImage != null)
            {
                btnImage.color = _isReady ?
                    new Color(_dangerColor.r, _dangerColor.g, _dangerColor.b, 0.8f) :
                    new Color(_successColor.r, _successColor.g, _successColor.b, 0.8f);
            }
        }

        /// <summary>
        /// 开始游戏按钮点击
        /// </summary>
        private void OnStartGameClicked()
        {
            if (!_isRoomOwner)
            {
                Debug.LogWarning("只有房主可以开始游戏");
                return;
            }

            OnStartGame?.Invoke();
        }

        /// <summary>
        /// 离开房间按钮点击
        /// </summary>
        private void OnLeaveRoomClicked()
        {
            OnLeaveRoom?.Invoke();
        }

        /// <summary>
        /// 最大玩家数变化
        /// </summary>
        private void OnMaxPlayersDropdownChanged(int value)
        {
            _maxPlayers = value + 2;
            OnMaxPlayersChanged?.Invoke(_maxPlayers);
        }

        /// <summary>
        /// 地图选择变化
        /// </summary>
        private void OnMapDropdownChanged(int value)
        {
            _selectedMap = _mapDropdown.options[value].text;
            OnMapChanged?.Invoke(_selectedMap);
        }

        /// <summary>
        /// 设置房间号
        /// </summary>
        public void SetRoomCode(string roomCode)
        {
            _roomCode = roomCode;
            if (_roomCodeText != null)
            {
                _roomCodeText.text = $"房间号: {_roomCode}";
            }
        }

        /// <summary>
        /// 设置是否为房主
        /// </summary>
        public void SetRoomOwner(bool isOwner)
        {
            _isRoomOwner = isOwner;
            if (_startGameBtn != null)
            {
                _startGameBtn.gameObject.SetActive(_isRoomOwner);
            }

            if (_maxPlayersDropdown != null)
            {
                _maxPlayersDropdown.interactable = _isRoomOwner;
            }

            if (_mapDropdown != null)
            {
                _mapDropdown.interactable = _isRoomOwner;
            }
        }

        /// <summary>
        /// 更新玩家列表
        /// </summary>
        public void UpdatePlayerList(List<Player> players, string localPlayerId)
        {
            _players = players;

            foreach (var item in _playerItems)
            {
                if (item != null && item.gameObject != null)
                {
                    Destroy(item.gameObject);
                }
            }
            _playerItems.Clear();

            for (int i = 0; i < players.Count; i++)
            {
                Player player = players[i];
                Color playerColor = _playerColors[i % _playerColors.Length];
                bool isLocalPlayer = player.ID == localPlayerId;

                GameObject itemObj = new GameObject($"PlayerItem_{player.ID}");
                itemObj.transform.SetParent(_playerListContainer, false);

                RectTransform itemRect = itemObj.AddComponent<RectTransform>();
                itemRect.sizeDelta = new Vector2(0f, 70f);

                PlayerListItem listItem = itemObj.AddComponent<PlayerListItem>();
                listItem.Initialize(player, playerColor, isLocalPlayer);
                _playerItems.Add(listItem);
            }
        }

        /// <summary>
        /// 更新单个玩家准备状态
        /// </summary>
        public void UpdatePlayerReadyStatus(string playerId, bool isReady)
        {
            foreach (var item in _playerItems)
            {
                if (item.PlayerId == playerId)
                {
                    item.UpdateReadyStatus(isReady);
                    break;
                }
            }
        }

        /// <summary>
        /// 设置准备按钮状态
        /// </summary>
        public void SetReadyButtonEnabled(bool enabled)
        {
            if (_readyBtn != null)
            {
                _readyBtn.interactable = enabled;
            }
        }

        /// <summary>
        /// 设置开始游戏按钮状态
        /// </summary>
        public void SetStartGameButtonEnabled(bool enabled)
        {
            if (_startGameBtn != null)
            {
                _startGameBtn.interactable = enabled;
            }
        }
    }

    /// <summary>
    /// 玩家列表项
    /// </summary>
    public class PlayerListItem : MonoBehaviour
    {
        public string PlayerId { get; private set; }
        public bool IsReady { get; private set; }

        private TextMeshProUGUI _nameText;
        private Image _avatarImage;
        private Image _readyIndicator;
        private Image _colorMarker;

        public void Initialize(Player player, Color color, bool isLocalPlayer)
        {
            PlayerId = player.ID;
            IsReady = player.Ready;

            RectTransform rect = GetComponent<RectTransform>();

            Image bgImage = gameObject.AddComponent<Image>();
            bgImage.color = isLocalPlayer ?
                new Color(color.r, color.g, color.b, 0.15f) :
                new Color(0.02f, 0.04f, 0.08f, 0.8f);
            bgImage.sprite = CreateRoundedSprite(8);
            bgImage.type = Image.Type.Sliced;

            Outline outline = gameObject.AddComponent<Outline>();
            outline.effectColor = new Color(color.r, color.g, color.b, isLocalPlayer ? 0.8f : 0.3f);
            outline.effectDistance = new Vector2(2f, 2f);

            GameObject avatarObj = new GameObject("Avatar");
            avatarObj.transform.SetParent(transform, false);
            RectTransform avatarRect = avatarObj.AddComponent<RectTransform>();
            avatarRect.anchorMin = new Vector2(0f, 0.5f);
            avatarRect.anchorMax = new Vector2(0f, 0.5f);
            avatarRect.sizeDelta = new Vector2(50f, 50f);
            avatarRect.anchoredPosition = new Vector2(45f, 0f);

            _avatarImage = avatarObj.AddComponent<Image>();
            _avatarImage.color = color;
            _avatarImage.sprite = CreateCircleSprite(25);

            GameObject avatarIconObj = new GameObject("Icon");
            avatarIconObj.transform.SetParent(avatarObj.transform, false);
            RectTransform avatarIconRect = avatarIconObj.AddComponent<RectTransform>();
            avatarIconRect.anchorMin = Vector2.zero;
            avatarIconRect.anchorMax = Vector2.one;
            avatarIconRect.offsetMin = Vector2.zero;
            avatarIconRect.offsetMax = Vector2.zero;

            TextMeshProUGUI avatarIcon = avatarIconObj.AddComponent<TextMeshProUGUI>();
            avatarIcon.text = player.Name.Length > 0 ? player.Name[0].ToString().ToUpper() : "P";
            avatarIcon.fontSize = 28f;
            avatarIcon.alignment = TextAlignmentOptions.Center;
            avatarIcon.color = Color.white;
            avatarIcon.fontStyle = FontStyles.Bold;

            _colorMarker = _avatarImage;

            GameObject nameObj = new GameObject("Name");
            nameObj.transform.SetParent(transform, false);
            RectTransform nameRect = nameObj.AddComponent<RectTransform>();
            nameRect.anchorMin = new Vector2(0.15f, 0f);
            nameRect.anchorMax = new Vector2(0.7f, 1f);
            nameRect.offsetMin = new Vector2(10f, 0f);
            nameRect.offsetMax = Vector2.zero;

            _nameText = nameObj.AddComponent<TextMeshProUGUI>();
            _nameText.text = player.Name + (isLocalPlayer ? " (你)" : "");
            _nameText.fontSize = 22f;
            _nameText.alignment = TextAlignmentOptions.MidlineLeft;
            _nameText.color = isLocalPlayer ? color : new Color(0.9f, 0.95f, 1f, 1f);

            GameObject readyObj = new GameObject("ReadyIndicator");
            readyObj.transform.SetParent(transform, false);
            RectTransform readyRect = readyObj.AddComponent<RectTransform>();
            readyRect.anchorMin = new Vector2(0.85f, 0.5f);
            readyRect.anchorMax = new Vector2(0.85f, 0.5f);
            readyRect.sizeDelta = new Vector2(120f, 30f);
            readyRect.anchoredPosition = Vector2.zero;

            _readyIndicator = readyObj.AddComponent<Image>();
            _readyIndicator.color = IsReady ?
                new Color(0.345f, 0.875f, 0.42f, 0.8f) :
                new Color(0.5f, 0.5f, 0.5f, 0.5f);
            _readyIndicator.sprite = CreateRoundedSprite(15);
            _readyIndicator.type = Image.Type.Sliced;

            GameObject readyTextObj = new GameObject("Text");
            readyTextObj.transform.SetParent(readyObj.transform, false);
            RectTransform readyTextRect = readyTextObj.AddComponent<RectTransform>();
            readyTextRect.anchorMin = Vector2.zero;
            readyTextRect.anchorMax = Vector2.one;
            readyTextRect.offsetMin = Vector2.zero;
            readyTextRect.offsetMax = Vector2.zero;

            TextMeshProUGUI readyText = readyTextObj.AddComponent<TextMeshProUGUI>();
            readyText.text = IsReady ? "已准备" : "未准备";
            readyText.fontSize = 16f;
            readyText.alignment = TextAlignmentOptions.Center;
            readyText.color = Color.white;
            readyText.fontStyle = FontStyles.Bold;
        }

        public void UpdateReadyStatus(bool isReady)
        {
            IsReady = isReady;

            if (_readyIndicator != null)
            {
                _readyIndicator.color = IsReady ?
                    new Color(0.345f, 0.875f, 0.42f, 0.8f) :
                    new Color(0.5f, 0.5f, 0.5f, 0.5f);
            }

            TextMeshProUGUI readyText = GetComponentInChildren<TextMeshProUGUI>();
            if (readyText != null && readyText.name == "Text")
            {
                readyText.text = IsReady ? "已准备" : "未准备";
            }
        }

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

        private Sprite CreateCircleSprite(int radius)
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

            return Sprite.Create(tex, new Rect(0, 0, size, size), new Vector2(0.5f, 0.5f));
        }
    }
}
