using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.EventSystems;
using TMPro;
using Protocol;
using Game;

namespace UI
{
    /// <summary>
    /// 游戏HUD界面
    /// 显示资源、单位列表、建造菜单、回合信息和小地图
    /// </summary>
    public class GameHUDUI : BasePanel
    {
        [Header("资源面板")]
        [SerializeField] private TextMeshProUGUI _crystalText;
        [SerializeField] private TextMeshProUGUI _energyText;
        [SerializeField] private TextMeshProUGUI _goldText;
        [SerializeField] private TextMeshProUGUI _foodText;

        [Header("回合信息")]
        [SerializeField] private TextMeshProUGUI _roundText;
        [SerializeField] private TextMeshProUGUI _phaseText;
        [SerializeField] private TextMeshProUGUI _countdownText;
        [SerializeField] private Image _countdownBar;

        [Header("单位列表")]
        [SerializeField] private Transform _unitListContainer;
        [SerializeField] private TextMeshProUGUI _selectedUnitName;
        [SerializeField] private TextMeshProUGUI _selectedUnitHP;
        [SerializeField] private TextMeshProUGUI _selectedUnitAttack;
        [SerializeField] private TextMeshProUGUI _selectedUnitSpeed;

        [Header("建造菜单")]
        [SerializeField] private Transform _buildMenuContainer;

        [Header("小地图")]
        [SerializeField] private RawImage _minimapImage;
        [SerializeField] private RectTransform _minimapBlipContainer;

        [Header("颜色配置")]
        [SerializeField] private Color _primaryColor = new Color(0.024f, 0.714f, 0.831f, 1f);
        [SerializeField] private Color _accentColor = new Color(0.961f, 0.62f, 0.043f, 1f);
        [SerializeField] private Color _dangerColor = new Color(0.937f, 0.267f, 0.267f, 1f);
        [SerializeField] private Color _successColor = new Color(0.345f, 0.875f, 0.42f, 1f);
        [SerializeField] private Color _panelBgColor = new Color(0.059f, 0.09f, 0.165f, 0.85f);
        [SerializeField] private Color _textColor = new Color(0.9f, 0.95f, 1f, 1f);

        [Header("玩家颜色")]
        [SerializeField] private Color[] _playerColors = new Color[]
        {
            new Color(0.024f, 0.714f, 0.831f, 1f),
            new Color(0.937f, 0.267f, 0.267f, 1f),
            new Color(0.345f, 0.875f, 0.42f, 1f),
            new Color(0.961f, 0.62f, 0.043f, 1f)
        };

        public event Action<string> OnBuildRequested;
        public event Action<Unit> OnUnitSelected;

        private readonly List<UnitListItem> _unitItems = new List<UnitListItem>();
        private readonly List<GameObject> _minimapBlips = new List<GameObject>();
        private Unit _selectedUnit;
        private float _phaseCountdown = 10f;
        private float _maxPhaseTime = 10f;

        protected override void Awake()
        {
            base.Awake();
            _panelType = UIPanelType.GameHUD;
        }

        /// <summary>
        /// 设置UI元素
        /// </summary>
        protected override void SetupUI()
        {
            SetupPanelStyle();

            CreateResourcePanel();
            CreateTurnInfoPanel();
            CreateUnitListPanel();
            CreateBuildMenu();
            CreateMinimap();
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
        }

        /// <summary>
        /// 创建资源面板（左上角）
        /// </summary>
        private void CreateResourcePanel()
        {
            GameObject panelObj = new GameObject("ResourcePanel");
            panelObj.transform.SetParent(transform, false);

            RectTransform panelRect = panelObj.AddComponent<RectTransform>();
            panelRect.anchorMin = new Vector2(0f, 1f);
            panelRect.anchorMax = new Vector2(0f, 1f);
            panelRect.pivot = new Vector2(0f, 1f);
            panelRect.sizeDelta = new Vector2(280f, 100f);
            panelRect.anchoredPosition = new Vector2(20f, -20f);

            Image panelBg = panelObj.AddComponent<Image>();
            panelBg.color = _panelBgColor;
            panelBg.sprite = CreateRoundedSprite(12);
            panelBg.type = Image.Type.Sliced;

            Outline panelOutline = panelObj.AddComponent<Outline>();
            panelOutline.effectColor = new Color(_primaryColor.r, _primaryColor.g, _primaryColor.b, 0.5f);
            panelOutline.effectDistance = new Vector2(2f, 2f);

            CreateResourceItem(panelObj.transform, "Crystal", "水晶", 500, _accentColor, new Vector2(0.25f, 0.75f), ref _crystalText);
            CreateResourceItem(panelObj.transform, "Energy", "能量", 300, _primaryColor, new Vector2(0.75f, 0.75f), ref _energyText);
            CreateResourceItem(panelObj.transform, "Gold", "金币", 1000, _successColor, new Vector2(0.25f, 0.25f), ref _goldText);
            CreateResourceItem(panelObj.transform, "Food", "食物", 500, new Color(0.8f, 0.4f, 0.1f, 1f), new Vector2(0.75f, 0.25f), ref _foodText);
        }

