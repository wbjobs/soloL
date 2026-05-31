using System;
using UnityEngine;

namespace Game
{
    /// <summary>
    /// 建筑类型枚举
    /// </summary>
    public enum BuildingType
    {
        TownHall,
        Barracks,
        ArcheryRange,
        Stable,
        MageTower,
        Farm,
        Mine,
        Wall,
        Turret
    }

    /// <summary>
    /// 建筑状态枚举
    /// </summary>
    public enum BuildingState
    {
        Building,
        Active,
        Damaged,
        Destroyed
    }

    /// <summary>
    /// 建筑基础数据
    /// </summary>
    [Serializable]
    public class BuildingData
    {
        public string BuildingId;
        public BuildingType BuildingType;
        public int OwnerPlayerId;
        public int MaxHP;
        public int Defense;
        public float BuildTime;
        public Vector3 Position;
        public PlayerResources BuildCost;
    }

    /// <summary>
    /// 建筑视图类
    /// 挂载到建筑GameObject上，负责建筑的视觉表现和交互
    /// </summary>
    public class BuildingView : MonoBehaviour
    {
        [Header("引用")]
        [SerializeField] private Animator _animator;
        [SerializeField] private Transform _visualTransform;
        [SerializeField] private GameObject _hpBarRoot;
        [SerializeField] private SpriteRenderer _hpBarFill;
        [SerializeField] private SpriteRenderer _buildingSprite;
        [SerializeField] private GameObject _buildProgressRoot;
        [SerializeField] private SpriteRenderer _buildProgressFill;
        [SerializeField] private ParticleSystem _buildCompleteEffect;
        [SerializeField] private ParticleSystem _damageEffect;
        [SerializeField] private ParticleSystem _destroyEffect;

        [Header("材质设置")]
        [SerializeField] private Material _player1Material;
        [SerializeField] private Material _player2Material;
        [SerializeField] private Material _ghostMaterial;

        [Header("建造设置")]
        [SerializeField] private float _buildLerpSpeed = 5f;
        [SerializeField] private AnimationCurve _buildScaleCurve = AnimationCurve.Linear(0, 0.3f, 1, 1f);

        private BuildingData _buildingData;
        private int _currentHP;
        private float _buildProgress;
        private BuildingState _currentState;
        private Color _originalColor;
        private Vector3 _originalScale;
        private Quaternion _originalRotation;

        /// <summary>
        /// 建筑数据
        /// </summary>
        public BuildingData BuildingData => _buildingData;

        /// <summary>
        /// 当前生命值
        /// </summary>
        public int CurrentHP
        {
            get => _currentHP;
            private set
            {
                _currentHP = Mathf.Clamp(value, 0, _buildingData != null ? _buildingData.MaxHP : 0);
                UpdateHPBar();
            }
        }

        /// <summary>
        /// 建造进度 (0.0 - 1.0)
        /// </summary>
        public float BuildProgress
        {
            get => _buildProgress;
            private set
            {
                _buildProgress = Mathf.Clamp01(value);
                UpdateBuildProgress();
            }
        }

        /// <summary>
        /// 当前建筑状态
        /// </summary>
        public BuildingState CurrentState => _currentState;

        /// <summary>
        /// 建筑建造完成事件
        /// </summary>
        public event Action<BuildingView> OnBuildCompleted;

        /// <summary>
        /// 建筑被摧毁事件
        /// </summary>
        public event Action<BuildingView> OnBuildingDestroyed;

        /// <summary>
        /// 建筑被点击事件
        /// </summary>
        public event Action<BuildingView> OnBuildingClicked;

        /// <summary>
        /// 初始化建筑
        /// </summary>
        /// <param name="data">建筑数据</param>
        public void Initialize(BuildingData data)
        {
            _buildingData = data;
            _currentHP = data.MaxHP;
            _buildProgress = 0f;
            _currentState = BuildingState.Building;
            transform.position = data.Position;

            _originalScale = _visualTransform != null ? _visualTransform.localScale : transform.localScale;
            _originalRotation = _visualTransform != null ? _visualTransform.rotation : transform.rotation;

            InitializeVisuals();
            UpdateBuildProgress();
            UpdateHPBar();
        }

