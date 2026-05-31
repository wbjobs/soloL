package gamesync

import (
	"context"
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

type DeltaMessage struct {
	RoomID             string              `msgpack:"roomId"`
	FrameNumber        int                 `msgpack:"frameNumber"`
	IsKeyFrame         bool                `msgpack:"isKeyFrame"`
	UpdatedUnits       []protocol.Unit     `msgpack:"updatedUnits"`
	RemovedUnitIDs     []string            `msgpack:"removedUnitIds"`
	UpdatedBuildings   []protocol.Building `msgpack:"updatedBuildings"`
	RemovedBuildingIDs []string            `msgpack:"removedBuildingIds"`
	ResourceChanges    map[string]int      `msgpack:"resourceChanges"`
	Timestamp          int64               `msgpack:"timestamp"`
}

type StateSynchronizer struct {
	mu               sync.RWMutex
	roomID           string
	snapshotInterval int
	frameCounter     int
	lastSnapshot     *protocol.GameState
	hub              *ws.Hub
	redisClient      *redis.Client
	stateProvider    GameStateProvider
}

func NewStateSynchronizer(roomID string, hub *ws.Hub, redisClient *redis.Client, stateProvider GameStateProvider) *StateSynchronizer {
	return &StateSynchronizer{
		roomID:           roomID,
		snapshotInterval: 10,
		frameCounter:     0,
		hub:              hub,
		redisClient:      redisClient,
		stateProvider:    stateProvider,
	}
}

func (ss *StateSynchronizer) SetSnapshotInterval(interval int) {
	ss.mu.Lock()
	defer ss.mu.Unlock()
	if interval > 0 {
		ss.snapshotInterval = interval
	}
}

func (ss *StateSynchronizer) BroadcastSnapshots(snapshots []protocol.GameState) error {
	if len(snapshots) == 0 {
		return errors.New("no snapshots to broadcast")
	}

	ss.mu.Lock()
	defer ss.mu.Unlock()

	for _, snapshot := range snapshots {
		ss.frameCounter++

		var delta *DeltaMessage
		var err error

		isKeyFrame := ss.frameCounter%ss.snapshotInterval == 1 || ss.lastSnapshot == nil

		if isKeyFrame {
			delta = ss.generateFullSnapshotDelta(&snapshot)
		} else {
			delta, err = ss.GenerateDelta(ss.lastSnapshot, &snapshot)
			if err != nil {
				return fmt.Errorf("failed to generate delta: %w", err)
			}
		}

		delta.FrameNumber = ss.frameCounter
		delta.IsKeyFrame = isKeyFrame

		if err := ss.broadcastDelta(delta); err != nil {
			return fmt.Errorf("failed to broadcast delta: %w", err)
		}

		ss.lastSnapshot = &snapshot
	}

	return nil
}

func (ss *StateSynchronizer) GenerateDelta(oldState, newState *protocol.GameState) (*DeltaMessage, error) {
	if oldState == nil || newState == nil {
		return nil, errors.New("state cannot be nil")
	}

	delta := &DeltaMessage{
		RoomID:             ss.roomID,
		UpdatedUnits:       make([]protocol.Unit, 0),
		RemovedUnitIDs:     make([]string, 0),
		UpdatedBuildings:   make([]protocol.Building, 0),
		RemovedBuildingIDs: make([]string, 0),
		ResourceChanges:    make(map[string]int),
		Timestamp:          time.Now().UnixMilli(),
	}

	oldUnitMap := make(map[string]protocol.Unit)
	for _, unit := range oldState.Units {
		oldUnitMap[unit.ID] = unit
	}

	for _, newUnit := range newState.Units {
		oldUnit, exists := oldUnitMap[newUnit.ID]
		if !exists {
			delta.UpdatedUnits = append(delta.UpdatedUnits, newUnit)
		} else if !unitsEqual(oldUnit, newUnit) {
			delta.UpdatedUnits = append(delta.UpdatedUnits, newUnit)
		}
		delete(oldUnitMap, newUnit.ID)
	}

	for id := range oldUnitMap {
		delta.RemovedUnitIDs = append(delta.RemovedUnitIDs, id)
	}

	oldBuildingMap := make(map[string]protocol.Building)
	for _, building := range oldState.Buildings {
		oldBuildingMap[building.ID] = building
	}

	for _, newBuilding := range newState.Buildings {
		oldBuilding, exists := oldBuildingMap[newBuilding.ID]
		if !exists {
			delta.UpdatedBuildings = append(delta.UpdatedBuildings, newBuilding)
		} else if !buildingsEqual(oldBuilding, newBuilding) {
			delta.UpdatedBuildings = append(delta.UpdatedBuildings, newBuilding)
		}
		delete(oldBuildingMap, newBuilding.ID)
	}

	for id := range oldBuildingMap {
		delta.RemovedBuildingIDs = append(delta.RemovedBuildingIDs, id)
	}

	oldPlayerMap := make(map[string]protocol.Player)
	for _, player := range oldState.Players {
		oldPlayerMap[player.ID] = player
	}

	for _, newPlayer := range newState.Players {
		oldPlayer, exists := oldPlayerMap[newPlayer.ID]
		if exists && oldPlayer.Resources != newPlayer.Resources {
			delta.ResourceChanges[newPlayer.ID] = newPlayer.Resources
		}
	}

	return delta, nil
}

func (ss *StateSynchronizer) ApplyDelta(state *protocol.GameState, delta *DeltaMessage) (*protocol.GameState, error) {
	if state == nil || delta == nil {
		return nil, errors.New("state and delta cannot be nil")
	}

	newState := *state

	newState.Units = make([]protocol.Unit, 0, len(state.Units)+len(delta.UpdatedUnits))
	unitMap := make(map[string]protocol.Unit)
	for _, unit := range state.Units {
		unitMap[unit.ID] = unit
	}

	removedSet := make(map[string]bool)
	for _, id := range delta.RemovedUnitIDs {
		removedSet[id] = true
	}

	for _, updatedUnit := range delta.UpdatedUnits {
		unitMap[updatedUnit.ID] = updatedUnit
	}

	for id, unit := range unitMap {
		if !removedSet[id] {
			newState.Units = append(newState.Units, unit)
		}
	}

	newState.Buildings = make([]protocol.Building, 0, len(state.Buildings)+len(delta.UpdatedBuildings))
	buildingMap := make(map[string]protocol.Building)
	for _, building := range state.Buildings {
		buildingMap[building.ID] = building
	}

	removedBuildingSet := make(map[string]bool)
	for _, id := range delta.RemovedBuildingIDs {
		removedBuildingSet[id] = true
	}

	for _, updatedBuilding := range delta.UpdatedBuildings {
		buildingMap[updatedBuilding.ID] = updatedBuilding
	}

	for id, building := range buildingMap {
		if !removedBuildingSet[id] {
			newState.Buildings = append(newState.Buildings, building)
		}
	}

	for playerID, newResources := range delta.ResourceChanges {
		for i := range newState.Players {
			if newState.Players[i].ID == playerID {
				newState.Players[i].Resources = newResources
				break
			}
		}
	}

	newState.Timestamp = delta.Timestamp

	return &newState, nil
}

func (ss *StateSynchronizer) BroadcastFullSnapshot() error {
	ss.mu.Lock()
	defer ss.mu.Unlock()

	if ss.stateProvider == nil {
		return errors.New("state provider not set")
	}

	currentState := ss.stateProvider.GetGameState(ss.roomID)
	if currentState == nil {
		return errors.New("no game state available")
	}

	fullGameState := ss.stateProvider.GetFullGameState(ss.roomID)

	msg := &ws.Message{
		Type: "full_state",
		Data: protocol.FullStateMessage{
			FullGameState: fullGameState,
		},
	}

	if err := ss.hub.BroadcastToRoom(ss.roomID, msg); err != nil {
		return fmt.Errorf("failed to broadcast full snapshot: %w", err)
	}

	ss.lastSnapshot = currentState
	ss.frameCounter++

	if ss.redisClient != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		snapshotData, err := msgpack.Marshal(currentState)
		if err == nil {
			ss.redisClient.SaveSnapshot(ctx, &redis.Snapshot{
				ID:        fmt.Sprintf("snap_%d_%d", time.Now().UnixNano(), ss.frameCounter),
				RoomID:    ss.roomID,
				Turn:      currentState.Turn,
				State:     map[string]interface{}{"data": snapshotData},
				CreatedAt: time.Now(),
			})
		}
	}

	return nil
}