        /// <summary>
        /// 创建资源项
        /// </summary>
        private void CreateResourceItem(Transform parent, string name, string label, int value, Color color, Vector2 anchor, ref TextMeshProUGUI valueText)
        {
            GameObject itemObj = new GameObject($"Resource_{name}");
            itemObj.transform.SetParent(parent, false);

            RectTransform itemRect = itemObj.AddComponent<RectTransform>();
            itemRect.anchorMin = anchor;
            itemRect.anchorMax = anchor;
            itemRect.sizeDelta = new Vector2(120f, 40f);
            itemRect.anchoredPosition = Vector2.zero;

            GameObject iconObj = new GameObject("Icon");
            iconObj.transform.SetParent(itemObj.transform, false);
            RectTransform iconRect = iconObj.AddComponent<RectTransform>();
            iconRect.anchorMin = new Vector2(0f, 0.5f);
            iconRect.anchorMax = new Vector2(0f, 0.5f);
            iconRect.sizeDelta = new Vector2(24f, 24f);
            iconRect.anchoredPosition = new Vector2(15f, 0f);

            Image iconImage = iconObj.AddComponent<Image>();
            iconImage.color = color;
            iconImage.sprite = CreateCircleSprite(12);

            GameObject labelObj = new GameObject("Label");
            labelObj.transform.SetParent(itemObj.transform, false);
            RectTransform labelRect = labelObj.AddComponent<RectTransform>();
            labelRect.anchorMin = new Vector2(0.3f, 0.5f);
            labelRect.anchorMax = new Vector2(0.6f, 0.5f);
            labelRect.sizeDelta = new Vector2(0f, 20f);
            labelRect.anchoredPosition = Vector2.zero;

            TextMeshProUGUI labelTMP = labelObj.AddComponent<TextMeshProUGUI>();
            labelTMP.text = label;
            labelTMP.fontSize = 14f;
            labelTMP.alignment = TextAlignmentOptions.MidlineLeft;
            labelTMP.color = new Color(0.6f, 0.7f, 0.8f, 1f);

            GameObject valueObj = new GameObject("Value");
            valueObj.transform.SetParent(itemObj.transform, false);
            RectTransform valueRect = valueObj.AddComponent<RectTransform>();
            valueRect.anchorMin = new Vector2(0.6f, 0.5f);
            valueRect.anchorMax = new Vector2(1f, 0.5f);
            valueRect.sizeDelta = new Vector2(0f, 24f);
            valueRect.anchoredPosition = Vector2.zero;

            valueText = valueObj.AddComponent<TextMeshProUGUI>();
            valueText.text = value.ToString();
            valueText.fontSize = 20f;
            valueText.alignment = TextAlignmentOptions.MidlineRight;
            valueText.color = color;
            valueText.fontStyle = FontStyles.Bold;
        }

        /// <summary>
        /// 创建回合信息面板（右上角）
        /// </summary>
        private void CreateTurnInfoPanel()
        {
            GameObject panelObj = new GameObject("TurnInfoPanel");
            panelObj.transform.SetParent(transform, false);

            RectTransform panelRect = panelObj.AddComponent<RectTransform>();
            panelRect.anchorMin = new Vector2(1f, 1f);
            panelRect.anchorMax = new Vector2(1f, 1f);
            panelRect.pivot = new Vector2(1f, 1f);
            panelRect.sizeDelta = new Vector2(280f, 120f);
            panelRect.anchoredPosition = new Vector2(-20f, -20f);

            Image panelBg = panelObj.AddComponent<Image>();
            panelBg.color = _panelBgColor;
            panelBg.sprite = CreateRoundedSprite(12);
            panelBg.type = Image.Type.Sliced;

            Outline panelOutline = panelObj.AddComponent<Outline>();
            panelOutline.effectColor = new Color(_accentColor.r, _accentColor.g, _accentColor.b, 0.5f);
            panelOutline.effectDistance = new Vector2(2f, 2f);

            GameObject roundObj = new GameObject("RoundInfo");
            roundObj.transform.SetParent(panelObj.transform, false);
            RectTransform roundRect = roundObj.AddComponent<RectTransform>();
            roundRect.anchorMin = new Vector2(0f, 0.7f);
            roundRect.anchorMax = new Vector2(1f, 1f);
            roundRect.offsetMin = new Vector2(15f, 0f);
            roundRect.offsetMax = new Vector2(-15f, 0f);

            _roundText = roundObj.AddComponent<TextMeshProUGUI>();
            _roundText.text = "第 1 回合";
            _roundText.fontSize = 22f;
            _roundText.alignment = TextAlignmentOptions.MidlineLeft;
            _roundText.color = _textColor;
            _roundText.fontStyle = FontStyles.Bold;

            GameObject phaseObj = new GameObject("PhaseInfo");
            phaseObj.transform.SetParent(panelObj.transform, false);
            RectTransform phaseRect = phaseObj.AddComponent<RectTransform>();
            phaseRect.anchorMin = new Vector2(0f, 0.4f);
            phaseRect.anchorMax = new Vector2(1f, 0.7f);
            phaseRect.offsetMin = new Vector2(15f, 0f);
            phaseRect.offsetMax = new Vector2(-15f, 0f);

            _phaseText = phaseObj.AddComponent<TextMeshProUGUI>();
            _phaseText.text = "规划阶段";
            _phaseText.fontSize = 18f;
            _phaseText.alignment = TextAlignmentOptions.MidlineLeft;
            _phaseText.color = _primaryColor;

            GameObject countdownBarObj = new GameObject("CountdownBar");
            countdownBarObj.transform.SetParent(panelObj.transform, false);
            RectTransform countdownBarRect = countdownBarObj.AddComponent<RectTransform>();
            countdownBarRect.anchorMin = new Vector2(0f, 0.15f);
            countdownBarRect.anchorMax = new Vector2(1f, 0.35f);
            countdownBarRect.offsetMin = new Vector2(15f, 0f);
            countdownBarRect.offsetMax = new Vector2(-15f, 0f);

            Image countdownBg = countdownBarObj.AddComponent<Image>();
            countdownBg.color = new Color(0f, 0f, 0f, 0.3f);
            countdownBg.sprite = CreateRoundedSprite(8);
            countdownBg.type = Image.Type.Sliced;

            GameObject fillObj = new GameObject("Fill");
            fillObj.transform.SetParent(countdownBarObj.transform, false);
            RectTransform fillRect = fillObj.AddComponent<RectTransform>();
            fillRect.anchorMin = Vector2.zero;
            fillRect.anchorMax = Vector2.one;
            fillRect.offsetMin = Vector2.zero;
            fillRect.offsetMax = Vector2.zero;
            fillRect.pivot = new Vector2(0f, 0.5f);

            _countdownBar = fillObj.AddComponent<Image>();
            _countdownBar.color = _primaryColor;
            _countdownBar.sprite = CreateRoundedSprite(8);
            _countdownBar.type = Image.Type.Sliced;
            _countdownBar.fillMethod = Image.FillMethod.Horizontal;
            _countdownBar.fillOrigin = (int)Image.OriginHorizontal.Left;
            _countdownBar.fillAmount = 1f;

            GameObject countdownObj = new GameObject("Countdown");
            countdownObj.transform.SetParent(panelObj.transform, false);
            RectTransform countdownRect = countdownObj.AddComponent<RectTransform>();
            countdownRect.anchorMin = new Vector2(0f, 0f);
            countdownRect.anchorMax = new Vector2(1f, 0.15f);
            countdownRect.offsetMin = new Vector2(15f, 0f);
            countdownRect.offsetMax = new Vector2(-15f, 0f);

            _countdownText = countdownObj.AddComponent<TextMeshProUGUI>();
            _countdownText.text = "10.0s";
            _countdownText.fontSize = 16f;
            _countdownText.alignment = TextAlignmentOptions.MidlineRight;
            _countdownText.color = _textColor;
            _countdownText.fontStyle = FontStyles.Bold;
        }

