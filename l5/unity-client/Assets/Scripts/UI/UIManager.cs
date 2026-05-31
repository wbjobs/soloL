using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

namespace UI
{
    /// <summary>
    /// UI面板类型枚举
    /// </summary>
    public enum UIPanelType
    {
        MainMenu,
        RoomLobby,
        GameHUD,
        GameOver
    }

    /// <summary>
    /// UI管理器单例
    /// 负责管理所有UI面板的显示、隐藏和切换动画
    /// </summary>
    public class UIManager : MonoBehaviour
    {
        private static readonly Lazy<UIManager> _instance = new Lazy<UIManager>(() =>
        {
            GameObject go = new GameObject("UIManager");
            go.AddComponent<UIManager>();
            DontDestroyOnLoad(go);
            return go.GetComponent<UIManager>();
        });

        /// <summary>
        /// 单例实例
        /// </summary>
        public static UIManager Instance => _instance.Value;

        [Header("UI根节点")]
        [SerializeField] private Transform _uiRoot;

        [Header("面板切换设置")]
        [SerializeField] private float _fadeDuration = 0.3f;
        [SerializeField] private float _slideDuration = 0.4f;
        [SerializeField] private Vector2 _slideOffset = new Vector2(0f, 100f);

        private readonly Dictionary<UIPanelType, GameObject> _panels = new Dictionary<UIPanelType, GameObject>();
        private readonly Dictionary<UIPanelType, BasePanel> _panelScripts = new Dictionary<UIPanelType, BasePanel>();
        private UIPanelType _currentPanel = UIPanelType.MainMenu;

        /// <summary>
        /// 当前显示的面板
        /// </summary>
        public UIPanelType CurrentPanel => _currentPanel;

        /// <summary>
        /// 面板切换完成事件
        /// </summary>
        public event Action<UIPanelType> OnPanelChanged;

        private void Awake()
        {
            if (_instance.IsValueCreated && _instance.Value != this)
            {
                Destroy(gameObject);
                return;
            }

            DontDestroyOnLoad(gameObject);
            InitializeUIRoot();
        }

        /// <summary>
        /// 初始化UI根节点
        /// </summary>
        private void InitializeUIRoot()
        {
            if (_uiRoot == null)
            {
                GameObject canvasObj = new GameObject("UICanvas");
                canvasObj.transform.SetParent(transform);
                Canvas canvas = canvasObj.AddComponent<Canvas>();
                canvas.renderMode = RenderMode.ScreenSpaceOverlay;
                canvas.sortingOrder = 100;

                CanvasScaler scaler = canvasObj.AddComponent<CanvasScaler>();
                scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
                scaler.referenceResolution = new Vector2(1920f, 1080f);
                scaler.matchWidthOrHeight = 0.5f;

                canvasObj.AddComponent<GraphicRaycaster>();

                _uiRoot = canvasObj.transform;
            }
        }

        /// <summary>
        /// 注册UI面板
        /// </summary>
        /// <param name="panelType">面板类型</param>
        /// <param name="panel">面板GameObject</param>
        public void RegisterPanel(UIPanelType panelType, GameObject panel)
        {
            if (panel == null)
            {
                Debug.LogError($"注册面板失败：{panelType} 面板为空");
                return;
            }

            if (_panels.ContainsKey(panelType))
            {
                Debug.LogWarning($"面板 {panelType} 已存在，将被替换");
                _panels[panelType] = panel;
            }
            else
            {
                _panels.Add(panelType, panel);
            }

            BasePanel panelScript = panel.GetComponent<BasePanel>();
            if (panelScript != null)
            {
                _panelScripts[panelType] = panelScript;
            }

            panel.SetActive(false);
            Debug.Log($"面板 {panelType} 已注册");
        }

