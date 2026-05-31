package gamesync

import (
	"encoding/json"
	"sync"
	"time"

	"github.com/timeline-wars/server/pkg/protocol"
)

type StateManager struct {
	mu            sync.RWMutex
	gameState     *protocol.GameState
	timelines     map[string]protocol.Timeline
	snapshots     []protocol.GameState
	subscribers   map[string]chan protocol.StateSnapshotMessage
	lastSnapshot  int64
	snapshotInterval int64
}

func NewStateManager() *StateManager {
	return &StateManager{
		timelines:        make(map[string]protocol.Timeline),
		snapshots:        make([]protocol.GameState, 0),
		subscribers:      make(map[string]chan protocol.StateSnapshotMessage),
		snapshotInterval: 100,
	}
}

func (sm *StateManager) SetGameState(state *protocol.GameState) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.gameState = state
	sm.takeSnapshot()
}

func (sm *StateManager) GetGameState() *protocol.GameState {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	if sm.gameState == nil {
		return nil
	}

	stateCopy := *sm.gameState
	stateCopy.Units = make([]protocol.Unit, len(sm.gameState.Units))
	copy(stateCopy.Units, sm.gameState.Units)
	stateCopy.Buildings = make([]protocol.Building, len(sm.gameState.Buildings))
	copy(stateCopy.Buildings, sm.gameState.Buildings)
	stateCopy.Players = make([]protocol.Player, len(sm.gameState.Players))
	copy(stateCopy.Players, sm.gameState.Players)

	return &stateCopy
}

func (sm *StateManager) SubmitTimeline(timeline protocol.Timeline) error {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	sm.timelines[timeline.PlayerID] = timeline
	return nil
}

func (sm *StateManager) GetAllTimelines() []protocol.Timeline {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	timelines := make([]protocol.Timeline, 0, len(sm.timelines))
	for _, tl := range sm.timelines {
		timelines = append(timelines, tl)
	}
	return timelines
}

func (sm *StateManager) GetTimeline(playerID string) (protocol.Timeline, bool) {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	tl, exists := sm.timelines[playerID]
	return tl, exists
}

func (sm *StateManager) ClearTimelines() {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.timelines = make(map[string]protocol.Timeline)
}

func (sm *StateManager) AllPlayersSubmitted(playerIDs []string) bool {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	for _, playerID := range playerIDs {
		if _, exists := sm.timelines[playerID]; !exists {
			return false
		}
	}
	return true
}

func (sm *StateManager) UpdateUnit(unit protocol.Unit) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if sm.gameState == nil {
		return
	}

	for i := range sm.gameState.Units {
		if sm.gameState.Units[i].ID == unit.ID {
			sm.gameState.Units[i] = unit
			sm.maybeTakeSnapshot()
			return
		}
	}
}

func (sm *StateManager) RemoveUnit(unitID string) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if sm.gameState == nil {
		return
	}

	for i := range sm.gameState.Units {
		if sm.gameState.Units[i].ID == unitID {
			sm.gameState.Units = append(sm.gameState.Units[:i], sm.gameState.Units[i+1:]...)
			sm.maybeTakeSnapshot()
			return
		}
	}
}

func (sm *StateManager) AddUnit(unit protocol.Unit) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if sm.gameState == nil {
		return
	}

	sm.gameState.Units = append(sm.gameState.Units, unit)
	sm.maybeTakeSnapshot()
}

func (sm *StateManager) UpdateBuilding(building protocol.Building) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if sm.gameState == nil {
		return
	}

	for i := range sm.gameState.Buildings {
		if sm.gameState.Buildings[i].ID == building.ID {
			sm.gameState.Buildings[i] = building
			sm.maybeTakeSnapshot()
			return
		}
	}
}

func (sm *StateManager) RemoveBuilding(buildingID string) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if sm.gameState == nil {
		return
	}

	for i := range sm.gameState.Buildings {
		if sm.gameState.Buildings[i].ID == buildingID {
			sm.gameState.Buildings = append(sm.gameState.Buildings[:i], sm.gameState.Buildings[i+1:]...)
			sm.maybeTakeSnapshot()
			return
		}
	}
}

func (sm *StateManager) AddBuilding(building protocol.Building) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if sm.gameState == nil {
		return
	}

	sm.gameState.Buildings = append(sm.gameState.Buildings, building)
	sm.maybeTakeSnapshot()
}