        /// <summary>
        /// 创建单位列表面板（左下角）
        /// </summary>
        private void CreateUnitListPanel()
        {
            GameObject panelObj = new GameObject("UnitListPanel");
            panelObj.transform.SetParent(transform, false);

            RectTransform panelRect = panelObj.AddComponent<RectTransform>();
            panelRect.anchorMin = new Vector2(0f, 0f);
            panelRect.anchorMax = new Vector2(0f, 0f);
            panelRect.pivot = new Vector2(0f, 0f);
            panelRect.sizeDelta = new Vector2(280f, 300f);
            panelRect.anchoredPosition = new Vector2(20f, 20f);

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
            titleRect.sizeDelta = new Vector2(0f, 40f);
            titleRect.pivot = new Vector2(0.5f, 1f);
            titleRect.anchoredPosition = Vector2.zero;

            TextMeshProUGUI titleTMP = titleObj.AddComponent<TextMeshProUGUI>();
            titleTMP.text = "单位列表";
            titleTMP.fontSize = 20f;
            titleTMP.alignment = TextAlignmentOptions.MidlineLeft;
            titleTMP.color = _textColor;
            titleTMP.margin = new Vector4(15f, 0f, 0f, 0f);

            Image titleDivider = titleObj.AddComponent<Image>();
            titleDivider.color = new Color(_primaryColor.r, _primaryColor.g, _primaryColor.b, 0.3f);
            RectTransform dividerRect = titleDivider.rectTransform;
            dividerRect.anchorMin = new Vector2(0f, 0f);
            dividerRect.anchorMax = new Vector2(1f, 0f);
            dividerRect.sizeDelta = new Vector2(0f, 2f);

            GameObject selectedUnitObj = new GameObject("SelectedUnitInfo");
            selectedUnitObj.transform.SetParent(panelObj.transform, false);
            RectTransform selectedUnitRect = selectedUnitObj.AddComponent<RectTransform>();
            selectedUnitRect.anchorMin = new Vector2(0f, 0.55f);
            selectedUnitRect.anchorMax = new Vector2(1f, 1f);
            selectedUnitRect.offsetMin = new Vector2(10f, -50f);
            selectedUnitRect.offsetMax = new Vector2(-10f, -40f);

            _selectedUnitName = CreateInfoRow(selectedUnitObj.transform, "名称", "未选中", new Vector2(0f, 0.8f), _primaryColor);
            _selectedUnitHP = CreateInfoRow(selectedUnitObj.transform, "生命", "-", new Vector2(0f, 0.55f), _successColor);
            _selectedUnitAttack = CreateInfoRow(selectedUnitObj.transform, "攻击", "-", new Vector2(0f, 0.3f), _dangerColor);
            _selectedUnitSpeed = CreateInfoRow(selectedUnitObj.transform, "速度", "-", new Vector2(0f, 0.05f), _accentColor);

            GameObject scrollObj = new GameObject("ScrollView");
            scrollObj.transform.SetParent(panelObj.transform, false);
            RectTransform scrollRect = scrollObj.AddComponent<RectTransform>();
            scrollRect.anchorMin = new Vector2(0f, 0f);
            scrollRect.anchorMax = new Vector2(1f, 0.55f);
            scrollRect.offsetMin = new Vector2(10f, 10f);
            scrollRect.offsetMax = new Vector2(-10f, -50f);

            ScrollRect scrollView = scrollObj.AddComponent<ScrollRect>();
            scrollView.horizontal = false;
            scrollView.vertical = true;

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
            _unitListContainer = contentObj.AddComponent<RectTransform>();
            _unitListContainer.anchorMin = new Vector2(0.5f, 1f);
            _unitListContainer.anchorMax = new Vector2(0.5f, 1f);
            _unitListContainer.pivot = new Vector2(0.5f, 1f);
            _unitListContainer.sizeDelta = new Vector2(scrollRect.rect.width - 20f, 200f);

            VerticalLayoutGroup layoutGroup = contentObj.AddComponent<VerticalLayoutGroup>();
            layoutGroup.childAlignment = TextAnchor.UpperCenter;
            layoutGroup.childControlHeight = true;
            layoutGroup.childControlWidth = true;
            layoutGroup.childForceExpandWidth = true;
            layoutGroup.childForceExpandHeight = false;
            layoutGroup.spacing = 5f;
            layoutGroup.padding = new RectOffset(5, 5, 5, 5);

            ContentSizeFitter fitter = contentObj.AddComponent<ContentSizeFitter>();
            fitter.verticalFit = ContentSizeFitter.FitMode.PreferredSize;

            scrollView.viewport = viewportRect;
            scrollView.content = _unitListContainer;
        }

