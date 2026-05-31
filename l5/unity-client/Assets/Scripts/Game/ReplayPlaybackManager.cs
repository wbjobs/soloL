using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using Network;
using Protocol;

namespace Game
{
    public class ReplayPlaybackManager : MonoBehaviour
    {
        private static ReplayPlaybackManager _instance;
        public static ReplayPlaybackManager Instance
        {
            get
            {
                if (_instance == null)
                {
                    _instance = FindObjectOfType<ReplayPlaybackManager>();
                    if (_instance == null)
                    {
                        GameObject go = new GameObject("ReplayPlaybackManager");
                        _instance = go.AddComponent<ReplayPlaybackManager>();
                        DontDestroyOnLoad(go);
                    }
                }
                return _instance;
            }
        }

        public bool IsPlaying { get; private set; }
        public bool IsPaused { get; private set; }
        public int CurrentRound { get; private set; }
        public int TotalRounds { get; private set; }
        public float PlaybackSpeed { get; set; } = 1.0f;

        private FullGameState _replayData;
        private List<GameState> _roundStates;
        private int _currentFrameInRound;
        private Coroutine _playbackCoroutine;

        public event Action<ReplayListResponse> OnReplayListReceived;
        public event Action<FullGameState> OnReplayDataReceived;
        public event Action<GameState> OnReplayFrame;
        public event Action OnReplayStarted;
        public event Action OnReplayPaused;
        public event Action OnReplayResumed;
        public event Action OnReplayStopped;
        public event Action<int, int> OnReplayRoundChanged;

        private void Awake()
        {
            if (_instance != null && _instance != this)
            {
                Destroy(gameObject);
                return;
            }
            _instance = this;
            DontDestroyOnLoad(gameObject);

            RegisterHandlers();
        }

        private void RegisterHandlers()
        {
            var nm = NetworkManager.Instance;
            nm.RegisterHandler<ReplayListResponse>(Constants.MsgTypeReplayList, HandleReplayList);
            nm.RegisterHandler<FullGameState>(Constants.MsgTypeReplayData, HandleReplayData);
        }

        public void RequestReplayList(string roomID = "", int limit = 20)
        {
            var req = new ReplayListRequest
            {
                RoomID = roomID,
                Limit = limit
            };
            NetworkManager.Instance.Send(Constants.MsgTypeReplayList, req);
            Debug.Log("[ReplayPlaybackManager] Requesting replay list");
        }

        public void RequestReplayData(string filePath)
        {
            var req = new ReplayDataRequest
            {
                FilePath = filePath
            };
            NetworkManager.Instance.Send(Constants.MsgTypeReplayData, req);
            Debug.Log($"[ReplayPlaybackManager] Requesting replay data: {filePath}");
        }

        private void HandleReplayList(ReplayListResponse resp)
        {
            OnReplayListReceived?.Invoke(resp);
            Debug.Log($"[ReplayPlaybackManager] Received replay list: {resp.Replays?.Length ?? 0} replays");
        }

        private void HandleReplayData(FullGameState data)
        {
            _replayData = data;
            OnReplayDataReceived?.Invoke(data);
            Debug.Log($"[ReplayPlaybackManager] Received replay data for room: {data.RoomID}");
        }

        public void StartPlayback()
        {
            if (_replayData == null)
            {
                Debug.LogError("[ReplayPlaybackManager] No replay data loaded");
                return;
            }

            IsPlaying = true;
            IsPaused = false;
            CurrentRound = 0;

            if (_playbackCoroutine != null)
            {
                StopCoroutine(_playbackCoroutine);
            }
            _playbackCoroutine = StartCoroutine(PlaybackLoop());
            OnReplayStarted?.Invoke();
            Debug.Log("[ReplayPlaybackManager] Playback started");
        }

        public void PausePlayback()
        {
            if (!IsPlaying) return;
            IsPaused = true;
            OnReplayPaused?.Invoke();
            Debug.Log("[ReplayPlaybackManager] Playback paused");
        }

        public void ResumePlayback()
        {
            if (!IsPlaying || !IsPaused) return;
            IsPaused = false;
            OnReplayResumed?.Invoke();
            Debug.Log("[ReplayPlaybackManager] Playback resumed");
        }

        public void StopPlayback()
        {
            IsPlaying = false;
            IsPaused = false;

            if (_playbackCoroutine != null)
            {
                StopCoroutine(_playbackCoroutine);
                _playbackCoroutine = null;
            }

            OnReplayStopped?.Invoke();
            Debug.Log("[ReplayPlaybackManager] Playback stopped");
        }

        public void SetPlaybackSpeed(float speed)
        {
            PlaybackSpeed = Mathf.Clamp(speed, 0.25f, 4.0f);
            Debug.Log($"[ReplayPlaybackManager] Playback speed set to: {PlaybackSpeed}x");
        }

        public void NextRound()
        {
            if (CurrentRound < TotalRounds - 1)
            {
                CurrentRound++;
                OnReplayRoundChanged?.Invoke(CurrentRound, TotalRounds);
            }
        }

        public void PrevRound()
        {
            if (CurrentRound > 0)
            {
                CurrentRound--;
                OnReplayRoundChanged?.Invoke(CurrentRound, TotalRounds);
            }
        }

        private IEnumerator PlaybackLoop()
        {
            float frameInterval = 0.05f;

            while (IsPlaying)
            {
                if (IsPaused)
                {
                    yield return null;
                    continue;
                }

                yield return new WaitForSeconds(frameInterval / PlaybackSpeed);

                if (_replayData != null && _replayData.GameState.Units != null)
                {
                    OnReplayFrame?.Invoke(_replayData.GameState);
                }
            }
        }

        private void OnDestroy()
        {
            if (_playbackCoroutine != null)
            {
                StopCoroutine(_playbackCoroutine);
            }
            if (_instance == this)
            {
                _instance = null;
            }
        }
    }
}
