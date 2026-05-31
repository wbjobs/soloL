using System;
using UnityEngine;

namespace Game
{
    /// <summary>
    /// 单位类型枚举
    /// </summary>
    public enum UnitType
    {
        Soldier,
        Archer,
        Cavalry,
        Mage,
        Hero
    }

    /// <summary>
    /// 单位状态枚举
    /// </summary>
    public enum UnitState
    {
        Idle,
        Moving,
        Attacking,
        Dead
    }

    /// <summary>
    /// 单位基础数据
    /// </summary>
    [Serializable]
    public class UnitData
    {
        public string UnitId;
        public UnitType UnitType;
        public int OwnerPlayerId;
        public int MaxHP;
        public int Attack;
        public int Defense;
        public float MoveSpeed;
        public float AttackRange;
        public float AttackSpeed;
        public Vector3 SpawnPosition;
    }

    /// <summary>
    /// 单位视图类
    /// 挂载到单位GameObject上，负责单位的视觉表现和交互
    /// </summary>
    public class UnitView : MonoBehaviour
    {
        [Header("引用")]
        [SerializeField] private Animator _animator;
        [SerializeField] private Transform _visualTransform;
        [SerializeField] private GameObject _selectionIndicator;
        [SerializeField] private GameObject _hpBarRoot;
        [SerializeField] private SpriteRenderer _hpBarFill;
        [SerializeField] private SpriteRenderer _unitSprite;

        [Header("移动设置")]
        [SerializeField] private float _moveLerpSpeed = 10f;
        [SerializeField] private float _rotationLerpSpeed = 15f;

        [Header("材质设置")]
        [SerializeField] private Material _player1Material;
        [SerializeField] private Material _player2Material;

        private UnitData _unitData;
        private int _currentHP;
        private Vector3 _targetPosition;
        private Vector3 _previousPosition;
        private Quaternion _targetRotation;
        private UnitState _currentState;
        private bool _isSelected;
        private float _attackCooldownTimer;
        private Color _originalColor;

        /// <summary>
        /// 单位数据
        /// </summary>
        public UnitData UnitData => _unitData;

        /// <summary>
        /// 当前生命值
        /// </summary>
        public int CurrentHP
        {
            get => _currentHP;
            private set
            {
                _currentHP = Mathf.Clamp(value, 0, _unitData != null ? _unitData.MaxHP : 0);
                UpdateHPBar();
            }
        }

        /// <summary>
        /// 目标位置
        /// </summary>
        public Vector3 TargetPosition
        {
            get => _targetPosition;
            set => _targetPosition = value;
        }

        /// <summary>
        /// 当前状态
        /// </summary>
        public UnitState CurrentState => _currentState;

        /// <summary>
        /// 是否已选中
        /// </summary>
        public bool IsSelected => _isSelected;

        /// <summary>
        /// 单位死亡事件
        /// </summary>
        public event Action<UnitView> OnUnitDeath;

        /// <summary>
        /// 单位被点击事件
        /// </summary>
        public event Action<UnitView> OnUnitClicked;

        /// <summary>
        /// 初始化单位
        /// </summary>
        /// <param name="data">单位数据</param>
        public void Initialize(UnitData data)
        {
            _unitData = data;
            _currentHP = data.MaxHP;
            _targetPosition = data.SpawnPosition;
            _previousPosition = data.SpawnPosition;
            transform.position = data.SpawnPosition;
            _currentState = UnitState.Idle;
            _isSelected = false;

            InitializeVisuals();
            UpdateHPBar();
            UpdateSelectionIndicator();
        }

        /// <summary>
        /// 初始化视觉效果
        /// </summary>
        private void InitializeVisuals()
        {
            if (_unitSprite != null)
            {
                _originalColor = _unitSprite.color;

                if (_unitData.OwnerPlayerId == 1 && _player1Material != null)
                {
                    _unitSprite.material = _player1Material;
                }
                else if (_unitData.OwnerPlayerId == 2 && _player2Material != null)
                {
                    _unitSprite.material = _player2Material;
                }
            }

            if (_hpBarRoot != null)
            {
                _hpBarRoot.SetActive(true);
            }
        }

        private void Update()
        {
            UpdateMovement();
            UpdateAttackCooldown();
        }

        /// <summary>
        /// 更新移动逻辑
        /// </summary>
        private void UpdateMovement()
        {
            if (_currentState == UnitState.Dead) return;

            float distanceToTarget = Vector3.Distance(transform.position, _targetPosition);

            if (distanceToTarget > 0.01f)
            {
                _currentState = UnitState.Moving;
                UpdatePosition();
                UpdateRotation();

                if (_animator != null)
                {
                    _animator.SetBool("IsMoving", true);
                }
            }
            else if (_currentState == UnitState.Moving)
            {
                _currentState = UnitState.Idle;
                if (_animator != null)
                {
                    _animator.SetBool("IsMoving", false);
                }
            }
        }

        /// <summary>
        /// 平滑插值更新位置
        /// </summary>
        public void UpdatePosition()
        {
            if (_currentState == UnitState.Dead) return;

            transform.position = Vector3.Lerp(
                transform.position,
                _targetPosition,
                _moveLerpSpeed * Time.deltaTime
            );
        }

        /// <summary>
        /// 更新旋转朝向
        /// </summary>
        private void UpdateRotation()
        {
            Vector3 moveDirection = _targetPosition - transform.position;
            if (moveDirection.sqrMagnitude > 0.01f)
            {
                moveDirection.y = 0f;
                _targetRotation = Quaternion.LookRotation(moveDirection.normalized);
                transform.rotation = Quaternion.Lerp(
                    transform.rotation,
                    _targetRotation,
                    _rotationLerpSpeed * Time.deltaTime
                );
            }
        }

