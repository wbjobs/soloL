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
    /// 游戏结算界面
    /// 显示胜负结果、详细数据统计和玩家排名
    /// </summary>
    public class GameOverUI : BasePanel
    {
        [Header("结算数据")]
        [SerializeField] private int _winnerPlayerId = -1;
        [SerializeField] private bool _isLocalPlayerWinner = false;
        [SerializeField] private bool _isRoomOwner = false;

        [Header("UI元素引用")]
        [SerializeField] private TextMeshProUGUI _resultTitle;
        [SerializeField] private Transform _statsContainer;
        [SerializeField] private Transform _rankingContainer;
        [SerializeField] private Button _returnToLobbyBtn;
        [SerializeField] private Button _playAgainBtn;

        [Header("动画设置")]
        [SerializeField] private float _titleAnimationDuration = 1.5f;
        [SerializeField] private float _statsDelay = 0.5f;
        [SerializeField] private float _statsItemInterval = 0.1f;

        [Header("颜色配置")]
        [SerializeField] private Color _primaryColor = new Color(0.024f, 0.714f, 0.831f, 1f);
        [SerializeField] private Color _accentColor = new Color(0.961f, 0.62f, 0.043f, 1f);
        [SerializeField] private Color _dangerColor = new Color(0.937f, 0.267f, 0.267f, 1f);
        [SerializeField] private Color _successColor = new Color(0.345f, 0.875f, 0.42f, 1f);
        [SerializeField] private Color _panelBgColor = new Color(0.059f, 0.09f, 0.165f, 0.95f);
        [SerializeField] private Color _textColor = new Color(0.9f, 0.95f, 1f, 1f);

        [Header("玩家颜色")]
        [SerializeField] private Color[] _playerColors = new Color[]
        {
            new Color(0.024f, 0.714f, 0.831f, 1f),
            new Color(0.937f, 0.267f, 0.267f, 1f),
            new Color(0.345f, 0.875f, 0.42f, 1f),
            new Color(0.961f, 0.62f, 0.043f, 1f)
        };

        public event Action OnReturnToLobby;
        public event Action OnPlayAgain;

        private readonly List<GameObject> _statItems = new List<GameObject>();
        private readonly List<GameObject> _rankingItems = new List<GameObject>();
        private Dictionary<string, PlayerStats> _playerStats = new Dictionary<string, PlayerStats>();

        protected override void Awake()
        {
            base.Awake();
            _panelType = UIPanelType.GameOver;
        }

        /// <summary>
        /// 设置UI元素
        /// </summary>
        protected override void SetupUI()
        {
            SetupPanelStyle();
            CreateBackgroundOverlay();
            CreateResultTitle();
            CreateStatsPanel();
            CreateRankingPanel();
            CreateButtons();
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
        /// 创建背景遮罩
        /// </summary>
        private void CreateBackgroundOverlay()
        {
            GameObject overlayObj = new GameObject("BackgroundOverlay");
            overlayObj.transform.SetParent(transform, false);

            RectTransform overlayRect = overlayObj.AddComponent<RectTransform>();
            overlayRect.anchorMin = Vector2.zero;
            overlayRect.anchorMax = Vector2.one;
            overlayRect.offsetMin = Vector2.zero;
            overlayRect.offsetMax = Vector2.zero;

            Image overlayImage = overlayObj.AddComponent<Image>();
            overlayImage.color = new Color(0f, 0f, 0f, 0.8f);

            overlayObj.transform.SetAsFirstSibling();
        }

        /// <summary>
        /// 创建结果标题
        /// </summary>
        private void CreateResultTitle()
        {
            GameObject titleObj = new GameObject("ResultTitle");
            titleObj.transform.SetParent(transform, false);

            RectTransform titleRect = titleObj.AddComponent<RectTransform>();
            titleRect.anchorMin = new Vector2(0.5f, 0.85f);
            titleRect.anchorMax = new Vector2(0.5f, 0.85f);
            titleRect.sizeDelta = new Vector2(800f, 150f);
            titleRect.anchoredPosition = Vector2.zero;

            _resultTitle = titleObj.AddComponent<TextMeshProUGUI>();
            _resultTitle.text = "胜利!";
            _resultTitle.fontSize = 96f;
            _resultTitle.alignment = TextAlignmentOptions.Center;
            _resultTitle.color = _successColor;
            _resultTitle.fontStyle = FontStyles.Bold;

            _resultTitle.outlineWidth = 0.8f;
            _resultTitle.outlineColor = new Color(0.345f, 0.875f, 0.42f, 0.8f);

            CanvasGroup titleCanvas = titleObj.AddComponent<CanvasGroup>();
            titleCanvas.alpha = 0f;
        }

        /// <summary>
        /// 创建统计数据面板
        /// </summary>
        private void CreateStatsPanel()
        {
            GameObject panelObj = new GameObject("StatsPanel");
            panelObj.transform.SetParent(transform, false);

            RectTransform panelRect = panelObj.AddComponent<RectTransform>();
            panelRect.anchorMin = new Vector2(0.5f, 0.5f);
            panelRect.anchorMax = new Vector2(0.5f, 0.5f);
            panelRect.pivot = new Vector2(0.5f, 0.5f);
            panelRect.sizeDelta = new Vector2(900f, 300f);
            panelRect.anchoredPosition = new Vector2(0f, 30f);

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
            titleTMP.text = "战斗统计";
            titleTMP.fontSize = 28f;
            titleTMP.alignment = TextAlignmentOptions.Center;
            titleTMP.color = _primaryColor;
            titleTMP.fontStyle = FontStyles.Bold;

            Image titleDivider = titleObj.AddComponent<Image>();
            titleDivider.color = new Color(_primaryColor.r, _primaryColor.g, _primaryColor.b, 0.3f);
            RectTransform dividerRect = titleDivider.rectTransform;
            dividerRect.anchorMin = new Vector2(0f, 0f);
            dividerRect.anchorMax = new Vector2(1f, 0f);
            dividerRect.sizeDelta = new Vector2(0f, 2f);

            _statsContainer = new GameObject("StatsContent").AddComponent<RectTransform>();
            _statsContainer.SetParent(panelObj.transform, false);
            _statsContainer.anchorMin = new Vector2(0f, 0f);
            _statsContainer.anchorMax = new Vector2(1f, 1f);
            _statsContainer.offsetMin = new Vector2(20f, 20f);
            _statsContainer.offsetMax = new Vector2(-20f, -50f);

            GridLayoutGroup gridLayout = _statsContainer.gameObject.AddComponent<GridLayoutGroup>();
            gridLayout.cellSize = new Vector2(280f, 90f);
            gridLayout.spacing = new Vector2(10f, 10f);
            gridLayout.startCorner = GridLayoutGroup.Corner.UpperLeft;
            gridLayout.startAxis = GridLayoutGroup.Axis.Horizontal;
            gridLayout.childAlignment = TextAnchor.UpperCenter;
            gridLayout.constraint = GridLayoutGroup.Constraint.FixedColumnCount;
            gridLayout.constraintCount = 3;

            CanvasGroup canvasGroup = panelObj.AddComponent<CanvasGroup>();
            canvasGroup.alpha = 0f;
        }

        /// <summary>
        /// 创建排序列表面板
        /// </summary>
        private void CreateRankingPanel()
        {
            GameObject panelObj = new GameObject("RankingPanel");
            panelObj.transform.SetParent(transform, false);

            RectTransform panelRect = panelObj.AddComponent<RectTransform>();
            panelRect.anchorMin = new Vector2(0.5f, 0.2f);
            panelRect.anchorMax = new Vector2(0.5f, 0.2f);
            panelRect.pivot = new Vector2(0.5f, 0.5f);
            panelRect.sizeDelta = new Vector2(600f, 200f);
            panelRect.anchoredPosition = Vector2.zero;

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
            titleTMP.text = "玩家排名";
            titleTMP.fontSize = 24f;
            titleTMP.alignment = TextAlignmentOptions.Center;
            titleTMP.color = _accentColor;
            titleTMP.fontStyle = FontStyles.Bold;

            Image titleDivider = titleObj.AddComponent<Image>();
            titleDivider.color = new Color(_accentColor.r, _accentColor.g, _accentColor.b, 0.3f);
            RectTransform dividerRect = titleDivider.rectTransform;
            dividerRect.anchorMin = new Vector2(0f, 0f);
            dividerRect.anchorMax = new Vector2(1f, 0f);
            dividerRect.sizeDelta = new Vector2(0f, 2f);

            _rankingContainer = new GameObject("RankingContent").AddComponent<RectTransform>();
            _rankingContainer.SetParent(panelObj.transform, false);
            _rankingContainer.anchorMin = new Vector2(0f, 0f);
            _rankingContainer.anchorMax = new Vector2(1f, 1f);
            _rankingContainer.offsetMin = new Vector2(10f, 10f);
            _rankingContainer.offsetMax = new Vector2(-10f, -40f);

            VerticalLayoutGroup layoutGroup = _rankingContainer.gameObject.AddComponent<VerticalLayoutGroup>();
            layoutGroup.childAlignment = TextAnchor.UpperCenter;
            layoutGroup.childControlHeight = true;
            layoutGroup.childControlWidth = true;
            layoutGroup.childForceExpandWidth = true;
            layoutGroup.childForceExpandHeight = false;
            layoutGroup.spacing = 5f;
            layoutGroup.padding = new RectOffset(5, 5, 5, 5);

            CanvasGroup canvasGroup = panelObj.AddComponent<CanvasGroup>();
            canvasGroup.alpha = 0f;
        }

        /// <summary>
        /// 创建操作按钮
        /// </summary>
        private void CreateButtons()
        {
            GameObject buttonsObj = new GameObject("Buttons");
            buttonsObj.transform.SetParent(transform, false);

            RectTransform buttonsRect = buttonsObj.AddComponent<RectTransform>();
            buttonsRect.anchorMin = new Vector2(0.5f, 0.08f);
            buttonsRect.anchorMax = new Vector2(0.5f, 0.08f);
            buttonsRect.sizeDelta = new Vector2(500f, 80f);
            buttonsRect.anchoredPosition = Vector2.zero;

            _returnToLobbyBtn = CreateButton("ReturnToLobbyBtn", "返回大厅", _primaryColor,
                buttonsObj.transform, new Vector2(0.3f, 0.5f), new Vector2(180f, 60f), 24f);

            _playAgainBtn = CreateButton("PlayAgainBtn", "再来一局", _accentColor,
                buttonsObj.transform, new Vector2(0.7f, 0.5f), new Vector2(180f, 60f), 24f);
            _playAgainBtn.gameObject.SetActive(_isRoomOwner);

            CanvasGroup canvasGroup = buttonsObj.AddComponent<CanvasGroup>();
            canvasGroup.alpha = 0f;
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
            if (_returnToLobbyBtn != null)
            {
                _returnToLobbyBtn.onClick.AddListener(OnReturnToLobbyClicked);
            }

            if (_playAgainBtn != null)
            {
                _playAgainBtn.onClick.AddListener(OnPlayAgainClicked);
            }
        }

        /// <summary>
        /// 取消事件注册
        /// </summary>
        protected override void UnregisterEvents()
        {
            if (_returnToLobbyBtn != null)
            {
                _returnToLobbyBtn.onClick.RemoveListener(OnReturnToLobbyClicked);
            }

            if (_playAgainBtn != null)
            {
                _playAgainBtn.onClick.RemoveListener(OnPlayAgainClicked);
            }
        }

        /// <summary>
        /// 返回大厅按钮点击
        /// </summary>
        private void OnReturnToLobbyClicked()
        {
            OnReturnToLobby?.Invoke();
        }

        /// <summary>
        /// 再来一局按钮点击
        /// </summary>
        private void OnPlayAgainClicked()
        {
            if (!_isRoomOwner)
            {
                Debug.LogWarning("只有房主可以开始新游戏");
                return;
            }

            OnPlayAgain?.Invoke();
        }

        /// <summary>
        /// 设置胜负结果
        /// </summary>
        public void SetResult(bool isWinner, int winnerPlayerId)
        {
            _isLocalPlayerWinner = isWinner;
            _winnerPlayerId = winnerPlayerId;

            if (_resultTitle != null)
            {
                _resultTitle.text = isWinner ? "胜利!" : "失败";
                _resultTitle.color = isWinner ? _successColor : _dangerColor;
                _resultTitle.outlineColor = isWinner ?
                    new Color(_successColor.r, _successColor.g, _successColor.b, 0.8f) :
                    new Color(_dangerColor.r, _dangerColor.g, _dangerColor.b, 0.8f);
            }
        }

        /// <summary>
        /// 设置是否为房主
        /// </summary>
        public void SetRoomOwner(bool isOwner)
        {
            _isRoomOwner = isOwner;
            if (_playAgainBtn != null)
            {
                _playAgainBtn.gameObject.SetActive(_isRoomOwner);
            }
        }

        /// <summary>
        /// 设置玩家统计数据
        /// </summary>
        public void SetPlayerStats(Dictionary<string, PlayerStats> stats)
        {
            _playerStats = stats;
            PopulateStats();
            PopulateRanking();
        }

        /// <summary>
        /// 填充统计数据
        /// </summary>
        private void PopulateStats()
        {
            foreach (var item in _statItems)
            {
                if (item != null)
                {
                    Destroy(item);
                }
            }
            _statItems.Clear();

            if (_playerStats.Count == 0) return;

            int totalKills = 0;
            int totalBuildings = 0;
            int totalResources = 0;
            int totalUnits = 0;

            foreach (var stat in _playerStats.Values)
            {
                totalKills += stat.KillCount;
                totalBuildings += stat.BuildCount;
                totalResources += stat.ResourcesGathered;
                totalUnits += stat.UnitsProduced;
            }

            CreateStatItem("击杀数", totalKills.ToString(), _dangerColor);
            CreateStatItem("建造数", totalBuildings.ToString(), _primaryColor);
            CreateStatItem("资源采集", totalResources.ToString(), _accentColor);
            CreateStatItem("生产单位", totalUnits.ToString(), _successColor);
            CreateStatItem("存活单位", _playerStats.Count.ToString(), _textColor);
            CreateStatItem("游戏回合", "10", _accentColor);
        }

        /// <summary>
        /// 创建统计项
        /// </summary>
        private void CreateStatItem(string label, string value, Color color)
        {
            GameObject itemObj = new GameObject($"StatItem_{label}");
            itemObj.transform.SetParent(_statsContainer, false);

            RectTransform itemRect = itemObj.AddComponent<RectTransform>();
            itemRect.sizeDelta = new Vector2(280f, 90f);

            Image bgImage = itemObj.AddComponent<Image>();
            bgImage.color = new Color(color.r, color.g, color.b, 0.1f);
            bgImage.sprite = CreateRoundedSprite(8);
            bgImage.type = Image.Type.Sliced;

            Outline outline = itemObj.AddComponent<Outline>();
            outline.effectColor = new Color(color.r, color.g, color.b, 0.3f);
            outline.effectDistance = new Vector2(1f, 1f);

            GameObject labelObj = new GameObject("Label");
            labelObj.transform.SetParent(itemObj.transform, false);
            RectTransform labelRect = labelObj.AddComponent<RectTransform>();
            labelRect.anchorMin = new Vector2(0f, 0.55f);
            labelRect.anchorMax = new Vector2(1f, 1f);
            labelRect.offsetMin = new Vector2(10f, 0f);
            labelRect.offsetMax = new Vector2(-10f, 0f);

            TextMeshProUGUI labelTMP = labelObj.AddComponent<TextMeshProUGUI>();
            labelTMP.text = label;
            labelTMP.fontSize = 18f;
            labelTMP.alignment = TextAlignmentOptions.MidlineLeft;
            labelTMP.color = new Color(0.6f, 0.7f, 0.8f, 1f);

            GameObject valueObj = new GameObject("Value");
            valueObj.transform.SetParent(itemObj.transform, false);
            RectTransform valueRect = valueObj.AddComponent<RectTransform>();
            valueRect.anchorMin = new Vector2(0f, 0f);
            valueRect.anchorMax = new Vector2(1f, 0.55f);
            valueRect.offsetMin = new Vector2(10f, 0f);
            valueRect.offsetMax = new Vector2(-10f, 0f);

            TextMeshProUGUI valueTMP = valueObj.AddComponent<TextMeshProUGUI>();
            valueTMP.text = value;
            valueTMP.fontSize = 32f;
            valueTMP.alignment = TextAlignmentOptions.MidlineLeft;
            valueTMP.color = color;
            valueTMP.fontStyle = FontStyles.Bold;

            CanvasGroup canvasGroup = itemObj.AddComponent<CanvasGroup>();
            canvasGroup.alpha = 0f;

            _statItems.Add(itemObj);
        }

        /// <summary>
        /// 填充玩家排名
        /// </summary>
        private void PopulateRanking()
        {
            foreach (var item in _rankingItems)
            {
                if (item != null)
                {
                    Destroy(item);
                }
            }
            _rankingItems.Clear();

            if (_playerStats.Count == 0) return;

            List<PlayerStats> sortedStats = new List<PlayerStats>(_playerStats.Values);
            sortedStats.Sort((a, b) => b.Score.CompareTo(a.Score));

            for (int i = 0; i < sortedStats.Count; i++)
            {
                CreateRankingItem(i + 1, sortedStats[i]);
            }
        }

        /// <summary>
        /// 创建排名项
        /// </summary>
        private void CreateRankingItem(int rank, PlayerStats stats)
        {
            GameObject itemObj = new GameObject($"RankingItem_{stats.PlayerID}");
            itemObj.transform.SetParent(_rankingContainer, false);

            RectTransform itemRect = itemObj.AddComponent<RectTransform>();
            itemRect.sizeDelta = new Vector2(0f, 40f);

            int colorIndex = Mathf.Abs(stats.PlayerID.GetHashCode()) % _playerColors.Length;
            Color playerColor = _playerColors[colorIndex];

            bool isWinner = stats.PlayerID == _winnerPlayerId.ToString();

            Image bgImage = itemObj.AddComponent<Image>();
            bgImage.color = isWinner ?
                new Color(playerColor.r, playerColor.g, playerColor.b, 0.2f) :
                new Color(0.02f, 0.04f, 0.08f, 0.6f);
            bgImage.sprite = CreateRoundedSprite(6);
            bgImage.type = Image.Type.Sliced;

            Outline outline = itemObj.AddComponent<Outline>();
            outline.effectColor = isWinner ?
                new Color(playerColor.r, playerColor.g, playerColor.b, 0.8f) :
                new Color(playerColor.r, playerColor.g, playerColor.b, 0.2f);
            outline.effectDistance = new Vector2(1f, 1f);

            GameObject rankObj = new GameObject("Rank");
            rankObj.transform.SetParent(itemObj.transform, false);
            RectTransform rankRect = rankObj.AddComponent<RectTransform>();
            rankRect.anchorMin = new Vector2(0f, 0.5f);
            rankRect.anchorMax = new Vector2(0f, 0.5f);
            rankRect.sizeDelta = new Vector2(40f, 30f);
            rankRect.anchoredPosition = new Vector2(30f, 0f);

            TextMeshProUGUI rankTMP = rankObj.AddComponent<TextMeshProUGUI>();
            rankTMP.text = GetRankIcon(rank);
            rankTMP.fontSize = 20f;
            rankTMP.alignment = TextAlignmentOptions.Center;
            rankTMP.color = rank <= 3 ? _accentColor : _textColor;
            rankTMP.fontStyle = FontStyles.Bold;

            GameObject nameObj = new GameObject("Name");
            nameObj.transform.SetParent(itemObj.transform, false);
            RectTransform nameRect = nameObj.AddComponent<RectTransform>();
            nameRect.anchorMin = new Vector2(0.1f, 0.5f);
            nameRect.anchorMax = new Vector2(0.5f, 0.5f);
            nameRect.sizeDelta = new Vector2(0f, 24f);
            nameRect.anchoredPosition = Vector2.zero;

            TextMeshProUGUI nameTMP = nameObj.AddComponent<TextMeshProUGUI>();
            nameTMP.text = stats.PlayerName;
            nameTMP.fontSize = 18f;
            nameTMP.alignment = TextAlignmentOptions.MidlineLeft;
            nameTMP.color = playerColor;

            GameObject scoreObj = new GameObject("Score");
            scoreObj.transform.SetParent(itemObj.transform, false);
            RectTransform scoreRect = scoreObj.AddComponent<RectTransform>();
            scoreRect.anchorMin = new Vector2(0.5f, 0.5f);
            scoreRect.anchorMax = new Vector2(0.8f, 0.5f);
            scoreRect.sizeDelta = new Vector2(0f, 24f);
            scoreRect.anchoredPosition = Vector2.zero;

            TextMeshProUGUI scoreTMP = scoreObj.AddComponent<TextMeshProUGUI>();
            scoreTMP.text = $"得分: {stats.Score}";
            scoreTMP.fontSize = 16f;
            scoreTMP.alignment = TextAlignmentOptions.MidlineLeft;
            scoreTMP.color = _textColor;

            GameObject killsObj = new GameObject("Kills");
            killsObj.transform.SetParent(itemObj.transform, false);
            RectTransform killsRect = killsObj.AddComponent<RectTransform>();
            killsRect.anchorMin = new Vector2(0.8f, 0.5f);
            killsRect.anchorMax = new Vector2(1f, 0.5f);
            killsRect.sizeDelta = new Vector2(0f, 24f);
            killsRect.anchoredPosition = new Vector2(-10f, 0f);

            TextMeshProUGUI killsTMP = killsObj.AddComponent<TextMeshProUGUI>();
            killsTMP.text = $"击杀: {stats.KillCount}";
            killsTMP.fontSize = 16f;
            killsTMP.alignment = TextAlignmentOptions.MidlineRight;
            killsTMP.color = _dangerColor;

            CanvasGroup canvasGroup = itemObj.AddComponent<CanvasGroup>();
            canvasGroup.alpha = 0f;

            _rankingItems.Add(itemObj);
        }

        /// <summary>
        /// 获取排名图标
        /// </summary>
        private string GetRankIcon(int rank)
        {
            switch (rank)
            {
                case 1: return "🥇";
                case 2: return "🥈";
                case 3: return "🥉";
                default: return rank.ToString();
            }
        }

        /// <summary>
        /// 播放入场动画
        /// </summary>
        public void PlayEntranceAnimation()
        {
            StopAllCoroutines();
            StartCoroutine(EntranceAnimationCoroutine());
        }

        /// <summary>
        /// 入场动画协程
        /// </summary>
        private System.Collections.IEnumerator EntranceAnimationCoroutine()
        {
            CanvasGroup titleCanvas = _resultTitle.GetComponent<CanvasGroup>();
            CanvasGroup statsCanvas = _statsContainer.parent.GetComponent<CanvasGroup>();
            CanvasGroup rankingCanvas = _rankingContainer.parent.GetComponent<CanvasGroup>();
            CanvasGroup buttonsCanvas = _returnToLobbyBtn.transform.parent.GetComponent<CanvasGroup>();

            float titlePulse = 0f;
            while (titlePulse < _titleAnimationDuration)
            {
                titlePulse += Time.unscaledDeltaTime;
                float t = titlePulse / _titleAnimationDuration;

                float scale = 1f + Mathf.Sin(t * Mathf.PI) * 0.2f;
                _resultTitle.rectTransform.localScale = new Vector3(scale, scale, 1f);

                titleCanvas.alpha = Mathf.Clamp01(t * 2f);

                float glow = Mathf.Sin(t * Mathf.PI * 2f) * 0.5f + 0.5f;
                _resultTitle.outlineWidth = 0.5f + glow * 0.5f;

                yield return null;
            }

            _resultTitle.rectTransform.localScale = Vector3.one;
            titleCanvas.alpha = 1f;

            yield return new WaitForSecondsRealtime(_statsDelay);

            statsCanvas.alpha = 0f;
            float statsFade = 0f;
            while (statsFade < 0.3f)
            {
                statsFade += Time.unscaledDeltaTime;
                statsCanvas.alpha = statsFade / 0.3f;
                yield return null;
            }
            statsCanvas.alpha = 1f;

            for (int i = 0; i < _statItems.Count; i++)
            {
                CanvasGroup itemCanvas = _statItems[i].GetComponent<CanvasGroup>();
                if (itemCanvas != null)
                {
                    StartCoroutine(FadeInItem(itemCanvas, 0.2f));
                }
                yield return new WaitForSecondsRealtime(_statsItemInterval);
            }

            yield return new WaitForSecondsRealtime(_statsDelay);

            rankingCanvas.alpha = 0f;
            float rankingFade = 0f;
            while (rankingFade < 0.3f)
            {
                rankingFade += Time.unscaledDeltaTime;
                rankingCanvas.alpha = rankingFade / 0.3f;
                yield return null;
            }
            rankingCanvas.alpha = 1f;

            for (int i = 0; i < _rankingItems.Count; i++)
            {
                CanvasGroup itemCanvas = _rankingItems[i].GetComponent<CanvasGroup>();
                if (itemCanvas != null)
                {
                    StartCoroutine(FadeInItem(itemCanvas, 0.15f));
                }
                yield return new WaitForSecondsRealtime(_statsItemInterval * 0.5f);
            }

            yield return new WaitForSecondsRealtime(_statsDelay);

            buttonsCanvas.alpha = 0f;
            float buttonsFade = 0f;
            while (buttonsFade < 0.3f)
            {
                buttonsFade += Time.unscaledDeltaTime;
                buttonsCanvas.alpha = buttonsFade / 0.3f;
                yield return null;
            }
            buttonsCanvas.alpha = 1f;
        }

        /// <summary>
        /// 淡入元素
        /// </summary>
        private System.Collections.IEnumerator FadeInItem(CanvasGroup canvasGroup, float duration)
        {
            float elapsed = 0f;
            canvasGroup.transform.localScale = new Vector3(0.8f, 0.8f, 1f);

            while (elapsed < duration)
            {
                elapsed += Time.unscaledDeltaTime;
                float t = elapsed / duration;
                t = 1f - Mathf.Pow(1f - t, 3f);

                canvasGroup.alpha = t;
                canvasGroup.transform.localScale = Vector3.Lerp(new Vector3(0.8f, 0.8f, 1f), Vector3.one, t);

                yield return null;
            }

            canvasGroup.alpha = 1f;
            canvasGroup.transform.localScale = Vector3.one;
        }

        /// <summary>
        /// 面板显示时调用
        /// </summary>
        protected override void OnShow()
        {
            base.OnShow();
            PlayEntranceAnimation();
        }
    }

    /// <summary>
    /// 玩家统计数据
    /// </summary>
    [Serializable]
    public class PlayerStats
    {
        public string PlayerID;
        public string PlayerName;
        public int KillCount;
        public int BuildCount;
        public int ResourcesGathered;
        public int UnitsProduced;
        public int Score;

        public PlayerStats(string playerId, string playerName)
        {
            PlayerID = playerId;
            PlayerName = playerName;
            KillCount = 0;
            BuildCount = 0;
            ResourcesGathered = 0;
            UnitsProduced = 0;
            Score = 0;
        }

        public void CalculateScore()
        {
            Score = KillCount * 100 + BuildCount * 50 + ResourcesGathered * 10 + UnitsProduced * 30;
        }
    }
}
