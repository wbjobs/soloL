package game

import (
	"errors"
	"sync"
	"time"

	"github.com/timeline-wars/server/internal/conflict"
	"github.com/timeline-wars/server/pkg/protocol"
)

type UnitManager struct {
	mu            sync.RWMutex
	gameState     *protocol.GameState
	conflict      *conflict.Detector
	unitCooldowns map[string]int64
}

func NewUnitManager() *UnitManager {
	return &UnitManager{
		conflict:      conflict.NewDetector(),
		unitCooldowns: make(map[string]int64),
	}
}

func (um *UnitManager) SetGameState(state *protocol.GameState) {
	um.mu.Lock()
	defer um.mu.Unlock()
	um.gameState = state
	um.conflict.SetGameState(state)
}

func (um *UnitManager) CreateUnit(unitType protocol.UnitType, playerID string, pos protocol.Position) (*protocol.Unit, error) {
	um.mu.Lock()
	defer um.mu.Unlock()

	if um.gameState == nil {
		return nil, errors.New("game state not initialized")
	}

	collision := um.conflict.CheckPositionCollision(pos, "")
	if collision.HasCollision {
		return nil, errors.New("position occupied")
	}

	var unit protocol.Unit

	switch unitType {
	case protocol.UnitWarrior:
		unit = protocol.Unit{
			ID:       generateUnitID(playerID),
			Type:     protocol.UnitWarrior,
			PlayerID: playerID,
			HP:       protocol.WarriorHP,
			MaxHP:    protocol.WarriorHP,
			Position: pos,
			Attack:   protocol.WarriorAttack,
			Range:    protocol.WarriorRange,
			Speed:    protocol.WarriorSpeed,
		}
	case protocol.UnitArcher:
		unit = protocol.Unit{
			ID:       generateUnitID(playerID),
			Type:     protocol.UnitArcher,
			PlayerID: playerID,
			HP:       protocol.ArcherHP,
			MaxHP:    protocol.ArcherHP,
			Position: pos,
			Attack:   protocol.ArcherAttack,
			Range:    protocol.ArcherRange,
			Speed:    protocol.ArcherSpeed,
		}
	case protocol.UnitMage:
		unit = protocol.Unit{
			ID:       generateUnitID(playerID),
			Type:     protocol.UnitMage,
			PlayerID: playerID,
			HP:       protocol.MageHP,
			MaxHP:    protocol.MageHP,
			Position: pos,
			Attack:   protocol.MageAttack,
			Range:    protocol.MageRange,
			Speed:    protocol.MageSpeed,
		}
	default:
		return nil, errors.New("invalid unit type")
	}

	um.gameState.Units = append(um.gameState.Units, unit)
	return &unit, nil
}

func (um *UnitManager) MoveUnit(unitID string, playerID string, targetPos protocol.Position) (bool, string, error) {
	um.mu.Lock()
	defer um.mu.Unlock()

	if um.gameState == nil {
		return false, "", errors.New("game state not initialized")
	}

	unitIdx := um.findUnitIndex(unitID)
	if unitIdx == -1 {
		return false, "", errors.New("unit not found")
	}

	unit := &um.gameState.Units[unitIdx]
	if unit.PlayerID != playerID {
		return false, "", errors.New("not your unit")
	}

	if targetPos.X < 0 || targetPos.X >= protocol.MapWidth || targetPos.Y < 0 || targetPos.Y >= protocol.MapHeight {
		return false, "", errors.New("invalid position")
	}

	collision := um.conflict.CheckPositionCollision(targetPos, unitID)
	if collision.HasCollision {
		return false, "position occupied", nil
	}

	distance := manhattanDistance(unit.Position, targetPos)
	maxMove := unit.Speed * int(protocol.PlanningPhaseDuration)

	if distance > maxMove {
		return false, "move distance too far", nil
	}

	unit.Position = targetPos
	return true, "move completed", nil
}

func (um *UnitManager) AttackUnit(attackerID string, playerID string, targetID string) (bool, string, error) {
	um.mu.Lock()
	defer um.mu.Unlock()

	if um.gameState == nil {
		return false, "", errors.New("game state not initialized")
	}

	attackerIdx := um.findUnitIndex(attackerID)
	if attackerIdx == -1 {
		return false, "", errors.New("attacker unit not found")
	}

	attacker := &um.gameState.Units[attackerIdx]
	if attacker.PlayerID != playerID {
		return false, "", errors.New("not your unit")
	}

	now := time.Now().UnixMilli()
	if cooldown, exists := um.unitCooldowns[attacker.ID]; exists && now < cooldown {
		return false, "unit on cooldown", nil
	}

	targetIdx := um.findUnitIndex(targetID)
	if targetIdx == -1 {
		return false, "", errors.New("target unit not found")
	}

	target := &um.gameState.Units[targetIdx]

	distance := manhattanDistance(attacker.Position, target.Position)
	if distance > attacker.Range {
		return false, "target out of range", nil
	}

	target.HP -= attacker.Attack
	um.unitCooldowns[attacker.ID] = now + 1000

	if target.HP <= 0 {
		um.removeUnit(targetIdx)
		return true, "target destroyed", nil
	}

	return true, "attack successful", nil
}