        /// <summary>
        /// 更新攻击冷却
        /// </summary>
        private void UpdateAttackCooldown()
        {
            if (_attackCooldownTimer > 0f)
            {
                _attackCooldownTimer -= Time.deltaTime;
            }
        }

        /// <summary>
        /// 更新HP显示
        /// </summary>
        /// <param name="newHP">新的生命值</param>
        public void UpdateHP(int newHP)
        {
            int oldHP = _currentHP;
            CurrentHP = newHP;

            if (newHP < oldHP)
            {
                PlayDamageAnimation();
            }

            if (_currentHP <= 0 && _currentState != UnitState.Dead)
            {
                PlayDeathAnimation();
            }
        }

        /// <summary>
        /// 更新血条显示
        /// </summary>
        private void UpdateHPBar()
        {
            if (_hpBarFill == null || _unitData == null) return;

            float hpPercent = (float)_currentHP / _unitData.MaxHP;
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
        /// 播放攻击动画
        /// </summary>
        /// <param name="targetPosition">目标位置</param>
        public void PlayAttackAnimation(Vector3 targetPosition)
        {
            if (_currentState == UnitState.Dead || _attackCooldownTimer > 0f) return;

            _currentState = UnitState.Attacking;
            _attackCooldownTimer = _unitData.AttackSpeed;

            Vector3 lookDirection = targetPosition - transform.position;
            lookDirection.y = 0f;
            if (lookDirection.sqrMagnitude > 0.01f)
            {
                transform.rotation = Quaternion.LookRotation(lookDirection.normalized);
            }

            if (_animator != null)
            {
                _animator.SetTrigger("Attack");
            }

            if (_unitSprite != null)
            {
                StartCoroutine(AttackFlashCoroutine());
            }

            Invoke(nameof(ResetToIdle), _unitData.AttackSpeed * 0.8f);
        }

        /// <summary>
        /// 攻击闪烁协程
        /// </summary>
        private System.Collections.IEnumerator AttackFlashCoroutine()
        {
            _unitSprite.color = Color.white;
            yield return new WaitForSeconds(0.1f);
            _unitSprite.color = _originalColor;
        }

        /// <summary>
        /// 重置为空闲状态
        /// </summary>
        private void ResetToIdle()
        {
            if (_currentState == UnitState.Attacking)
            {
                _currentState = UnitState.Idle;
            }
        }

        /// <summary>
        /// 播放死亡动画
        /// </summary>
        public void PlayDeathAnimation()
        {
            if (_currentState == UnitState.Dead) return;

            _currentState = UnitState.Dead;

            if (_animator != null)
            {
                _animator.SetTrigger("Death");
            }

            if (_selectionIndicator != null)
            {
                _selectionIndicator.SetActive(false);
            }

            if (_hpBarRoot != null)
            {
                _hpBarRoot.SetActive(false);
            }

            StartCoroutine(DeathFadeCoroutine());
            OnUnitDeath?.Invoke(this);
        }

        /// <summary>
        /// 死亡渐隐协程
        /// </summary>
        private System.Collections.IEnumerator DeathFadeCoroutine()
        {
            float fadeDuration = 1.5f;
            float elapsed = 0f;

            while (elapsed < fadeDuration)
            {
                elapsed += Time.deltaTime;
                float alpha = 1f - (elapsed / fadeDuration);

                if (_unitSprite != null)
                {
                    Color color = _unitSprite.color;
                    color.a = alpha;
                    _unitSprite.color = color;
                }

                yield return null;
            }

            Destroy(gameObject, 0.1f);
        }

        /// <summary>
        /// 播放受伤动画
        /// </summary>
        public void PlayDamageAnimation()
        {
            if (_currentState == UnitState.Dead) return;

            if (_unitSprite != null)
            {
                StartCoroutine(DamageFlashCoroutine());
            }

            if (_animator != null)
            {
                _animator.SetTrigger("Hit");
            }
        }

        /// <summary>
        /// 受伤闪烁协程
        /// </summary>
        private System.Collections.IEnumerator DamageFlashCoroutine()
        {
            _unitSprite.color = Color.red;
            yield return new WaitForSeconds(0.15f);
            _unitSprite.color = _originalColor;
        }

        /// <summary>
        /// 选中单位
        /// </summary>
        public void OnSelected()
        {
            _isSelected = true;
            UpdateSelectionIndicator();
        }

        /// <summary>
        /// 取消选中
        /// </summary>
        public void OnDeselected()
        {
            _isSelected = false;
            UpdateSelectionIndicator();
        }

        /// <summary>
        /// 更新选中指示器
        /// </summary>
        private void UpdateSelectionIndicator()
        {
            if (_selectionIndicator != null)
            {
                _selectionIndicator.SetActive(_isSelected);
            }
        }

        /// <summary>
        /// 鼠标点击处理
        /// </summary>
        private void OnMouseDown()
        {
            OnUnitClicked?.Invoke(this);
        }

        /// <summary>
        /// 设置位置（用于同步时的直接设置）
        /// </summary>
        /// <param name="position">新位置</param>
        public void SetPosition(Vector3 position)
        {
            _previousPosition = transform.position;
            _targetPosition = position;
        }

        /// <summary>
        /// 从网络状态更新
        /// </summary>
        /// <param name="position">位置</param>
        /// <param name="hp">生命值</param>
        /// <param name="state">状态</param>
        public void UpdateFromNetwork(Vector3 position, int hp, UnitState state)
        {
            SetPosition(position);
            UpdateHP(hp);
            _currentState = state;
        }
    }
}
