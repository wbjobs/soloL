package game

import (
	"errors"
	"sync"
	"time"

	"github.com/timeline-wars/server/internal/conflict"
	"github.com/timeline-wars/server/internal/simulation"
	gamesync "github.com/timeline-wars/server/internal/gamesync"
	"github.com/timeline-wars/server/pkg/protocol"
)

type GameEngine struct {
	mu              sync.RWMutex
	roomID          string
	stateManager    *GameStateManager
	unitManager     *UnitManager
	buildingManager *BuildingManager
	simulator       *simulation.SimulationEngine
	conflict        *conflict.Detector
	syncManager     *gamesync.StateManager
	phaseEndTime    int64
	gameOver        bool
	winnerTeam      int
	winnerPlayers   []protocol.Player
}

func NewGameEngine(roomID string) *GameEngine {
	return &GameEngine{
		roomID:          roomID,
		stateManager:    NewGameStateManager(),
		unitManager:     NewUnitManager(),
		buildingManager: NewBuildingManager(),
		simulator:       simulation.NewSimulationEngine(time.Now().UnixNano()),
		conflict:        conflict.NewDetector(),
		syncManager:     gamesync.NewStateManager(),
		gameOver:        false,
		winnerTeam:      0,
		winnerPlayers:   make([]protocol.Player, 0),
	}
}

func (ge *GameEngine) StartGame(players []protocol.Player) (*protocol.GameState, error) {
	ge.mu.Lock()
	defer ge.mu.Unlock()

	if len(players) < 2 {
		return nil, errors.New("at least 2 players required")
	}

	gameState := ge.stateManager.CreateInitialState(players)
	gameState.Phase = protocol.GamePhasePlanning

	ge.unitManager.SetGameState(gameState)
	ge.buildingManager.SetGameState(gameState)
	ge.conflict.SetGameState(gameState)
	ge.syncManager.SetGameState(gameState)

	ge.gameOver = false
	ge.winnerTeam = 0
	ge.winnerPlayers = make([]protocol.Player, 0)

	return gameState, nil
}

func (ge *GameEngine) StartPlanningPhase() (int64, error) {
	ge.mu.Lock()
	defer ge.mu.Unlock()

	if ge.gameOver {
		return 0, errors.New("game already over")
	}

	currentState := ge.stateManager.GetGameState()
	if currentState == nil {
		return 0, errors.New("game not started")
	}

	ge.stateManager.SetPhase(protocol.GamePhasePlanning)
	ge.syncManager.SetPhase(protocol.GamePhasePlanning)

	phaseEndTime := time.Now().UnixMilli() + int64(protocol.PlanningPhaseDuration)*1000
	ge.phaseEndTime = phaseEndTime

	ge.syncManager.ClearTimelines()

	return phaseEndTime, nil
}

func (ge *GameEngine) StartSimulatingPhase() ([]simulation.FrameResult, error) {
	ge.mu.Lock()
	defer ge.mu.Unlock()

	if ge.gameOver {
		return nil, errors.New("game already over")
	}

	currentState := ge.stateManager.GetGameState()
	if currentState == nil {
		return nil, errors.New("game not started")
	}

	playerIDs := ge.stateManager.GetPlayerIDs()
	if !ge.syncManager.AllPlayersSubmitted(playerIDs) {
		return nil, errors.New("not all players submitted timelines")
	}

	ge.stateManager.SetPhase(protocol.GamePhaseSimulating)
	ge.syncManager.SetPhase(protocol.GamePhaseSimulating)

	phaseEndTime := time.Now().UnixMilli() + int64(protocol.SimulatingPhaseDuration)*1000
	ge.phaseEndTime = phaseEndTime

	timelines := ge.syncManager.GetAllTimelines()
	results, err := ge.simulator.Simulate(*currentState, timelines)
	if err != nil {
		return nil, err
	}

	if len(results) > 0 {
		lastResult := results[len(results)-1]
		finalState := lastResult.GameState

		ge.stateManager.SetGameState(&finalState)
		ge.unitManager.SetGameState(&finalState)
		ge.buildingManager.SetGameState(&finalState)
		ge.conflict.SetGameState(&finalState)
		ge.syncManager.SetGameState(&finalState)

		if finalState.Phase == protocol.GamePhaseGameOver {
			ge.gameOver = true
			ge.winnerTeam = lastResult.GameState.Turn
			ge.winnerPlayers = ge.getWinnerPlayers(lastResult.GameState)
		}
	}

	ge.syncManager.BroadcastSnapshot(ge.roomID)

	return results, nil
}