func (ss *StateSynchronizer) SendFullSnapshotToPlayer(playerID string) error {
	ss.mu.RLock()
	defer ss.mu.RUnlock()

	if ss.stateProvider == nil {
		return errors.New("state provider not set")
	}

	fullGameState := ss.stateProvider.GetFullGameState(ss.roomID)

	msg := &ws.Message{
		Type: "full_state",
		Data: protocol.FullStateMessage{
			FullGameState: fullGameState,
		},
	}

	if err := ss.hub.SendToPlayer(playerID, msg); err != nil {
		return fmt.Errorf("failed to send full snapshot to player %s: %w", playerID, err)
	}

	return nil
}

func (ss *StateSynchronizer) GetLastSnapshot() *protocol.GameState {
	ss.mu.RLock()
	defer ss.mu.RUnlock()

	if ss.lastSnapshot == nil {
		return nil
	}

	snapshotCopy := *ss.lastSnapshot
	snapshotCopy.Units = make([]protocol.Unit, len(ss.lastSnapshot.Units))
	copy(snapshotCopy.Units, ss.lastSnapshot.Units)
	snapshotCopy.Buildings = make([]protocol.Building, len(ss.lastSnapshot.Buildings))
	copy(snapshotCopy.Buildings, ss.lastSnapshot.Buildings)
	snapshotCopy.Players = make([]protocol.Player, len(ss.lastSnapshot.Players))
	copy(snapshotCopy.Players, ss.lastSnapshot.Players)

	return &snapshotCopy
}