func (um *UnitManager) HealUnit(healerID string, playerID string, targetID string, healAmount int) (bool, string, error) {
	um.mu.Lock()
	defer um.mu.Unlock()

	if um.gameState == nil {
		return false, "", errors.New("game state not initialized")
	}

	healerIdx := um.findUnitIndex(healerID)
	if healerIdx == -1 {
		return false, "", errors.New("healer unit not found")
	}

	healer := &um.gameState.Units[healerIdx]
	if healer.PlayerID != playerID {
		return false, "", errors.New("not your unit")
	}

	targetIdx := um.findUnitIndex(targetID)
	if targetIdx == -1 {
		return false, "", errors.New("target unit not found")
	}

	target := &um.gameState.Units[targetIdx]

	if target.PlayerID != playerID {
		return false, "can only heal own units", nil
	}

	distance := manhattanDistance(healer.Position, target.Position)
	if distance > healer.Range {
		return false, "target out of range", nil
	}

	target.HP += healAmount
	if target.HP > target.MaxHP {
		target.HP = target.MaxHP
	}

	return true, "heal successful", nil
}

func (um *UnitManager) DestroyUnit(unitID string, playerID string) (bool, string, error) {
	um.mu.Lock()
	defer um.mu.Unlock()

	if um.gameState == nil {
		return false, "", errors.New("game state not initialized")
	}

	unitIdx := um.findUnitIndex(unitID)
	if unitIdx == -1 {
		return false, "", errors.New("unit not found")
	}

	unit := &um.gameState.Units[unitIdx]
	if unit.PlayerID != playerID {
		return false, "", errors.New("not your unit")
	}

	um.removeUnit(unitIdx)
	delete(um.unitCooldowns, unitID)
	return true, "unit destroyed", nil
}

func (um *UnitManager) GetUnitsInRange(center protocol.Position, radius int) []protocol.Unit {
	um.mu.RLock()
	defer um.mu.RUnlock()

	return um.conflict.FindUnitsInRange(center, radius)
}

func (um *UnitManager) GetEnemyUnitsInRange(center protocol.Position, radius int, playerID string) []protocol.Unit {
	um.mu.RLock()
	defer um.mu.RUnlock()

	return um.conflict.FindEnemyUnitsInRange(center, radius, playerID)
}

func (um *UnitManager) GetUnit(unitID string) (*protocol.Unit, bool) {
	um.mu.RLock()
	defer um.mu.RUnlock()

	if um.gameState == nil {
		return nil, false
	}

	for i := range um.gameState.Units {
		if um.gameState.Units[i].ID == unitID {
			unit := um.gameState.Units[i]
			return &unit, true
		}
	}
	return nil, false
}

func (um *UnitManager) GetUnitsForPlayer(playerID string) []protocol.Unit {
	um.mu.RLock()
	defer um.mu.RUnlock()

	var units []protocol.Unit

	if um.gameState == nil {
		return units
	}

	for _, unit := range um.gameState.Units {
		if unit.PlayerID == playerID {
			units = append(units, unit)
		}
	}
	return units
}

func (um *UnitManager) UpdateUnit(unit protocol.Unit) bool {
	um.mu.Lock()
	defer um.mu.Unlock()

	if um.gameState == nil {
		return false
	}

	for i := range um.gameState.Units {
		if um.gameState.Units[i].ID == unit.ID {
			um.gameState.Units[i] = unit
			return true
		}
	}
	return false
}

func (um *UnitManager) findUnitIndex(unitID string) int {
	if um.gameState == nil {
		return -1
	}
	for i, unit := range um.gameState.Units {
		if unit.ID == unitID {
			return i
		}
	}
	return -1
}

func (um *UnitManager) removeUnit(index int) {
	if um.gameState == nil || index < 0 || index >= len(um.gameState.Units) {
		return
	}
	um.gameState.Units = append(um.gameState.Units[:index], um.gameState.Units[index+1:]...)
}

func manhattanDistance(a, b protocol.Position) int {
	return abs(a.X-b.X) + abs(a.Y-b.Y)
}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}
