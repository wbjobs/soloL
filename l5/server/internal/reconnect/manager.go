package reconnect

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/vmihailenco/msgpack/v5"
	"github.com/timeline-wars/server/internal/redis"
	"github.com/timeline-wars/server/internal/ws"
	"github.com/timeline-wars/server/pkg/protocol"
)

type GameStateProvider interface {
	GetGameState(roomID string) *protocol.GameState
	GetFullGameState(roomID string) protocol.FullGameState
}

type DisconnectedPlayer struct {
	PlayerID       string
	RoomID         string
	DisconnectTime int64
	TimeoutTime    int64
	ReconnectToken string
	IsAIHosted     bool
}

type ReconnectManager struct {
	mu               sync.RWMutex
	reconnectTimeout int64
	disconnected     map[string]*DisconnectedPlayer
	hub              *ws.Hub
	redisClient      *redis.Client
	stateProvider    GameStateProvider
	onPlayerTimeout  func(playerID string)
	ctx              context.Context
	cancel           context.CancelFunc
	monitoring       bool
}

func NewReconnectManager(hub *ws.Hub, redisClient *redis.Client, stateProvider GameStateProvider) *ReconnectManager {
	ctx, cancel := context.WithCancel(context.Background())
	return &ReconnectManager{
		reconnectTimeout: 30,
		disconnected:     make(map[string]*DisconnectedPlayer),
		hub:              hub,
		redisClient:      redisClient,
		stateProvider:    stateProvider,
		ctx:              ctx,
		cancel:           cancel,
		monitoring:       false,
	}
}

func (rm *ReconnectManager) SetReconnectTimeout(timeout int64) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if timeout > 0 {
		rm.reconnectTimeout = timeout
	}
}

func (rm *ReconnectManager) SetOnPlayerTimeout(callback func(playerID string)) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	rm.onPlayerTimeout = callback
}

func (rm *ReconnectManager) StartMonitoring() {
	rm.mu.Lock()
	if rm.monitoring {
		rm.mu.Unlock()
		return
	}
	rm.monitoring = true
	rm.mu.Unlock()

	go rm.monitorLoop()
}

func (rm *ReconnectManager) StopMonitoring() {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	if !rm.monitoring {
		return
	}

	rm.cancel()
	rm.monitoring = false
}

func (rm *ReconnectManager) HandleDisconnect(playerID, roomID string) (string, error) {
	if playerID == "" || roomID == "" {
		return "", errors.New("playerID and roomID cannot be empty")
	}

	rm.mu.Lock()
	defer rm.mu.Unlock()

	if _, exists := rm.disconnected[playerID]; exists {
		return "", fmt.Errorf("player %s is already marked as disconnected", playerID)
	}

	token, err := rm.GenerateReconnectToken()
	if err != nil {
		return "", fmt.Errorf("failed to generate reconnect token: %w", err)
	}

	now := time.Now().Unix()
	disconnected := &DisconnectedPlayer{
		PlayerID:       playerID,
		RoomID:         roomID,
		DisconnectTime: now,
		TimeoutTime:    now + rm.reconnectTimeout,
		ReconnectToken: token,
		IsAIHosted:     false,
	}

	rm.disconnected[playerID] = disconnected

	if err := rm.SavePlayerStateForReconnect(playerID, roomID); err != nil {
		delete(rm.disconnected, playerID)
		return "", fmt.Errorf("failed to save player state: %w", err)
	}

	if rm.redisClient != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		expiration := time.Duration(rm.reconnectTimeout+5) * time.Second
		if err := rm.redisClient.SetReconnectToken(ctx, playerID, token, expiration); err != nil {
			delete(rm.disconnected, playerID)
			return "", fmt.Errorf("failed to store reconnect token in redis: %w", err)
		}

		redisPlayer := &redis.Player{
			ID:       playerID,
			RoomID:   roomID,
			IsOnline: false,
			JoinedAt: time.Now(),
		}
		if err := rm.redisClient.SavePlayer(ctx, redisPlayer, expiration); err != nil {
			delete(rm.disconnected, playerID)
			return "", fmt.Errorf("failed to save player state in redis: %w", err)
		}
	}

	return token, nil
}