func (ge *GameEngine) ProcessRound() (*protocol.GameState, []simulation.FrameResult, error) {
	ge.mu.Lock()
	defer ge.mu.Unlock()

	if ge.gameOver {
		return nil, nil, errors.New("game already over")
	}

	currentState := ge.stateManager.GetGameState()
	if currentState == nil {
		return nil, nil, errors.New("game not started")
	}

	playerIDs := ge.stateManager.GetPlayerIDs()
	if !ge.syncManager.AllPlayersSubmitted(playerIDs) {
		return nil, nil, errors.New("not all players submitted timelines")
	}

	ge.stateManager.SetPhase(protocol.GamePhaseSimulating)
	ge.syncManager.SetPhase(protocol.GamePhaseSimulating)

	timelines := ge.syncManager.GetAllTimelines()
	results, err := ge.simulator.Simulate(*currentState, timelines)
	if err != nil {
		return nil, nil, err
	}

	var finalState protocol.GameState
	if len(results) > 0 {
		lastResult := results[len(results)-1]
		finalState = lastResult.GameState

		ge.stateManager.SetGameState(&finalState)
		ge.unitManager.SetGameState(&finalState)
		ge.buildingManager.SetGameState(&finalState)
		ge.conflict.SetGameState(&finalState)
		ge.syncManager.SetGameState(&finalState)

		if finalState.Phase == protocol.GamePhaseGameOver {
			ge.gameOver = true
			ge.winnerTeam = lastResult.GameState.Turn
			ge.winnerPlayers = ge.getWinnerPlayers(lastResult.GameState)
		}
	}

	ge.processResources()

	ge.stateManager.IncrementTurn()
	ge.syncManager.IncrementTurn()

	updatedState := ge.stateManager.GetGameState()
	ge.unitManager.SetGameState(updatedState)
	ge.buildingManager.SetGameState(updatedState)
	ge.conflict.SetGameState(updatedState)
	ge.syncManager.SetGameState(updatedState)

	ge.syncManager.ClearTimelines()

	ge.syncManager.BroadcastSnapshot(ge.roomID)

	gameOver, winnerTeam, winnerPlayers := ge.checkGameOverInternal()
	if gameOver {
		ge.gameOver = true
		ge.winnerTeam = winnerTeam
		ge.winnerPlayers = winnerPlayers
		ge.stateManager.SetPhase(protocol.GamePhaseGameOver)
		ge.syncManager.SetPhase(protocol.GamePhaseGameOver)
	}

	return updatedState, results, nil
}

func (ge *GameEngine) CheckGameOver() (bool, int, []protocol.Player) {
	ge.mu.RLock()
	defer ge.mu.RUnlock()

	return ge.checkGameOverInternal()
}

func (ge *GameEngine) checkGameOverInternal() (bool, int, []protocol.Player) {
	alivePlayers := ge.conflict.GetAlivePlayers()

	if len(alivePlayers) == 0 {
		return true, 0, nil
	}

	if len(alivePlayers) == 1 {
		currentState := ge.stateManager.GetGameState()
		if currentState == nil {
			return true, 0, nil
		}

		winnerPlayer := make([]protocol.Player, 0)
		var winnerTeam int

		for _, player := range currentState.Players {
			if player.ID == alivePlayers[0] {
				winnerPlayer = append(winnerPlayer, player)
				winnerTeam = player.Team
				break
			}
		}

		return true, winnerTeam, winnerPlayer
	}

	teamMap := make(map[int]int)
	currentState := ge.stateManager.GetGameState()
	if currentState != nil {
		for _, playerID := range alivePlayers {
			for _, player := range currentState.Players {
				if player.ID == playerID {
					teamMap[player.Team]++
				}
			}
		}
	}

	if len(teamMap) == 1 {
		var winningTeam int
		for team := range teamMap {
			winningTeam = team
		}

		winnerPlayers := make([]protocol.Player, 0)
		for _, player := range currentState.Players {
			if player.Team == winningTeam {
				for _, aliveID := range alivePlayers {
					if player.ID == aliveID {
						winnerPlayers = append(winnerPlayers, player)
						break
					}
				}
			}
		}

		return true, winningTeam, winnerPlayers
	}

	return false, 0, nil
}

func (ge *GameEngine) SubmitTimeline(timeline protocol.Timeline) error {
	ge.mu.RLock()
	defer ge.mu.RUnlock()

	if ge.gameOver {
		return errors.New("game already over")
	}

	currentState := ge.stateManager.GetGameState()
	if currentState == nil {
		return errors.New("game not started")
	}

	if currentState.Phase != protocol.GamePhasePlanning {
		return errors.New("can only submit during planning phase")
	}

	_, exists := ge.stateManager.GetPlayer(timeline.PlayerID)
	if !exists {
		return errors.New("player not in game")
	}

	return ge.syncManager.SubmitTimeline(timeline)
}