        /// <summary>
        /// 创建信息行
        /// </summary>
        private TextMeshProUGUI CreateInfoRow(Transform parent, string label, string value, Vector2 anchor, Color valueColor)
        {
            GameObject rowObj = new GameObject($"InfoRow_{label}");
            rowObj.transform.SetParent(parent, false);

            RectTransform rowRect = rowObj.AddComponent<RectTransform>();
            rowRect.anchorMin = new Vector2(0f, anchor.y);
            rowRect.anchorMax = new Vector2(1f, anchor.y + 0.2f);
            rowRect.offsetMin = Vector2.zero;
            rowRect.offsetMax = Vector2.zero;

            GameObject labelObj = new GameObject("Label");
            labelObj.transform.SetParent(rowObj.transform, false);
            RectTransform labelRect = labelObj.AddComponent<RectTransform>();
            labelRect.anchorMin = new Vector2(0f, 0f);
            labelRect.anchorMax = new Vector2(0.4f, 1f);
            labelRect.offsetMin = Vector2.zero;
            labelRect.offsetMax = Vector2.zero;

            TextMeshProUGUI labelTMP = labelObj.AddComponent<TextMeshProUGUI>();
            labelTMP.text = label;
            labelTMP.fontSize = 16f;
            labelTMP.alignment = TextAlignmentOptions.MidlineLeft;
            labelTMP.color = new Color(0.6f, 0.7f, 0.8f, 1f);

            GameObject valueObj = new GameObject("Value");
            valueObj.transform.SetParent(rowObj.transform, false);
            RectTransform valueRect = valueObj.AddComponent<RectTransform>();
            valueRect.anchorMin = new Vector2(0.4f, 0f);
            valueRect.anchorMax = new Vector2(1f, 1f);
            valueRect.offsetMin = Vector2.zero;
            valueRect.offsetMax = Vector2.zero;

            TextMeshProUGUI valueTMP = valueObj.AddComponent<TextMeshProUGUI>();
            valueTMP.text = value;
            valueTMP.fontSize = 16f;
            valueTMP.alignment = TextAlignmentOptions.MidlineRight;
            valueTMP.color = valueColor;
            valueTMP.fontStyle = FontStyles.Bold;

            return valueTMP;
        }

        /// <summary>
        /// 创建建造菜单（右下角）
        /// </summary>
        private void CreateBuildMenu()
        {
            GameObject panelObj = new GameObject("BuildMenu");
            panelObj.transform.SetParent(transform, false);

            RectTransform panelRect = panelObj.AddComponent<RectTransform>();
            panelRect.anchorMin = new Vector2(1f, 0f);
            panelRect.anchorMax = new Vector2(1f, 0f);
            panelRect.pivot = new Vector2(1f, 0f);
            panelRect.sizeDelta = new Vector2(320f, 160f);
            panelRect.anchoredPosition = new Vector2(-20f, 20f);

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
            titleRect.sizeDelta = new Vector2(0f, 40f);
            titleRect.pivot = new Vector2(0.5f, 1f);
            titleRect.anchoredPosition = Vector2.zero;

            TextMeshProUGUI titleTMP = titleObj.AddComponent<TextMeshProUGUI>();
            titleTMP.text = "建造菜单";
            titleTMP.fontSize = 20f;
            titleTMP.alignment = TextAlignmentOptions.MidlineLeft;
            titleTMP.color = _textColor;
            titleTMP.margin = new Vector4(15f, 0f, 0f, 0f);

            Image titleDivider = titleObj.AddComponent<Image>();
            titleDivider.color = new Color(_accentColor.r, _accentColor.g, _accentColor.b, 0.3f);
            RectTransform dividerRect = titleDivider.rectTransform;
            dividerRect.anchorMin = new Vector2(0f, 0f);
            dividerRect.anchorMax = new Vector2(1f, 0f);
            dividerRect.sizeDelta = new Vector2(0f, 2f);

            _buildMenuContainer = new GameObject("BuildItems").AddComponent<RectTransform>();
            _buildMenuContainer.SetParent(panelObj.transform, false);
            _buildMenuContainer.anchorMin = new Vector2(0f, 0f);
            _buildMenuContainer.anchorMax = new Vector2(1f, 1f);
            _buildMenuContainer.offsetMin = new Vector2(10f, 10f);
            _buildMenuContainer.offsetMax = new Vector2(-10f, -50f);

            HorizontalLayoutGroup layoutGroup = _buildMenuContainer.gameObject.AddComponent<HorizontalLayoutGroup>();
            layoutGroup.childAlignment = TextAnchor.MiddleCenter;
            layoutGroup.childControlHeight = true;
            layoutGroup.childControlWidth = true;
            layoutGroup.childForceExpandWidth = false;
            layoutGroup.childForceExpandHeight = false;
            layoutGroup.spacing = 10f;
            layoutGroup.padding = new RectOffset(5, 5, 5, 5);

            CreateBuildItem("Turret", "炮塔", 100, 50, _primaryColor);
            CreateBuildItem("Barracks", "兵营", 200, 100, _accentColor);
        }