func (rm *ReconnectManager) HandleReconnect(playerID, roomID, token string, client *ws.Client) error {
	if playerID == "" || roomID == "" || token == "" {
		return errors.New("playerID, roomID and token cannot be empty")
	}

	if client == nil {
		return errors.New("client cannot be nil")
	}

	rm.mu.Lock()

	disconnected, exists := rm.disconnected[playerID]
	if !exists {
		rm.mu.Unlock()
		return fmt.Errorf("no disconnect record found for player %s", playerID)
	}

	if disconnected.RoomID != roomID {
		rm.mu.Unlock()
		return fmt.Errorf("player %s is not in room %s", playerID, roomID)
	}

	if disconnected.ReconnectToken != token {
		rm.mu.Unlock()
		return errors.New("invalid reconnect token")
	}

	now := time.Now().Unix()
	if now > disconnected.TimeoutTime {
		delete(rm.disconnected, playerID)
		rm.mu.Unlock()
		return errors.New("reconnect timeout expired")
	}

	delete(rm.disconnected, playerID)
	rm.mu.Unlock()

	if rm.redisClient != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		storedToken, err := rm.redisClient.GetReconnectToken(ctx, playerID)
		if err != nil {
			return fmt.Errorf("failed to verify token from redis: %w", err)
		}
		if storedToken != token {
			return errors.New("invalid reconnect token in redis")
		}

		redisPlayer := &redis.Player{
			ID:       playerID,
			RoomID:   roomID,
			IsOnline: true,
			JoinedAt: time.Now(),
		}
		if err := rm.redisClient.SavePlayer(ctx, redisPlayer, 24*time.Hour); err != nil {
			return fmt.Errorf("failed to update player state in redis: %w", err)
		}
	}

	client.PlayerID = playerID
	client.RoomID = roomID
	rm.hub.SetClientPlayerID(client, playerID)
	rm.hub.SetClientRoom(client, roomID)
	rm.hub.Register(client)

	if rm.stateProvider != nil {
		fullGameState := rm.stateProvider.GetFullGameState(roomID)

		msg := &ws.Message{
			Type: "reconnect_success",
			Data: map[string]interface{}{
				"roomId":    roomID,
				"playerId":  playerID,
				"gameState": fullGameState.GameState,
				"timelines": fullGameState.Timelines,
				"timestamp": time.Now().UnixMilli(),
			},
		}

		if err := client.SendMessage(msg); err != nil {
			return fmt.Errorf("failed to send reconnect success message: %w", err)
		}
	}

	go rm.notifyPlayerReconnected(playerID, roomID)

	return nil
}

func (rm *ReconnectManager) CheckTimeouts() []string {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	now := time.Now().Unix()
	timeoutedPlayers := make([]string, 0)

	for playerID, disconnected := range rm.disconnected {
		if now > disconnected.TimeoutTime {
			timeoutedPlayers = append(timeoutedPlayers, playerID)
			delete(rm.disconnected, playerID)

			if rm.onPlayerTimeout != nil {
				go rm.onPlayerTimeout(playerID)
			}

			if rm.redisClient != nil {
				go func(pid string) {
					ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
					defer cancel()
					rm.redisClient.DeletePlayer(ctx, pid)
				}(playerID)
			}
		}
	}

	return timeoutedPlayers
}

func (rm *ReconnectManager) GenerateReconnectToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("failed to generate random token: %w", err)
	}
	return hex.EncodeToString(b), nil
}

