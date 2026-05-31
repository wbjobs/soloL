package game

import (
	"sync"
	"time"

	"github.com/timeline-wars/server/pkg/protocol"
)

type GameStateManager struct {
	mu        sync.RWMutex
	gameState *protocol.GameState
}

func NewGameStateManager() *GameStateManager {
	return &GameStateManager{}
}

func (gsm *GameStateManager) CreateInitialState(players []protocol.Player) *protocol.GameState {
	gsm.mu.Lock()
	defer gsm.mu.Unlock()

	state := &protocol.GameState{
		Phase:     protocol.GamePhaseLobby,
		Turn:      1,
		Units:     make([]protocol.Unit, 0),
		Buildings: make([]protocol.Building, 0),
		Players:   make([]protocol.Player, len(players)),
		Timestamp: time.Now().UnixMilli(),
	}

	copy(state.Players, players)

	for i := range state.Players {
		state.Players[i].Resources = protocol.InitialResources
		state.Players[i].Ready = false
	}

	basePositions := gsm.getBasePositions(len(players))

	for i, player := range state.Players {
		basePos := basePositions[i]

		base := protocol.Building{
			ID:       generateBaseID(player.ID),
			Type:     protocol.BuildingBase,
			PlayerID: player.ID,
			HP:       protocol.BaseHP,
			MaxHP:    protocol.BaseHP,
			Position: basePos,
		}
		state.Buildings = append(state.Buildings, base)

		initialUnits := gsm.createInitialUnits(player.ID, basePos)
		state.Units = append(state.Units, initialUnits...)
	}

	gsm.gameState = state
	return state
}

func (gsm *GameStateManager) getBasePositions(playerCount int) []protocol.Position {
	positions := make([]protocol.Position, playerCount)

	switch playerCount {
	case 1:
		positions[0] = protocol.Position{X: 1, Y: 1}
	case 2:
		positions[0] = protocol.Position{X: 1, Y: 1}
		positions[1] = protocol.Position{X: protocol.MapWidth - 2, Y: protocol.MapHeight - 2}
	case 3:
		positions[0] = protocol.Position{X: 1, Y: 1}
		positions[1] = protocol.Position{X: protocol.MapWidth - 2, Y: 1}
		positions[2] = protocol.Position{X: protocol.MapWidth / 2, Y: protocol.MapHeight - 2}
	case 4:
		positions[0] = protocol.Position{X: 1, Y: 1}
		positions[1] = protocol.Position{X: protocol.MapWidth - 2, Y: 1}
		positions[2] = protocol.Position{X: protocol.MapWidth - 2, Y: protocol.MapHeight - 2}
		positions[3] = protocol.Position{X: 1, Y: protocol.MapHeight - 2}
	default:
		for i := 0; i < playerCount; i++ {
			positions[i] = protocol.Position{
				X: (i * protocol.MapWidth / playerCount) % protocol.MapWidth,
				Y: (i * protocol.MapHeight / playerCount) % protocol.MapHeight,
			}
		}
	}

	return positions
}

func (gsm *GameStateManager) createInitialUnits(playerID string, basePos protocol.Position) []protocol.Unit {
	units := make([]protocol.Unit, 0)

	for i := 0; i < 2; i++ {
		unit := protocol.Unit{
			ID:       generateUnitID(playerID),
			Type:     protocol.UnitWarrior,
			PlayerID: playerID,
			HP:       protocol.WarriorHP,
			MaxHP:    protocol.WarriorHP,
			Position: protocol.Position{
				X: basePos.X + 1 + i,
				Y: basePos.Y,
			},
			Attack: protocol.WarriorAttack,
			Range:  protocol.WarriorRange,
			Speed:  protocol.WarriorSpeed,
		}
		units = append(units, unit)
	}

	archer := protocol.Unit{
		ID:       generateUnitID(playerID),
		Type:     protocol.UnitArcher,
		PlayerID: playerID,
		HP:       protocol.ArcherHP,
		MaxHP:    protocol.ArcherHP,
		Position: protocol.Position{
			X: basePos.X,
			Y: basePos.Y + 1,
		},
		Attack: protocol.ArcherAttack,
		Range:  protocol.ArcherRange,
		Speed:  protocol.ArcherSpeed,
	}
	units = append(units, archer)

	return units
}