        /// <summary>
        /// 创建建造项
        /// </summary>
        private void CreateBuildItem(string id, string name, int crystalCost, int energyCost, Color color)
        {
            GameObject itemObj = new GameObject($"BuildItem_{id}");
            itemObj.transform.SetParent(_buildMenuContainer, false);

            RectTransform itemRect = itemObj.AddComponent<RectTransform>();
            itemRect.sizeDelta = new Vector2(130f, 90f);

            Image bgImage = itemObj.AddComponent<Image>();
            bgImage.color = new Color(color.r, color.g, color.b, 0.2f);
            bgImage.sprite = CreateRoundedSprite(8);
            bgImage.type = Image.Type.Sliced;

            Outline outline = itemObj.AddComponent<Outline>();
            outline.effectColor = new Color(color.r, color.g, color.b, 0.5f);
            outline.effectDistance = new Vector2(2f, 2f);

            Button button = itemObj.AddComponent<Button>();
            button.targetGraphic = bgImage;
            button.transition = Selectable.Transition.ColorTint;

            ColorBlock colors = button.colors;
            colors.normalColor = new Color(color.r, color.g, color.b, 0.2f);
            colors.highlightedColor = new Color(color.r, color.g, color.b, 0.4f);
            colors.pressedColor = new Color(color.r * 0.7f, color.g * 0.7f, color.b * 0.7f, 0.4f);
            colors.selectedColor = colors.normalColor;
            colors.disabledColor = new Color(0.3f, 0.3f, 0.3f, 0.3f);
            colors.fadeDuration = 0.2f;
            button.colors = colors;

            button.onClick.AddListener(() => OnBuildRequested?.Invoke(id));

            GameObject iconObj = new GameObject("Icon");
            iconObj.transform.SetParent(itemObj.transform, false);
            RectTransform iconRect = iconObj.AddComponent<RectTransform>();
            iconRect.anchorMin = new Vector2(0.5f, 0.7f);
            iconRect.anchorMax = new Vector2(0.5f, 0.7f);
            iconRect.sizeDelta = new Vector2(32f, 32f);
            iconRect.anchoredPosition = Vector2.zero;

            Image iconImage = iconObj.AddComponent<Image>();
            iconImage.color = color;
            iconImage.sprite = CreateRoundedSprite(16);

            GameObject nameObj = new GameObject("Name");
            nameObj.transform.SetParent(itemObj.transform, false);
            RectTransform nameRect = nameObj.AddComponent<RectTransform>();
            nameRect.anchorMin = new Vector2(0f, 0.35f);
            nameRect.anchorMax = new Vector2(1f, 0.6f);
            nameRect.offsetMin = Vector2.zero;
            nameRect.offsetMax = Vector2.zero;

            TextMeshProUGUI nameTMP = nameObj.AddComponent<TextMeshProUGUI>();
            nameTMP.text = name;
            nameTMP.fontSize = 16f;
            nameTMP.alignment = TextAlignmentOptions.Center;
            nameTMP.color = _textColor;
            nameTMP.fontStyle = FontStyles.Bold;

            GameObject costObj = new GameObject("Cost");
            costObj.transform.SetParent(itemObj.transform, false);
            RectTransform costRect = costObj.AddComponent<RectTransform>();
            costRect.anchorMin = new Vector2(0f, 0f);
            costRect.anchorMax = new Vector2(1f, 0.3f);
            costRect.offsetMin = Vector2.zero;
            costRect.offsetMax = Vector2.zero;

            TextMeshProUGUI costTMP = costObj.AddComponent<TextMeshProUGUI>();
            costTMP.text = $"💎{crystalCost} ⚡{energyCost}";
            costTMP.fontSize = 12f;
            costTMP.alignment = TextAlignmentOptions.Center;
            costTMP.color = new Color(0.7f, 0.8f, 0.9f, 1f);

            UIButtonEffects effects = itemObj.AddComponent<UIButtonEffects>();
            effects.Setup(bgImage, nameTMP, color, 1.05f, 0.2f);
        }