func (ge *GameEngine) GetGameState() *protocol.GameState {
	ge.mu.RLock()
	defer ge.mu.RUnlock()

	return ge.stateManager.GetGameState()
}

func (ge *GameEngine) GetFullGameState() protocol.FullGameState {
	ge.mu.RLock()
	defer ge.mu.RUnlock()

	return ge.syncManager.GetFullGameState(ge.roomID, "")
}

func (ge *GameEngine) GetFullGameStateForPlayer(playerID string) protocol.FullGameState {
	ge.mu.RLock()
	defer ge.mu.RUnlock()

	return ge.syncManager.GetFullGameState(ge.roomID, playerID)
}

func (ge *GameEngine) GetUnitManager() *UnitManager {
	return ge.unitManager
}

func (ge *GameEngine) GetBuildingManager() *BuildingManager {
	return ge.buildingManager
}

func (ge *GameEngine) GetStateManager() *GameStateManager {
	return ge.stateManager
}

func (ge *GameEngine) GetSyncManager() *gamesync.StateManager {
	return ge.syncManager
}

func (ge *GameEngine) GetSimulator() *simulation.SimulationEngine {
	return ge.simulator
}

func (ge *GameEngine) GetConflictDetector() *conflict.Detector {
	return ge.conflict
}

func (ge *GameEngine) IsGameOver() bool {
	ge.mu.RLock()
	defer ge.mu.RUnlock()

	return ge.gameOver
}

func (ge *GameEngine) GetWinner() (int, []protocol.Player) {
	ge.mu.RLock()
	defer ge.mu.RUnlock()

	return ge.winnerTeam, ge.winnerPlayers
}

func (ge *GameEngine) GetPhaseEndTime() int64 {
	ge.mu.RLock()
	defer ge.mu.RUnlock()

	return ge.phaseEndTime
}

func (ge *GameEngine) GetRoomID() string {
	return ge.roomID
}

func (ge *GameEngine) AllPlayersSubmitted() bool {
	ge.mu.RLock()
	defer ge.mu.RUnlock()

	playerIDs := ge.stateManager.GetPlayerIDs()
	return ge.syncManager.AllPlayersSubmitted(playerIDs)
}

func (ge *GameEngine) CheckAllSubmitted() bool {
	return ge.AllPlayersSubmitted()
}

func (ge *GameEngine) GetCurrentTurn() int {
	ge.mu.RLock()
	defer ge.mu.RUnlock()

	state := ge.stateManager.GetGameState()
	if state == nil {
		return 1
	}
	return state.Turn
}

func (ge *GameEngine) IncrementTurn() {
	ge.mu.Lock()
	defer ge.mu.Unlock()

	ge.syncManager.IncrementTurn()
	ge.processResources()
}

func (ge *GameEngine) GetPhase() protocol.GamePhase {
	ge.mu.RLock()
	defer ge.mu.RUnlock()

	state := ge.stateManager.GetGameState()
	if state == nil {
		return protocol.GamePhaseLobby
	}
	return state.Phase
}

func (ge *GameEngine) processResources() {
	state := ge.stateManager.GetGameState()
	if state == nil {
		return
	}

	for i := range state.Players {
		playerID := state.Players[i].ID
		ge.stateManager.UpdatePlayerResources(playerID, protocol.ResourcePerTurn)

		barracksCount := 0
		for _, building := range state.Buildings {
			if building.PlayerID == playerID && building.Type == protocol.BuildingBarracks {
				barracksCount++
			}
		}
		ge.stateManager.UpdatePlayerResources(playerID, barracksCount*protocol.ResourcePerBarracks)
	}
}

func (ge *GameEngine) getWinnerPlayers(state protocol.GameState) []protocol.Player {
	winners := make([]protocol.Player, 0)
	teamBases := make(map[int]bool)

	for _, building := range state.Buildings {
		if building.Type == protocol.BuildingBase && building.HP > 0 {
			for _, player := range state.Players {
				if player.ID == building.PlayerID {
					teamBases[player.Team] = true
				}
			}
		}
	}

	var winningTeam int
	for team, alive := range teamBases {
		if alive {
			winningTeam = team
			break
		}
	}

	for _, player := range state.Players {
		if player.Team == winningTeam {
			winners = append(winners, player)
		}
	}

	return winners
}