func (rm *ReconnectManager) SavePlayerStateForReconnect(playerID, roomID string) error {
	if rm.stateProvider == nil {
		return errors.New("state provider not set")
	}

	fullGameState := rm.stateProvider.GetFullGameState(roomID)

	if rm.redisClient != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		stateData, err := msgpack.Marshal(fullGameState)
		if err != nil {
			return fmt.Errorf("failed to marshal game state: %w", err)
		}

		gameState := &redis.GameState{
			RoomID:    roomID,
			Phase:     fmt.Sprintf("%d", fullGameState.GameState.Phase),
			Turn:      fullGameState.GameState.Turn,
			Data: map[string]interface{}{
				"playerID":  playerID,
				"fullState": stateData,
			},
			UpdatedAt: time.Now(),
		}

		expiration := time.Duration(rm.reconnectTimeout+10) * time.Second
		if err := rm.redisClient.SaveGameState(ctx, gameState, expiration); err != nil {
			return fmt.Errorf("failed to save game state to redis: %w", err)
		}
	}

	return nil
}

func (rm *ReconnectManager) IsPlayerDisconnected(playerID string) bool {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	_, exists := rm.disconnected[playerID]
	return exists
}

func (rm *ReconnectManager) GetDisconnectedPlayer(playerID string) (*DisconnectedPlayer, bool) {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	player, exists := rm.disconnected[playerID]
	if !exists {
		return nil, false
	}

	playerCopy := *player
	return &playerCopy, true
}

func (rm *ReconnectManager) GetAllDisconnectedPlayers() []DisconnectedPlayer {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	players := make([]DisconnectedPlayer, 0, len(rm.disconnected))
	for _, p := range rm.disconnected {
		players = append(players, *p)
	}
	return players
}

func (rm *ReconnectManager) GetRemainingTime(playerID string) (int64, error) {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	disconnected, exists := rm.disconnected[playerID]
	if !exists {
		return 0, fmt.Errorf("player %s is not disconnected", playerID)
	}

	now := time.Now().Unix()
	remaining := disconnected.TimeoutTime - now
	if remaining < 0 {
		return 0, nil
	}
	return remaining, nil
}

func (rm *ReconnectManager) ExtendReconnectTime(playerID string, extraSeconds int64) error {
	if extraSeconds <= 0 {
		return errors.New("extra seconds must be positive")
	}

	rm.mu.Lock()
	defer rm.mu.Unlock()

	disconnected, exists := rm.disconnected[playerID]
	if !exists {
		return fmt.Errorf("player %s is not disconnected", playerID)
	}

	disconnected.TimeoutTime += extraSeconds

	if rm.redisClient != nil {
		go func(pid string, token string, timeout int64) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			expiration := time.Duration(timeout+5) * time.Second
			rm.redisClient.SetReconnectToken(ctx, pid, token, expiration)
		}(playerID, disconnected.ReconnectToken, extraSeconds)
	}

	return nil
}

func (rm *ReconnectManager) CleanupDisconnectedPlayers(roomID string) int {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	count := 0
	for playerID, disconnected := range rm.disconnected {
		if disconnected.RoomID == roomID {
			delete(rm.disconnected, playerID)
			count++

			if rm.redisClient != nil {
				go func(pid string) {
					ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
					defer cancel()
					rm.redisClient.DeletePlayer(ctx, pid)
				}(playerID)
			}
		}
	}

	return count
}

func (rm *ReconnectManager) monitorLoop() {
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-rm.ctx.Done():
			return
		case <-ticker.C:
			rm.CheckTimeouts()
		}
	}
}

func (rm *ReconnectManager) notifyPlayerReconnected(playerID, roomID string) {
	notification := &ws.Message{
		Type: "player_reconnected",
		Data: map[string]interface{}{
			"playerId": playerID,
			"roomId":   roomID,
		},
	}

	if err := rm.hub.BroadcastToRoom(roomID, notification); err != nil {
		return
	}
}

func (dp *DisconnectedPlayer) IsTimeout() bool {
	return time.Now().Unix() > dp.TimeoutTime
}

func (dp *DisconnectedPlayer) RemainingTime() int64 {
	remaining := dp.TimeoutTime - time.Now().Unix()
	if remaining < 0 {
		return 0
	}
	return remaining
}