func (gsm *GameStateManager) GetGameState() *protocol.GameState {
	gsm.mu.RLock()
	defer gsm.mu.RUnlock()

	if gsm.gameState == nil {
		return nil
	}

	stateCopy := *gsm.gameState
	stateCopy.Units = make([]protocol.Unit, len(gsm.gameState.Units))
	copy(stateCopy.Units, gsm.gameState.Units)
	stateCopy.Buildings = make([]protocol.Building, len(gsm.gameState.Buildings))
	copy(stateCopy.Buildings, gsm.gameState.Buildings)
	stateCopy.Players = make([]protocol.Player, len(gsm.gameState.Players))
	copy(stateCopy.Players, gsm.gameState.Players)

	return &stateCopy
}

func (gsm *GameStateManager) SetGameState(state *protocol.GameState) {
	gsm.mu.Lock()
	defer gsm.mu.Unlock()
	gsm.gameState = state
}

func (gsm *GameStateManager) SetPhase(phase protocol.GamePhase) {
	gsm.mu.Lock()
	defer gsm.mu.Unlock()

	if gsm.gameState != nil {
		gsm.gameState.Phase = phase
		gsm.gameState.Timestamp = time.Now().UnixMilli()
	}
}

func (gsm *GameStateManager) IncrementTurn() {
	gsm.mu.Lock()
	defer gsm.mu.Unlock()

	if gsm.gameState != nil {
		gsm.gameState.Turn++
		gsm.gameState.Timestamp = time.Now().UnixMilli()
	}
}

func (gsm *GameStateManager) GetPlayer(playerID string) (*protocol.Player, bool) {
	gsm.mu.RLock()
	defer gsm.mu.RUnlock()

	if gsm.gameState == nil {
		return nil, false
	}

	for i := range gsm.gameState.Players {
		if gsm.gameState.Players[i].ID == playerID {
			player := gsm.gameState.Players[i]
			return &player, true
		}
	}
	return nil, false
}

func (gsm *GameStateManager) UpdatePlayerResources(playerID string, amount int) bool {
	gsm.mu.Lock()
	defer gsm.mu.Unlock()

	if gsm.gameState == nil {
		return false
	}

	for i := range gsm.gameState.Players {
		if gsm.gameState.Players[i].ID == playerID {
			gsm.gameState.Players[i].Resources += amount
			if gsm.gameState.Players[i].Resources < 0 {
				gsm.gameState.Players[i].Resources = 0
			}
			return true
		}
	}
	return false
}

func (gsm *GameStateManager) GetPlayerIDs() []string {
	gsm.mu.RLock()
	defer gsm.mu.RUnlock()

	if gsm.gameState == nil {
		return nil
	}

	ids := make([]string, len(gsm.gameState.Players))
	for i, player := range gsm.gameState.Players {
		ids[i] = player.ID
	}
	return ids
}

func (gsm *GameStateManager) GetBaseForPlayer(playerID string) (*protocol.Building, bool) {
	gsm.mu.RLock()
	defer gsm.mu.RUnlock()

	if gsm.gameState == nil {
		return nil, false
	}

	for i := range gsm.gameState.Buildings {
		if gsm.gameState.Buildings[i].PlayerID == playerID &&
			gsm.gameState.Buildings[i].Type == protocol.BuildingBase {
			building := gsm.gameState.Buildings[i]
			return &building, true
		}
	}
	return nil, false
}

func generateBaseID(playerID string) string {
	return "base_" + playerID
}