        /// <summary>
        /// 初始化视觉效果
        /// </summary>
        private void InitializeVisuals()
        {
            if (_buildingSprite != null)
            {
                _originalColor = _buildingSprite.color;

                if (_buildingData.OwnerPlayerId == 1 && _player1Material != null)
                {
                    _buildingSprite.material = _player1Material;
                }
                else if (_buildingData.OwnerPlayerId == 2 && _player2Material != null)
                {
                    _buildingSprite.material = _player2Material;
                }
            }

            if (_visualTransform != null)
            {
                _visualTransform.localScale = _originalScale * _buildScaleCurve.Evaluate(0f);
            }

            if (_buildProgressRoot != null)
            {
                _buildProgressRoot.SetActive(true);
            }

            if (_hpBarRoot != null)
            {
                _hpBarRoot.SetActive(false);
            }
        }

        /// <summary>
        /// 更新建造进度
        /// </summary>
        /// <param name="progress">新的建造进度 (0.0 - 1.0)</param>
        public void UpdateBuildProgress(float progress)
        {
            if (_currentState != BuildingState.Building) return;

            BuildProgress = progress;

            if (progress >= 1f)
            {
                OnBuildComplete();
            }
        }

        /// <summary>
        /// 更新建造进度条显示
        /// </summary>
        private void UpdateBuildProgress()
        {
            if (_buildProgressFill != null)
            {
                _buildProgressFill.transform.localScale = new Vector3(_buildProgress, 1f, 1f);
            }

            if (_visualTransform != null)
            {
                float targetScale = _buildScaleCurve.Evaluate(_buildProgress);
                _visualTransform.localScale = Vector3.Lerp(
                    _visualTransform.localScale,
                    _originalScale * targetScale,
                    _buildLerpSpeed * Time.deltaTime
                );
            }

            if (_buildingSprite != null)
            {
                Color color = _buildingSprite.color;
                color.a = Mathf.Lerp(0.5f, 1f, _buildProgress);
                _buildingSprite.color = color;
            }
        }

        /// <summary>
        /// 建造完成处理
        /// </summary>
        public void OnBuildComplete()
        {
            if (_currentState != BuildingState.Building) return;

            _currentState = BuildingState.Active;
            _buildProgress = 1f;

            if (_buildProgressRoot != null)
            {
                _buildProgressRoot.SetActive(false);
            }

            if (_hpBarRoot != null)
            {
                _hpBarRoot.SetActive(true);
            }

            if (_visualTransform != null)
            {
                _visualTransform.localScale = _originalScale;
            }

            if (_buildingSprite != null)
            {
                Color color = _buildingSprite.color;
                color.a = 1f;
                _buildingSprite.color = color;
            }

            if (_buildCompleteEffect != null)
            {
                _buildCompleteEffect.Play();
            }

            if (_animator != null)
            {
                _animator.SetTrigger("BuildComplete");
            }

            OnBuildCompleted?.Invoke(this);
            Debug.Log($"建筑 {_buildingData.BuildingType} 建造完成！");
        }

        /// <summary>
        /// 更新HP显示
        /// </summary>
        /// <param name="newHP">新的生命值</param>
        public void UpdateHP(int newHP)
        {
            if (_currentState == BuildingState.Destroyed) return;

            int oldHP = _currentHP;
            CurrentHP = newHP;

            if (newHP < oldHP)
            {
                PlayDamageAnimation();
            }

            if (_currentHP <= 0 && _currentState != BuildingState.Destroyed)
            {
                PlayDestroyAnimation();
            }
            else if (_currentHP < _buildingData.MaxHP * 0.3f && _currentState == BuildingState.Active)
            {
                _currentState = BuildingState.Damaged;
                if (_animator != null)
                {
                    _animator.SetBool("IsDamaged", true);
                }
            }
        }

        /// <summary>
        /// 更新血条显示
        /// </summary>
        private void UpdateHPBar()
        {
            if (_hpBarFill == null || _buildingData == null) return;

            float hpPercent = (float)_currentHP / _buildingData.MaxHP;
            _hpBarFill.transform.localScale = new Vector3(hpPercent, 1f, 1f);

            if (hpPercent > 0.6f)
            {
                _hpBarFill.color = Color.green;
            }
            else if (hpPercent > 0.3f)
            {
                _hpBarFill.color = Color.yellow;
            }
            else
            {
                _hpBarFill.color = Color.red;
            }
        }

        /// <summary>
        /// 播放受伤动画
        /// </summary>
        public void PlayDamageAnimation()
        {
            if (_currentState == BuildingState.Destroyed) return;

            if (_buildingSprite != null)
            {
                StartCoroutine(DamageFlashCoroutine());
            }

            if (_damageEffect != null)
            {
                _damageEffect.Play();
            }

            if (_animator != null)
            {
                _animator.SetTrigger("Hit");
            }

            StartCoroutine(ShakeCoroutine());
        }

