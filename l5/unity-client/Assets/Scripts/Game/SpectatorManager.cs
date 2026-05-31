using System;
using UnityEngine;
using Network;
using Protocol;

namespace Game
{
    public class SpectatorManager : MonoBehaviour
    {
        private static SpectatorManager _instance;
        public static SpectatorManager Instance
        {
            get
            {
                if (_instance == null)
                {
                    _instance = FindObjectOfType<SpectatorManager>();
                    if (_instance == null)
                    {
                        GameObject go = new GameObject("SpectatorManager");
                        _instance = go.AddComponent<SpectatorManager>();
                        DontDestroyOnLoad(go);
                    }
                }
                return _instance;
            }
        }

        public bool IsSpectating { get; private set; }
        public string SpectatingRoomID { get; private set; }
        public string SpectatorPlayerID { get; private set; }

        public event Action<SpectateJoinResponse> OnSpectateJoined;
        public event Action OnSpectateLeft;
        public event Action<GameState> OnSpectateStateReceived;
        public event Action<PhaseChangeMessage> OnSpectatePhaseChanged;
        public event Action<GameOverMessage> OnSpectateGameOver;
        public event Action<ValidationResultMessage> OnValidationResult;

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
            nm.RegisterHandler<SpectateJoinResponse>(Constants.MsgTypeSpectateJoin, HandleSpectateJoinResponse);
            nm.RegisterHandler<StateSnapshotMessage>(Constants.MsgTypeSpectateState, HandleSpectateState);
            nm.RegisterHandler<PhaseChangeMessage>(Constants.MsgTypePhaseChange, HandleSpectatePhaseChange);
            nm.RegisterHandler<GameOverMessage>(Constants.MsgTypeGameOver, HandleSpectateGameOver);
            nm.RegisterHandler<ValidationResultMessage>(Constants.MsgTypeValidationResult, HandleValidationResult);
        }

        public void JoinSpectate(string roomID, string playerName = "Spectator")
        {
            var req = new SpectateJoinRequest
            {
                PlayerID = "",
                PlayerName = playerName,
                RoomID = roomID
            };

            NetworkManager.Instance.Send(Constants.MsgTypeSpectateJoin, req);
            Debug.Log($"[SpectatorManager] Requesting to spectate room: {roomID}");
        }

        public void LeaveSpectate()
        {
            if (!IsSpectating) return;

            var req = new SpectateLeaveRequest
            {
                PlayerID = SpectatorPlayerID,
                RoomID = SpectatingRoomID
            };

            NetworkManager.Instance.Send(Constants.MsgTypeSpectateLeave, req);
            IsSpectating = false;
            SpectatingRoomID = null;
            OnSpectateLeft?.Invoke();
            Debug.Log("[SpectatorManager] Left spectate mode");
        }

        private void HandleSpectateJoinResponse(SpectateJoinResponse resp)
        {
            if (resp.Success)
            {
                IsSpectating = true;
                SpectatingRoomID = resp.RoomID;
                OnSpectateJoined?.Invoke(resp);
                Debug.Log($"[SpectatorManager] Joined spectate for room: {resp.RoomID}");
            }
            else
            {
                Debug.LogWarning($"[SpectatorManager] Failed to join spectate: {resp.Message}");
            }
        }

        private void HandleSpectateState(StateSnapshotMessage msg)
        {
            if (!IsSpectating) return;
            OnSpectateStateReceived?.Invoke(msg.GameState);
        }

        private void HandleSpectatePhaseChange(PhaseChangeMessage msg)
        {
            if (!IsSpectating) return;
            OnSpectatePhaseChanged?.Invoke(msg);
        }

        private void HandleSpectateGameOver(GameOverMessage msg)
        {
            if (!IsSpectating) return;
            OnSpectateGameOver?.Invoke(msg);
            IsSpectating = false;
        }

        private void HandleValidationResult(ValidationResultMessage msg)
        {
            if (!msg.Valid)
            {
                Debug.LogWarning($"[SpectatorManager] Validation failed for player {msg.PlayerID}: {msg.Errors?.Length} errors");
            }
            OnValidationResult?.Invoke(msg);
        }

        private void OnDestroy()
        {
            if (_instance == this)
            {
                _instance = null;
            }
        }
    }
}
