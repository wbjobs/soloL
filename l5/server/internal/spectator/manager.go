package spectator

import (
	"fmt"
	"sync"
	"time"

	"github.com/timeline-wars/server/internal/ws"
)

type Spectator struct {
	ID       string
	PlayerID string
	RoomID   string
	Client   *ws.Client
	JoinedAt int64
}

type SpectatorManager struct {
	spectators           map[string]*Spectator
	roomSpectators       map[string]map[string]bool
	hub                  *ws.Hub
	mu                   sync.RWMutex
	maxSpectatorsPerRoom int
}

func NewSpectatorManager(hub *ws.Hub) *SpectatorManager {
	return &SpectatorManager{
		spectators:           make(map[string]*Spectator),
		roomSpectators:       make(map[string]map[string]bool),
		hub:                  hub,
		maxSpectatorsPerRoom: 10,
	}
}

func (sm *SpectatorManager) AddSpectator(roomID string, playerID string, client *ws.Client) error {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if _, exists := sm.spectators[playerID]; exists {
		return fmt.Errorf("player %s is already a spectator", playerID)
	}

	if sm.GetSpectatorCount(roomID) >= sm.maxSpectatorsPerRoom {
		return fmt.Errorf("room %s has reached the spectator limit", roomID)
	}

	spectator := &Spectator{
		ID:       client.ID,
		PlayerID: playerID,
		RoomID:   roomID,
		Client:   client,
		JoinedAt: time.Now().Unix(),
	}

	sm.spectators[playerID] = spectator

	if _, ok := sm.roomSpectators[roomID]; !ok {
		sm.roomSpectators[roomID] = make(map[string]bool)
	}
	sm.roomSpectators[roomID][playerID] = true

	return nil
}

func (sm *SpectatorManager) RemoveSpectator(playerID string) error {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	spectator, exists := sm.spectators[playerID]
	if !exists {
		return fmt.Errorf("spectator %s not found", playerID)
	}

	delete(sm.spectators, playerID)

	if roomSpecs, ok := sm.roomSpectators[spectator.RoomID]; ok {
		delete(roomSpecs, playerID)
		if len(roomSpecs) == 0 {
			delete(sm.roomSpectators, spectator.RoomID)
		}
	}

	return nil
}

func (sm *SpectatorManager) GetSpectator(playerID string) (*Spectator, bool) {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	spectator, ok := sm.spectators[playerID]
	return spectator, ok
}

func (sm *SpectatorManager) GetRoomSpectators(roomID string) []*Spectator {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	result := make([]*Spectator, 0)
	if playerIDs, ok := sm.roomSpectators[roomID]; ok {
		for playerID := range playerIDs {
			if spectator, exists := sm.spectators[playerID]; exists {
				result = append(result, spectator)
			}
		}
	}
	return result
}

func (sm *SpectatorManager) GetSpectatorCount(roomID string) int {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	if playerIDs, ok := sm.roomSpectators[roomID]; ok {
		return len(playerIDs)
	}
	return 0
}

func (sm *SpectatorManager) BroadcastToSpectators(roomID string, msgType string, data interface{}) {
	sm.mu.RLock()
	playerIDs, ok := sm.roomSpectators[roomID]
	if !ok {
		sm.mu.RUnlock()
		return
	}

	spectators := make([]*Spectator, 0, len(playerIDs))
	for playerID := range playerIDs {
		if spectator, exists := sm.spectators[playerID]; exists {
			spectators = append(spectators, spectator)
		}
	}
	sm.mu.RUnlock()

	for _, spectator := range spectators {
		spectator.Client.SendMessageWithType(msgType, data)
	}
}

func (sm *SpectatorManager) IsSpectator(playerID string) bool {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	_, ok := sm.spectators[playerID]
	return ok
}

func (sm *SpectatorManager) CleanRoomSpectators(roomID string) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	playerIDs, ok := sm.roomSpectators[roomID]
	if !ok {
		return
	}

	for playerID := range playerIDs {
		delete(sm.spectators, playerID)
	}
	delete(sm.roomSpectators, roomID)
}