        /// <summary>
        /// 受伤闪烁协程
        /// </summary>
        private System.Collections.IEnumerator DamageFlashCoroutine()
        {
            _buildingSprite.color = Color.red;
            yield return new WaitForSeconds(0.15f);
            _buildingSprite.color = _originalColor;
        }

        /// <summary>
        /// 震动效果协程
        /// </summary>
        private System.Collections.IEnumerator ShakeCoroutine()
        {
            float shakeDuration = 0.2f;
            float shakeMagnitude = 0.05f;
            Vector3 originalPosition = _visualTransform != null ? _visualTransform.localPosition : Vector3.zero;
            float elapsed = 0f;

            while (elapsed < shakeDuration)
            {
                elapsed += Time.deltaTime;
                float x = UnityEngine.Random.Range(-1f, 1f) * shakeMagnitude;
                float z = UnityEngine.Random.Range(-1f, 1f) * shakeMagnitude;

                if (_visualTransform != null)
                {
                    _visualTransform.localPosition = originalPosition + new Vector3(x, 0, z);
                }

                yield return null;
            }

            if (_visualTransform != null)
            {
                _visualTransform.localPosition = originalPosition;
            }
        }

        /// <summary>
        /// 播放摧毁动画
        /// </summary>
        public void PlayDestroyAnimation()
        {
            if (_currentState == BuildingState.Destroyed) return;

            _currentState = BuildingState.Destroyed;

            if (_hpBarRoot != null)
            {
                _hpBarRoot.SetActive(false);
            }

            if (_destroyEffect != null)
            {
                _destroyEffect.Play();
            }

            if (_animator != null)
            {
                _animator.SetTrigger("Destroy");
            }

            StartCoroutine(DestroyFadeCoroutine());
            OnBuildingDestroyed?.Invoke(this);
        }

        /// <summary>
        /// 摧毁渐隐协程
        /// </summary>
        private System.Collections.IEnumerator DestroyFadeCoroutine()
        {
            float collapseDuration = 1f;
            float fadeDuration = 0.5f;
            float elapsed = 0f;

            while (elapsed < collapseDuration)
            {
                elapsed += Time.deltaTime;
                float progress = elapsed / collapseDuration;

                if (_visualTransform != null)
                {
                    float yScale = Mathf.Lerp(1f, 0.1f, progress);
                    _visualTransform.localScale = new Vector3(
                        _visualTransform.localScale.x,
                        yScale,
                        _visualTransform.localScale.z
                    );

                    _visualTransform.position += Vector3.down * (0.5f * Time.deltaTime);
                }

                yield return null;
            }

            elapsed = 0f;
            while (elapsed < fadeDuration)
            {
                elapsed += Time.deltaTime;
                float alpha = 1f - (elapsed / fadeDuration);

                if (_buildingSprite != null)
                {
                    Color color = _buildingSprite.color;
                    color.a = alpha;
                    _buildingSprite.color = color;
                }

                yield return null;
            }

            Destroy(gameObject, 0.1f);
        }

        /// <summary>
        /// 设置为幽灵预览模式（建造前预览）
        /// </summary>
        /// <param name="isValid">位置是否有效</param>
        public void SetGhostMode(bool isValid)
        {
            if (_buildingSprite != null && _ghostMaterial != null)
            {
                _buildingSprite.material = _ghostMaterial;
                Color color = _buildingSprite.color;
                color.a = 0.6f;
                color = isValid ? Color.green : Color.red;
                _buildingSprite.color = color;
            }

            if (_buildProgressRoot != null)
            {
                _buildProgressRoot.SetActive(false);
            }

            if (_hpBarRoot != null)
            {
                _hpBarRoot.SetActive(false);
            }
        }

        /// <summary>
        /// 从网络状态更新
        /// </summary>
        /// <param name="hp">生命值</param>
        /// <param name="buildProgress">建造进度</param>
        /// <param name="state">状态</param>
        public void UpdateFromNetwork(int hp, float buildProgress, BuildingState state)
        {
            if (state == BuildingState.Building)
            {
                UpdateBuildProgress(buildProgress);
            }

            if (state != BuildingState.Destroyed)
            {
                UpdateHP(hp);
            }

            _currentState = state;
        }

        /// <summary>
        /// 鼠标点击处理
        /// </summary>
        private void OnMouseDown()
        {
            OnBuildingClicked?.Invoke(this);
        }
    }
}