        /// <summary>
        /// 创建小地图（右中）
        /// </summary>
        private void CreateMinimap()
        {
            GameObject panelObj = new GameObject("Minimap");
            panelObj.transform.SetParent(transform, false);

            RectTransform panelRect = panelObj.AddComponent<RectTransform>();
            panelRect.anchorMin = new Vector2(1f, 0.5f);
            panelRect.anchorMax = new Vector2(1f, 0.5f);
            panelRect.pivot = new Vector2(1f, 0.5f);
            panelRect.sizeDelta = new Vector2(180f, 180f);
            panelRect.anchoredPosition = new Vector2(-20f, 0f);

            Image panelBg = panelObj.AddComponent<Image>();
            panelBg.color = new Color(0.02f, 0.04f, 0.08f, 0.9f);
            panelBg.sprite = CreateRoundedSprite(12);
            panelBg.type = Image.Type.Sliced;

            Outline panelOutline = panelObj.AddComponent<Outline>();
            panelOutline.effectColor = new Color(_primaryColor.r, _primaryColor.g, _primaryColor.b, 0.5f);
            panelOutline.effectDistance = new Vector2(2f, 2f);

            GameObject mapObj = new GameObject("Map");
            mapObj.transform.SetParent(panelObj.transform, false);
            RectTransform mapRect = mapObj.AddComponent<RectTransform>();
            mapRect.anchorMin = new Vector2(0.5f, 0.5f);
            mapRect.anchorMax = new Vector2(0.5f, 0.5f);
            mapRect.sizeDelta = new Vector2(160f, 160f);
            mapRect.anchoredPosition = Vector2.zero;

            _minimapImage = mapObj.AddComponent<RawImage>();
            _minimapImage.color = new Color(0.059f, 0.09f, 0.165f, 1f);
            _minimapImage.uvRect = new Rect(0f, 0f, 20f, 20f);

            GameObject gridObj = new GameObject("Grid");
            gridObj.transform.SetParent(mapObj.transform, false);
            RectTransform gridRect = gridObj.AddComponent<RectTransform>();
            gridRect.anchorMin = Vector2.zero;
            gridRect.anchorMax = Vector2.one;
            gridRect.offsetMin = Vector2.zero;
            gridRect.offsetMax = Vector2.zero;

            RawImage gridImage = gridObj.AddComponent<RawImage>();
            gridImage.color = new Color(_primaryColor.r, _primaryColor.g, _primaryColor.b, 0.1f);
            gridImage.uvRect = new Rect(0f, 0f, 20f, 20f);

            _minimapBlipContainer = new GameObject("Blips").AddComponent<RectTransform>();
            _minimapBlipContainer.SetParent(mapObj.transform, false);
            _minimapBlipContainer.anchorMin = Vector2.zero;
            _minimapBlipContainer.anchorMax = Vector2.one;
            _minimapBlipContainer.offsetMin = Vector2.zero;
            _minimapBlipContainer.offsetMax = Vector2.zero;

            GameObject titleObj = new GameObject("Title");
            titleObj.transform.SetParent(panelObj.transform, false);
            RectTransform titleRect = titleObj.AddComponent<RectTransform>();
            titleRect.anchorMin = new Vector2(0f, 1f);
            titleRect.anchorMax = new Vector2(1f, 1f);
            titleRect.sizeDelta = new Vector2(0f, 25f);
            titleRect.pivot = new Vector2(0.5f, 1f);
            titleRect.anchoredPosition = new Vector2(0f, 5f);

            TextMeshProUGUI titleTMP = titleObj.AddComponent<TextMeshProUGUI>();
            titleTMP.text = "小地图";
            titleTMP.fontSize = 14f;
            titleTMP.alignment = TextAlignmentOptions.Center;
            titleTMP.color = _primaryColor;
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
        /// 创建圆形Sprite
        /// </summary>
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

        /// <summary>
        /// 注册事件
        /// </summary>
        protected override void RegisterEvents()
        {
            if (GameManager.Instance != null)
            {
                GameManager.Instance.OnPhaseChange += OnPhaseChange;
                GameManager.Instance.OnResourcesUpdated += OnResourcesUpdated;
                GameManager.Instance.OnRoundChanged += OnRoundChanged;
            }
        }

        /// <summary>
        /// 取消事件注册
        /// </summary>
        protected override void UnregisterEvents()
        {
            if (GameManager.Instance != null)
            {
                GameManager.Instance.OnPhaseChange -= OnPhaseChange;
                GameManager.Instance.OnResourcesUpdated -= OnResourcesUpdated;
                GameManager.Instance.OnRoundChanged -= OnRoundChanged;
            }
        }

        /// <summary>
        /// 阶段变化处理
        /// </summary>
        private void OnPhaseChange(GamePhase oldPhase, GamePhase newPhase)
        {
            UpdatePhaseDisplay(newPhase);
        }

        /// <summary>
        /// 资源更新处理
        /// </summary>
        private void OnResourcesUpdated(PlayerResources resources)
        {
            UpdateResources(resources);
        }

        /// <summary>
        /// 回合变化处理
        /// </summary>
        private void OnRoundChanged(int round)
        {
            UpdateRound(round);
        }

        /// <summary>
        /// 更新资源显示
        /// </summary>
        public void UpdateResources(PlayerResources resources)
        {
            if (_crystalText != null) _crystalText.text = resources.Gold.ToString();
            if (_energyText != null) _energyText.text = resources.Food.ToString();
            if (_goldText != null) _goldText.text = resources.Wood.ToString();
            if (_foodText != null) _foodText.text = resources.Stone.ToString();
        }

        /// <summary>
        /// 更新回合显示
        /// </summary>
        public void UpdateRound(int round)
        {
            if (_roundText != null)
            {
                _roundText.text = $"第 {round} 回合";
            }
        }

        /// <summary>
        /// 更新阶段显示
        /// </summary>
        public void UpdatePhaseDisplay(GamePhase phase)
        {
            if (_phaseText == null) return;

            string phaseName = "";
            Color phaseColor = Color.white;
            _maxPhaseTime = 10f;

            switch (phase)
            {
                case GamePhase.Planning:
                    phaseName = "规划阶段";
                    phaseColor = _primaryColor;
                    _maxPhaseTime = 10f;
                    break;
                case GamePhase.Simulating:
                    phaseName = "模拟阶段";
                    phaseColor = _accentColor;
                    _maxPhaseTime = 5f;
                    break;
                case GamePhase.GameOver:
                    phaseName = "游戏结束";
                    phaseColor = _dangerColor;
                    _maxPhaseTime = 0f;
                    break;
            }

            _phaseText.text = phaseName;
            _phaseText.color = phaseColor;

            if (_countdownBar != null)
            {
                _countdownBar.color = phaseColor;
            }

            _phaseCountdown = _maxPhaseTime;
        }

        /// <summary>
        /// 更新倒计时
        /// </summary>
        public void UpdateCountdown(float remainingTime)
        {
            _phaseCountdown = Mathf.Max(0f, remainingTime);

            if (_countdownText != null)
            {
                _countdownText.text = $"{_phaseCountdown:F1}s";
            }

            if (_countdownBar != null && _maxPhaseTime > 0f)
            {
                _countdownBar.fillAmount = Mathf.Clamp01(_phaseCountdown / _maxPhaseTime);
            }
        }

        /// <summary>
        /// 更新单位列表
        /// </summary>
        public void UpdateUnitList(List<Unit> units, string localPlayerId)
        {
            foreach (var item in _unitItems)
            {
                if (item != null && item.gameObject != null)
                {
                    Destroy(item.gameObject);
                }
            }
            _unitItems.Clear();

            foreach (var unit in units)
            {
                if (unit.PlayerID != localPlayerId) continue;

                GameObject itemObj = new GameObject($"UnitItem_{unit.ID}");
                itemObj.transform.SetParent(_unitListContainer, false);

                RectTransform itemRect = itemObj.AddComponent<RectTransform>();
                itemRect.sizeDelta = new Vector2(0f, 50f);

                int playerIndex = Mathf.Abs(unit.PlayerID.GetHashCode()) % _playerColors.Length;
                Color playerColor = _playerColors[playerIndex];

                UnitListItem listItem = itemObj.AddComponent<UnitListItem>();
                listItem.Initialize(unit, playerColor, OnUnitClicked);
                _unitItems.Add(listItem);
            }
        }

        /// <summary>
        /// 单位点击处理
        /// </summary>
        private void OnUnitClicked(Unit unit)
        {
            SelectUnit(unit);
            OnUnitSelected?.Invoke(unit);
        }

        /// <summary>
        /// 选中单位
        /// </summary>
        public void SelectUnit(Unit unit)
        {
            _selectedUnit = unit;

            foreach (var item in _unitItems)
            {
                item.SetSelected(item.UnitID == unit.ID);
            }

            if (_selectedUnitName != null) _selectedUnitName.text = GetUnitTypeName(unit.Type);
            if (_selectedUnitHP != null) _selectedUnitHP.text = $"{unit.HP}/{unit.MaxHP}";
            if (_selectedUnitAttack != null) _selectedUnitAttack.text = unit.Attack.ToString();
            if (_selectedUnitSpeed != null) _selectedUnitSpeed.text = unit.Speed.ToString();
        }

        /// <summary>
        /// 获取单位类型名称
        /// </summary>
        private string GetUnitTypeName(UnitType type)
        {
            switch (type)
            {
                case UnitType.Infantry: return "步兵";
                case UnitType.Ranger: return "弓箭手";
                case UnitType.Tank: return "坦克";
                case UnitType.Worker: return "工人";
                default: return type.ToString();
            }
        }

        /// <summary>
        /// 更新小地图
        /// </summary>
        public void UpdateMinimap(List<Unit> units, List<Building> buildings, int mapWidth, int mapHeight)
        {
            foreach (var blip in _minimapBlips)
            {
                if (blip != null)
                {
                    Destroy(blip);
                }
            }
            _minimapBlips.Clear();

            float scaleX = 160f / mapWidth;
            float scaleY = 160f / mapHeight;

            foreach (var unit in units)
            {
                if (unit.Position == null) continue;

                GameObject blipObj = new GameObject($"UnitBlip_{unit.ID}");
                blipObj.transform.SetParent(_minimapBlipContainer, false);

                RectTransform blipRect = blipObj.AddComponent<RectTransform>();
                blipRect.anchorMin = new Vector2(0f, 0f);
                blipRect.anchorMax = new Vector2(0f, 0f);
                blipRect.pivot = new Vector2(0.5f, 0.5f);
                blipRect.sizeDelta = new Vector2(6f, 6f);
                blipRect.anchoredPosition = new Vector2(
                    unit.Position.X * scaleX - 80f,
                    unit.Position.Y * scaleY - 80f
                );

                Image blipImage = blipObj.AddComponent<Image>();
                int playerIndex = Mathf.Abs(unit.PlayerID.GetHashCode()) % _playerColors.Length;
                blipImage.color = _playerColors[playerIndex];
                blipImage.sprite = CreateCircleSprite(3);

                _minimapBlips.Add(blipObj);
            }

            foreach (var building in buildings)
            {
                if (building.Position == null) continue;

                GameObject blipObj = new GameObject($"BuildingBlip_{building.ID}");
                blipObj.transform.SetParent(_minimapBlipContainer, false);

                RectTransform blipRect = blipObj.AddComponent<RectTransform>();
                blipRect.anchorMin = new Vector2(0f, 0f);
                blipRect.anchorMax = new Vector2(0f, 0f);
                blipRect.pivot = new Vector2(0.5f, 0.5f);
                blipRect.sizeDelta = new Vector2(8f, 8f);
                blipRect.anchoredPosition = new Vector2(
                    building.Position.X * scaleX - 80f,
                    building.Position.Y * scaleY - 80f
                );

                Image blipImage = blipObj.AddComponent<Image>();
                int playerIndex = Mathf.Abs(building.PlayerID.GetHashCode()) % _playerColors.Length;
                blipImage.color = _playerColors[playerIndex];
                blipImage.sprite = CreateRoundedSprite(4);

                _minimapBlips.Add(blipObj);
            }
        }

        private void Update()
        {
            if (GameManager.Instance != null &&
                GameManager.Instance.CurrentPhase != GamePhase.GameOver &&
                GameManager.Instance.CurrentPhase != GamePhase.Lobby)
            {
                _phaseCountdown -= Time.deltaTime;
                UpdateCountdown(_phaseCountdown);
            }
        }

        /// <summary>
        /// 面板显示时调用
        /// </summary>
        protected override void OnShow()
        {
            base.OnShow();

            if (GameManager.Instance != null)
            {
                UpdateResources(GameManager.Instance.PlayerResources);
                UpdateRound(GameManager.Instance.CurrentRound);
                UpdatePhaseDisplay(GameManager.Instance.CurrentPhase);
            }
        }
    }