        /// <summary>
        /// 显示指定面板
        /// </summary>
        /// <param name="panelType">要显示的面板类型</param>
        /// <param name="withAnimation">是否播放动画</param>
        public void ShowPanel(UIPanelType panelType, bool withAnimation = true)
        {
            if (!_panels.ContainsKey(panelType))
            {
                Debug.LogError($"显示面板失败：未找到面板 {panelType}");
                return;
            }

            if (_currentPanel == panelType && _panels[panelType].activeSelf)
            {
                return;
            }

            GameObject previousPanel = null;
            if (_panels.ContainsKey(_currentPanel))
            {
                previousPanel = _panels[_currentPanel];
            }

            GameObject nextPanel = _panels[panelType];

            if (withAnimation)
            {
                StartCoroutine(SwitchPanelWithAnimation(previousPanel, nextPanel, panelType));
            }
            else
            {
                if (previousPanel != null)
                {
                    previousPanel.SetActive(false);
                }
                nextPanel.SetActive(true);
                _currentPanel = panelType;
                OnPanelChanged?.Invoke(panelType);
            }
        }

        /// <summary>
        /// 隐藏当前面板
        /// </summary>
        /// <param name="withAnimation">是否播放动画</param>
        public void HideCurrentPanel(bool withAnimation = true)
        {
            if (!_panels.ContainsKey(_currentPanel))
            {
                return;
            }

            GameObject panel = _panels[_currentPanel];
            if (withAnimation)
            {
                StartCoroutine(HidePanelWithAnimation(panel));
            }
            else
            {
                panel.SetActive(false);
            }
        }

        /// <summary>
        /// 隐藏所有面板
        /// </summary>
        public void HideAllPanels()
        {
            foreach (var kvp in _panels)
            {
                kvp.Value.SetActive(false);
            }
        }

        /// <summary>
        /// 获取指定面板
        /// </summary>
        /// <param name="panelType">面板类型</param>
        /// <returns>面板GameObject</returns>
        public GameObject GetPanel(UIPanelType panelType)
        {
            _panels.TryGetValue(panelType, out GameObject panel);
            return panel;
        }

        /// <summary>
        /// 获取面板脚本
        /// </summary>
        /// <typeparam name="T">面板脚本类型</typeparam>
        /// <param name="panelType">面板类型</param>
        /// <returns>面板脚本实例</returns>
        public T GetPanelScript<T>(UIPanelType panelType) where T : BasePanel
        {
            if (_panelScripts.TryGetValue(panelType, out BasePanel script))
            {
                return script as T;
            }
            return null;
        }

        /// <summary>
        /// 带动画切换面板
        /// </summary>
        private System.Collections.IEnumerator SwitchPanelWithAnimation(GameObject previousPanel, GameObject nextPanel, UIPanelType newPanelType)
        {
            if (previousPanel != null && previousPanel.activeSelf)
            {
                yield return StartCoroutine(FadeOutPanel(previousPanel));
                yield return StartCoroutine(SlideOutPanel(previousPanel));
                previousPanel.SetActive(false);
            }

            nextPanel.SetActive(true);
            nextPanel.transform.localPosition = _slideOffset;

            CanvasGroup nextCanvasGroup = nextPanel.GetComponent<CanvasGroup>();
            if (nextCanvasGroup == null)
            {
                nextCanvasGroup = nextPanel.AddComponent<CanvasGroup>();
            }
            nextCanvasGroup.alpha = 0f;

            yield return StartCoroutine(FadeInPanel(nextCanvasGroup));
            yield return StartCoroutine(SlideInPanel(nextPanel.transform));

            _currentPanel = newPanelType;
            OnPanelChanged?.Invoke(newPanelType);
        }

        /// <summary>
        /// 面板淡入
        /// </summary>
        private System.Collections.IEnumerator FadeInPanel(CanvasGroup canvasGroup)
        {
            float elapsed = 0f;
            while (elapsed < _fadeDuration)
            {
                elapsed += Time.deltaTime;
                canvasGroup.alpha = Mathf.Clamp01(elapsed / _fadeDuration);
                yield return null;
            }
            canvasGroup.alpha = 1f;
        }