func (sm *StateManager) UpdatePlayer(player protocol.Player) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if sm.gameState == nil {
		return
	}

	for i := range sm.gameState.Players {
		if sm.gameState.Players[i].ID == player.ID {
			sm.gameState.Players[i] = player
			sm.maybeTakeSnapshot()
			return
		}
	}
}

func (sm *StateManager) SetPhase(phase protocol.GamePhase) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if sm.gameState == nil {
		return
	}

	sm.gameState.Phase = phase
	sm.takeSnapshot()
}

func (sm *StateManager) IncrementTurn() {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if sm.gameState == nil {
		return
	}

	sm.gameState.Turn++
	sm.takeSnapshot()
}

func (sm *StateManager) GetSnapshot(turn int) (*protocol.GameState, bool) {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	if turn < 0 || turn >= len(sm.snapshots) {
		return nil, false
	}

	snapshot := sm.snapshots[turn]
	return &snapshot, true
}

func (sm *StateManager) GetLatestSnapshot() *protocol.GameState {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	if len(sm.snapshots) == 0 {
		return nil
	}

	snapshot := sm.snapshots[len(sm.snapshots)-1]
	return &snapshot
}

func (sm *StateManager) Subscribe(playerID string) chan protocol.StateSnapshotMessage {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	ch := make(chan protocol.StateSnapshotMessage, 10)
	sm.subscribers[playerID] = ch
	return ch
}

func (sm *StateManager) Unsubscribe(playerID string) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if ch, exists := sm.subscribers[playerID]; exists {
		close(ch)
		delete(sm.subscribers, playerID)
	}
}

func (sm *StateManager) BroadcastSnapshot(roomID string) {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	if sm.gameState == nil {
		return
	}

	stateCopy := *sm.gameState
	stateCopy.Units = make([]protocol.Unit, len(sm.gameState.Units))
	copy(stateCopy.Units, sm.gameState.Units)
	stateCopy.Buildings = make([]protocol.Building, len(sm.gameState.Buildings))
	copy(stateCopy.Buildings, sm.gameState.Buildings)
	stateCopy.Players = make([]protocol.Player, len(sm.gameState.Players))
	copy(stateCopy.Players, sm.gameState.Players)

	msg := protocol.StateSnapshotMessage{
		GameState: stateCopy,
		RoomID:    roomID,
	}

	for _, ch := range sm.subscribers {
		select {
		case ch <- msg:
		default:
		}
	}
}

func (sm *StateManager) SerializeState() ([]byte, error) {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	return json.Marshal(sm.gameState)
}

func (sm *StateManager) DeserializeState(data []byte) error {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	var state protocol.GameState
	if err := json.Unmarshal(data, &state); err != nil {
		return err
	}

	sm.gameState = &state
	sm.takeSnapshot()
	return nil
}

func (sm *StateManager) takeSnapshot() {
	if sm.gameState == nil {
		return
	}

	stateCopy := *sm.gameState
	stateCopy.Units = make([]protocol.Unit, len(sm.gameState.Units))
	copy(stateCopy.Units, sm.gameState.Units)
	stateCopy.Buildings = make([]protocol.Building, len(sm.gameState.Buildings))
	copy(stateCopy.Buildings, sm.gameState.Buildings)
	stateCopy.Players = make([]protocol.Player, len(sm.gameState.Players))
	copy(stateCopy.Players, sm.gameState.Players)
	stateCopy.Timestamp = time.Now().UnixMilli()

	sm.snapshots = append(sm.snapshots, stateCopy)
	sm.lastSnapshot = time.Now().UnixMilli()
}

func (sm *StateManager) maybeTakeSnapshot() {
	now := time.Now().UnixMilli()
	if now-sm.lastSnapshot >= sm.snapshotInterval {
		sm.takeSnapshot()
	}
}

func (sm *StateManager) GetFullGameState(roomID string, playerID string) protocol.FullGameState {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	timelines := make([]protocol.Timeline, 0, len(sm.timelines))
	for _, tl := range sm.timelines {
		timelines = append(timelines, tl)
	}

	var gameState protocol.GameState
	if sm.gameState != nil {
		gameState = *sm.gameState
	}

	return protocol.FullGameState{
		RoomID:     roomID,
		PlayerID:   playerID,
		GameState:  gameState,
		Timelines:  timelines,
	}
}
