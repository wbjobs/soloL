package game

import (
	"errors"
	"sync"
	"time"

	"github.com/timeline-wars/server/internal/conflict"
	"github.com/timeline-wars/server/pkg/protocol"
)

type BuildingManager struct {
	mu               sync.RWMutex
	gameState        *protocol.GameState
	conflict         *conflict.Detector
	buildingProgress map[string]*BuildingBuildProgress
}

type BuildingBuildProgress struct {
	BuildingID   string
	BuildingType protocol.BuildingType
	PlayerID     string
	Position     protocol.Position
	StartTime    int64
	Duration     int64
}

func NewBuildingManager() *BuildingManager {
	return &BuildingManager{
		conflict:         conflict.NewDetector(),
		buildingProgress: make(map[string]*BuildingBuildProgress),
	}
}

func (bm *BuildingManager) SetGameState(state *protocol.GameState) {
	bm.mu.Lock()
	defer bm.mu.Unlock()
	bm.gameState = state
	bm.conflict.SetGameState(state)
}

func (bm *BuildingManager) StartBuilding(buildingType protocol.BuildingType, playerID string, pos protocol.Position) (string, error) {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	if bm.gameState == nil {
		return "", errors.New("game state not initialized")
	}

	if buildingType == protocol.BuildingBase {
		return "", errors.New("cannot build base")
	}

	if pos.X < 0 || pos.X >= protocol.MapWidth || pos.Y < 0 || pos.Y >= protocol.MapHeight {
		return "", errors.New("invalid position")
	}

	collision := bm.conflict.CheckPositionCollision(pos, "")
	if collision.HasCollision {
		return "", errors.New("position occupied")
	}

	playerIdx := bm.findPlayerIndex(playerID)
	if playerIdx == -1 {
		return "", errors.New("player not found")
	}

	player := &bm.gameState.Players[playerIdx]

	var cost int
	var duration int64

	switch buildingType {
	case protocol.BuildingTurret:
		cost = protocol.TurretCost
		duration = 5000
	case protocol.BuildingBarracks:
		cost = protocol.BarracksCost
		duration = 8000
	default:
		return "", errors.New("invalid building type")
	}

	if player.Resources < cost {
		return "", errors.New("insufficient resources")
	}

	player.Resources -= cost

	buildingID := generateBuildingID(playerID)
	bm.buildingProgress[buildingID] = &BuildingBuildProgress{
		BuildingID:   buildingID,
		BuildingType: buildingType,
		PlayerID:     playerID,
		Position:     pos,
		StartTime:    time.Now().UnixMilli(),
		Duration:     duration,
	}

	return buildingID, nil
}

func (bm *BuildingManager) UpdateBuildingProgress(now int64) []protocol.Building {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	var completed []protocol.Building

	for id, progress := range bm.buildingProgress {
		if now >= progress.StartTime+progress.Duration {
			building := bm.CompleteBuilding(id)
			if building != nil {
				completed = append(completed, *building)
			}
		}
	}

	return completed
}

func (bm *BuildingManager) CompleteBuilding(buildingID string) *protocol.Building {
	progress, exists := bm.buildingProgress[buildingID]
	if !exists {
		return nil
	}

	var building protocol.Building

	switch progress.BuildingType {
	case protocol.BuildingTurret:
		building = protocol.Building{
			ID:       buildingID,
			Type:     protocol.BuildingTurret,
			PlayerID: progress.PlayerID,
			HP:       protocol.TurretHP,
			MaxHP:    protocol.TurretHP,
			Position: progress.Position,
		}
	case protocol.BuildingBarracks:
		building = protocol.Building{
			ID:       buildingID,
			Type:     protocol.BuildingBarracks,
			PlayerID: progress.PlayerID,
			HP:       protocol.BarracksHP,
			MaxHP:    protocol.BarracksHP,
			Position: progress.Position,
		}
	default:
		delete(bm.buildingProgress, buildingID)
		return nil
	}

	if bm.gameState != nil {
		bm.gameState.Buildings = append(bm.gameState.Buildings, building)
	}

	delete(bm.buildingProgress, buildingID)
	return &building
}

func (bm *BuildingManager) DestroyBuilding(buildingID string, playerID string) (bool, string, error) {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	if bm.gameState == nil {
		return false, "", errors.New("game state not initialized")
	}

	buildingIdx := bm.findBuildingIndex(buildingID)
	if buildingIdx == -1 {
		if _, exists := bm.buildingProgress[buildingID]; exists {
			delete(bm.buildingProgress, buildingID)
			return true, "building in progress destroyed", nil
		}
		return false, "", errors.New("building not found")
	}

	building := &bm.gameState.Buildings[buildingIdx]
	if building.PlayerID != playerID {
		return false, "", errors.New("not your building")
	}

	if building.Type == protocol.BuildingBase {
		return false, "cannot destroy base", nil
	}

	bm.removeBuilding(buildingIdx)
	return true, "building destroyed", nil
}