func (ss *StateSynchronizer) GetFrameCounter() int {
	ss.mu.RLock()
	defer ss.mu.RUnlock()
	return ss.frameCounter
}

func (ss *StateSynchronizer) generateFullSnapshotDelta(state *protocol.GameState) *DeltaMessage {
	delta := &DeltaMessage{
		RoomID:             ss.roomID,
		IsKeyFrame:         true,
		UpdatedUnits:       make([]protocol.Unit, len(state.Units)),
		RemovedUnitIDs:     make([]string, 0),
		UpdatedBuildings:   make([]protocol.Building, len(state.Buildings)),
		RemovedBuildingIDs: make([]string, 0),
		ResourceChanges:    make(map[string]int),
		Timestamp:          time.Now().UnixMilli(),
	}

	copy(delta.UpdatedUnits, state.Units)
	copy(delta.UpdatedBuildings, state.Buildings)

	for _, player := range state.Players {
		delta.ResourceChanges[player.ID] = player.Resources
	}

	return delta
}

func (ss *StateSynchronizer) broadcastDelta(delta *DeltaMessage) error {
	msg := &ws.Message{
		Type: "state_delta",
		Data: delta,
	}

	if err := ss.hub.BroadcastToRoom(ss.roomID, msg); err != nil {
		return fmt.Errorf("failed to broadcast delta: %w", err)
	}

	return nil
}

func unitsEqual(a, b protocol.Unit) bool {
	return a.ID == b.ID &&
		a.Type == b.Type &&
		a.PlayerID == b.PlayerID &&
		a.HP == b.HP &&
		a.MaxHP == b.MaxHP &&
		a.Position.X == b.Position.X &&
		a.Position.Y == b.Position.Y &&
		a.Attack == b.Attack &&
		a.Range == b.Range &&
		a.Speed == b.Speed
}

func buildingsEqual(a, b protocol.Building) bool {
	return a.ID == b.ID &&
		a.Type == b.Type &&
		a.PlayerID == b.PlayerID &&
		a.HP == b.HP &&
		a.MaxHP == b.MaxHP &&
		a.Position.X == b.Position.X &&
		a.Position.Y == b.Position.Y
}