    /// <summary>
    /// 单位列表项
    /// </summary>
    public class UnitListItem : MonoBehaviour
    {
        public string UnitID { get; private set; }

        private Unit _unit;
        private Action<Unit> _onClick;
        private Image _bgImage;

        public void Initialize(Unit unit, Color color, Action<Unit> onClick)
        {
            _unit = unit;
            UnitID = unit.ID;
            _onClick = onClick;

            RectTransform rect = GetComponent<RectTransform>();

            _bgImage = gameObject.AddComponent<Image>();
            _bgImage.color = new Color(0.02f, 0.04f, 0.08f, 0.6f);
            _bgImage.sprite = CreateRoundedSprite(6);
            _bgImage.type = Image.Type.Sliced;

            Button button = gameObject.AddComponent<Button>();
            button.targetGraphic = _bgImage;
            button.transition = Selectable.Transition.ColorTint;
            button.onClick.AddListener(OnClick);

            ColorBlock colors = button.colors;
            colors.normalColor = new Color(0.02f, 0.04f, 0.08f, 0.6f);
            colors.highlightedColor = new Color(color.r, color.g, color.b, 0.2f);
            colors.pressedColor = new Color(color.r, color.g, color.b, 0.4f);
            colors.selectedColor = new Color(color.r, color.g, color.b, 0.3f);
            colors.disabledColor = new Color(0.3f, 0.3f, 0.3f, 0.3f);
            colors.fadeDuration = 0.15f;
            button.colors = colors;

            GameObject iconObj = new GameObject("Icon");
            iconObj.transform.SetParent(transform, false);
            RectTransform iconRect = iconObj.AddComponent<RectTransform>();
            iconRect.anchorMin = new Vector2(0f, 0.5f);
            iconRect.anchorMax = new Vector2(0f, 0.5f);
            iconRect.sizeDelta = new Vector2(30f, 30f);
            iconRect.anchoredPosition = new Vector2(25f, 0f);

            Image iconImage = iconObj.AddComponent<Image>();
            iconImage.color = color;
            iconImage.sprite = CreateRoundedSprite(15);

            GameObject nameObj = new GameObject("Name");
            nameObj.transform.SetParent(transform, false);
            RectTransform nameRect = nameObj.AddComponent<RectTransform>();
            nameRect.anchorMin = new Vector2(0.15f, 0.5f);
            nameRect.anchorMax = new Vector2(0.55f, 0.5f);
            nameRect.sizeDelta = new Vector2(0f, 20f);
            nameRect.anchoredPosition = Vector2.zero;

            TextMeshProUGUI nameTMP = nameObj.AddComponent<TextMeshProUGUI>();
            nameTMP.text = GetUnitTypeName(unit.Type);
            nameTMP.fontSize = 16f;
            nameTMP.alignment = TextAlignmentOptions.MidlineLeft;
            nameTMP.color = new Color(0.9f, 0.95f, 1f, 1f);

            GameObject hpObj = new GameObject("HP");
            hpObj.transform.SetParent(transform, false);
            RectTransform hpRect = hpObj.AddComponent<RectTransform>();
            hpRect.anchorMin = new Vector2(0.55f, 0.5f);
            hpRect.anchorMax = new Vector2(1f, 0.5f);
            hpRect.sizeDelta = new Vector2(0f, 20f);
            hpRect.anchoredPosition = new Vector2(-10f, 0f);

            TextMeshProUGUI hpTMP = hpObj.AddComponent<TextMeshProUGUI>();
            hpTMP.text = $"{unit.HP}/{unit.MaxHP}";
            hpTMP.fontSize = 14f;
            hpTMP.alignment = TextAlignmentOptions.MidlineRight;
            hpTMP.color = unit.HP > unit.MaxHP * 0.5f ?
                new Color(0.345f, 0.875f, 0.42f, 1f) :
                new Color(0.937f, 0.267f, 0.267f, 1f);
        }

        public void SetSelected(bool selected)
        {
            if (_bgImage != null)
            {
                _bgImage.color = selected ?
                    new Color(0.024f, 0.714f, 0.831f, 0.3f) :
                    new Color(0.02f, 0.04f, 0.08f, 0.6f);
            }
        }

        private void OnClick()
        {
            _onClick?.Invoke(_unit);
        }

        private string GetUnitTypeName(UnitType type)
        {
            switch (type)
            {
                case UnitType.Infantry: return "步兵";
                case UnitType.Ranger: return "弓箭手";
                case UnitType.Tank: return "坦克";
                case UnitType.Worker: return "工人";
                default: return type.ToString();
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
    }
}