func (bm *BuildingManager) GetBuildingAt(pos protocol.Position) (*protocol.Building, bool) {
	bm.mu.RLock()
	defer bm.mu.RUnlock()

	if bm.gameState == nil {
		return nil, false
	}

	for i := range bm.gameState.Buildings {
		if bm.gameState.Buildings[i].Position.X == pos.X &&
			bm.gameState.Buildings[i].Position.Y == pos.Y {
			building := bm.gameState.Buildings[i]
			return &building, true
		}
	}
	return nil, false
}

func (bm *BuildingManager) GetBuilding(buildingID string) (*protocol.Building, bool) {
	bm.mu.RLock()
	defer bm.mu.RUnlock()

	if bm.gameState == nil {
		return nil, false
	}

	for i := range bm.gameState.Buildings {
		if bm.gameState.Buildings[i].ID == buildingID {
			building := bm.gameState.Buildings[i]
			return &building, true
		}
	}
	return nil, false
}

func (bm *BuildingManager) GetBuildingsForPlayer(playerID string) []protocol.Building {
	bm.mu.RLock()
	defer bm.mu.RUnlock()

	var buildings []protocol.Building

	if bm.gameState == nil {
		return buildings
	}

	for _, building := range bm.gameState.Buildings {
		if building.PlayerID == playerID {
			buildings = append(buildings, building)
		}
	}
	return buildings
}

func (bm *BuildingManager) GetBuildingsInRange(center protocol.Position, radius int) []protocol.Building {
	bm.mu.RLock()
	defer bm.mu.RUnlock()

	return bm.conflict.FindBuildingsInRange(center, radius)
}

func (bm *BuildingManager) GetEnemyBuildingsInRange(center protocol.Position, radius int, playerID string) []protocol.Building {
	bm.mu.RLock()
	defer bm.mu.RUnlock()

	return bm.conflict.FindEnemyBuildingsInRange(center, radius, playerID)
}

func (bm *BuildingManager) UpdateBuilding(building protocol.Building) bool {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	if bm.gameState == nil {
		return false
	}

	for i := range bm.gameState.Buildings {
		if bm.gameState.Buildings[i].ID == building.ID {
			bm.gameState.Buildings[i] = building
			return true
		}
	}
	return false
}

func (bm *BuildingManager) DamageBuilding(buildingID string, damage int) (bool, string) {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	if bm.gameState == nil {
		return false, "game state not initialized"
	}

	buildingIdx := bm.findBuildingIndex(buildingID)
	if buildingIdx == -1 {
		return false, "building not found"
	}

	building := &bm.gameState.Buildings[buildingIdx]
	building.HP -= damage

	if building.HP <= 0 {
		bm.removeBuilding(buildingIdx)
		return true, "building destroyed"
	}

	return true, "building damaged"
}

func (bm *BuildingManager) GetBuildingProgress(buildingID string) (*BuildingBuildProgress, bool) {
	bm.mu.RLock()
	defer bm.mu.RUnlock()

	progress, exists := bm.buildingProgress[buildingID]
	if !exists {
		return nil, false
	}

	progressCopy := *progress
	return &progressCopy, true
}

func (bm *BuildingManager) GetAllBuildingProgress() []BuildingBuildProgress {
	bm.mu.RLock()
	defer bm.mu.RUnlock()

	progressList := make([]BuildingBuildProgress, 0, len(bm.buildingProgress))
	for _, progress := range bm.buildingProgress {
		progressList = append(progressList, *progress)
	}
	return progressList
}

func (bm *BuildingManager) findPlayerIndex(playerID string) int {
	if bm.gameState == nil {
		return -1
	}
	for i, player := range bm.gameState.Players {
		if player.ID == playerID {
			return i
		}
	}
	return -1
}

func (bm *BuildingManager) findBuildingIndex(buildingID string) int {
	if bm.gameState == nil {
		return -1
	}
	for i, building := range bm.gameState.Buildings {
		if building.ID == buildingID {
			return i
		}
	}
	return -1
}

func (bm *BuildingManager) removeBuilding(index int) {
	if bm.gameState == nil || index < 0 || index >= len(bm.gameState.Buildings) {
		return
	}
	bm.gameState.Buildings = append(bm.gameState.Buildings[:index], bm.gameState.Buildings[index+1:]...)
}

func generateBuildingID(playerID string) string {
	return "building_" + playerID + "_" + time.Now().Format("20060102150405") + "_" + randomString(4)
}