        /// <summary>
        /// 面板淡出
        /// </summary>
        private System.Collections.IEnumerator FadeOutPanel(GameObject panel)
        {
            CanvasGroup canvasGroup = panel.GetComponent<CanvasGroup>();
            if (canvasGroup == null)
            {
                canvasGroup = panel.AddComponent<CanvasGroup>();
            }

            float elapsed = 0f;
            float startAlpha = canvasGroup.alpha;
            while (elapsed < _fadeDuration)
            {
                elapsed += Time.deltaTime;
                canvasGroup.alpha = Mathf.Lerp(startAlpha, 0f, elapsed / _fadeDuration);
                yield return null;
            }
            canvasGroup.alpha = 0f;
        }

        /// <summary>
        /// 面板滑入
        /// </summary>
        private System.Collections.IEnumerator SlideInPanel(Transform panelTransform)
        {
            float elapsed = 0f;
            Vector2 startPos = _slideOffset;
            while (elapsed < _slideDuration)
            {
                elapsed += Time.deltaTime;
                float t = elapsed / _slideDuration;
                t = 1f - Mathf.Pow(1f - t, 3f);
                panelTransform.localPosition = Vector2.Lerp(startPos, Vector2.zero, t);
                yield return null;
            }
            panelTransform.localPosition = Vector3.zero;
        }

        /// <summary>
        /// 面板滑出
        /// </summary>
        private System.Collections.IEnumerator SlideOutPanel(GameObject panel)
        {
            float elapsed = 0f;
            Vector2 startPos = panel.transform.localPosition;
            Vector2 endPos = -_slideOffset;
            while (elapsed < _slideDuration)
            {
                elapsed += Time.deltaTime;
                float t = elapsed / _slideDuration;
                t = t * t * t;
                panel.transform.localPosition = Vector2.Lerp(startPos, endPos, t);
                yield return null;
            }
        }

        /// <summary>
        /// 带动画隐藏面板
        /// </summary>
        private System.Collections.IEnumerator HidePanelWithAnimation(GameObject panel)
        {
            yield return StartCoroutine(FadeOutPanel(panel));
            yield return StartCoroutine(SlideOutPanel(panel));
            panel.SetActive(false);
        }

        /// <summary>
        /// 获取UI根节点
        /// </summary>
        public Transform GetUIRoot()
        {
            return _uiRoot;
        }
    }

    /// <summary>
    /// UI面板基类
    /// </summary>
    public abstract class BasePanel : MonoBehaviour
    {
        [SerializeField] protected UIPanelType _panelType;

        /// <summary>
        /// 面板类型
        /// </summary>
        public UIPanelType PanelType => _panelType;

        protected CanvasGroup _canvasGroup;
        protected bool _isInitialized = false;

        protected virtual void Awake()
        {
            _canvasGroup = GetComponent<CanvasGroup>();
            if (_canvasGroup == null)
            {
                _canvasGroup = gameObject.AddComponent<CanvasGroup>();
            }
        }

        protected virtual void Start()
        {
            Initialize();
        }

        /// <summary>
        /// 初始化面板
        /// </summary>
        public virtual void Initialize()
        {
            if (_isInitialized) return;

            SetupUI();
            RegisterEvents();
            _isInitialized = true;
        }

        /// <summary>
        /// 设置UI元素
        /// </summary>
        protected abstract void SetupUI();

        /// <summary>
        /// 注册事件监听
        /// </summary>
        protected abstract void RegisterEvents();

        /// <summary>
        /// 取消事件监听
        /// </summary>
        protected abstract void UnregisterEvents();

        /// <summary>
        /// 显示面板
        /// </summary>
        public virtual void Show()
        {
            gameObject.SetActive(true);
            OnShow();
        }

        /// <summary>
        /// 隐藏面板
        /// </summary>
        public virtual void Hide()
        {
            OnHide();
            gameObject.SetActive(false);
        }

        /// <summary>
        /// 面板显示时调用
        /// </summary>
        protected virtual void OnShow()
        {
        }

        /// <summary>
        /// 面板隐藏时调用
        /// </summary>
        protected virtual void OnHide()
        {
        }

        protected virtual void OnDestroy()
        {
            UnregisterEvents();
        }
    }
}
