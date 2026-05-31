package conflict

import (
	"sync"

	"github.com/timeline-wars/server/pkg/protocol"
)

type Detector struct {
	mu        sync.Mutex
	gameState *protocol.GameState
}

type CollisionResult struct {
	HasCollision bool
	UnitID       string
	BuildingID   string
	Position     protocol.Position
}

func NewDetector() *Detector {
	return &Detector{}
}

func (d *Detector) SetGameState(state *protocol.GameState) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.gameState = state
}

func (d *Detector) CheckPositionCollision(pos protocol.Position, excludeUnitID string) CollisionResult {
	d.mu.Lock()
	defer d.mu.Unlock()

	result := CollisionResult{
		Position: pos,
	}

	if d.gameState == nil {
		return result
	}

	if !d.isValidPosition(pos) {
		result.HasCollision = true
		return result
	}

	for _, unit := range d.gameState.Units {
		if unit.ID == excludeUnitID {
			continue
		}
		if unit.Position.X == pos.X && unit.Position.Y == pos.Y {
			result.HasCollision = true
			result.UnitID = unit.ID
			return result
		}
	}

	for _, building := range d.gameState.Buildings {
		if building.Position.X == pos.X && building.Position.Y == pos.Y {
			result.HasCollision = true
			result.BuildingID = building.ID
			return result
		}
	}

	return result
}

func (d *Detector) CheckMovePath(unitID string, targetPos protocol.Position) []CollisionResult {
	d.mu.Lock()
	defer d.mu.Unlock()

	var results []CollisionResult

	if d.gameState == nil {
		return results
	}

	unitIdx := d.findUnitIndex(unitID)
	if unitIdx == -1 {
		return results
	}

	unit := d.gameState.Units[unitIdx]

	path := d.generatePath(unit.Position, targetPos)

	for _, pos := range path {
		collision := d.CheckPositionCollision(pos, unitID)
		if collision.HasCollision {
			results = append(results, collision)
		}
	}

	return results
}

func (d *Detector) CheckAttackRange(attackerPos protocol.Position, targetPos protocol.Position, attackRange int) bool {
	distance := d.manhattanDistance(attackerPos, targetPos)
	return distance <= attackRange
}

func (d *Detector) FindUnitsInRange(center protocol.Position, radius int) []protocol.Unit {
	d.mu.Lock()
	defer d.mu.Unlock()

	var units []protocol.Unit

	if d.gameState == nil {
		return units
	}

	for _, unit := range d.gameState.Units {
		if d.manhattanDistance(center, unit.Position) <= radius {
			units = append(units, unit)
		}
	}

	return units
}

func (d *Detector) FindEnemyUnitsInRange(center protocol.Position, radius int, playerID string) []protocol.Unit {
	d.mu.Lock()
	defer d.mu.Unlock()

	var units []protocol.Unit

	if d.gameState == nil {
		return units
	}

	for _, unit := range d.gameState.Units {
		if unit.PlayerID != playerID && d.manhattanDistance(center, unit.Position) <= radius {
			units = append(units, unit)
		}
	}

	return units
}

func (d *Detector) FindBuildingsInRange(center protocol.Position, radius int) []protocol.Building {
	d.mu.Lock()
	defer d.mu.Unlock()

	var buildings []protocol.Building

	if d.gameState == nil {
		return buildings
	}

	for _, building := range d.gameState.Buildings {
		if d.manhattanDistance(center, building.Position) <= radius {
			buildings = append(buildings, building)
		}
	}

	return buildings
}

func (d *Detector) FindEnemyBuildingsInRange(center protocol.Position, radius int, playerID string) []protocol.Building {
	d.mu.Lock()
	defer d.mu.Unlock()

	var buildings []protocol.Building

	if d.gameState == nil {
		return buildings
	}

	for _, building := range d.gameState.Buildings {
		if building.PlayerID != playerID && d.manhattanDistance(center, building.Position) <= radius {
			buildings = append(buildings, building)
		}
	}

	return buildings
}

func (d *Detector) CheckBaseDestroyed(playerID string) bool {
	d.mu.Lock()
	defer d.mu.Unlock()

	if d.gameState == nil {
		return false
	}

	for _, building := range d.gameState.Buildings {
		if building.PlayerID == playerID && building.Type == protocol.BuildingBase {
			return building.HP <= 0
		}
	}

	return true
}

func (d *Detector) GetAlivePlayers() []string {
	d.mu.Lock()
	defer d.mu.Unlock()

	var alivePlayers []string

	if d.gameState == nil {
		return alivePlayers
	}

	playerBaseMap := make(map[string]bool)
	for _, building := range d.gameState.Buildings {
		if building.Type == protocol.BuildingBase && building.HP > 0 {
			playerBaseMap[building.PlayerID] = true
		}
	}

	for _, player := range d.gameState.Players {
		if playerBaseMap[player.ID] {
			alivePlayers = append(alivePlayers, player.ID)
		}
	}

	return alivePlayers
}

func (d *Detector) isValidPosition(pos protocol.Position) bool {
	return pos.X >= 0 && pos.X < protocol.MapWidth && pos.Y >= 0 && pos.Y < protocol.MapHeight
}

func (d *Detector) manhattanDistance(a, b protocol.Position) int {
	return abs(a.X-b.X) + abs(a.Y-b.Y)
}

func (d *Detector) findUnitIndex(unitID string) int {
	if d.gameState == nil {
		return -1
	}
	for i, unit := range d.gameState.Units {
		if unit.ID == unitID {
			return i
		}
	}
	return -1
}

func (d *Detector) generatePath(from, to protocol.Position) []protocol.Position {
	var path []protocol.Position

	x := from.X
	y := from.Y

	for x != to.X || y != to.Y {
		if x < to.X {
			x++
		} else if x > to.X {
			x--
		} else if y < to.Y {
			y++
		} else if y > to.Y {
			y--
		}

		path = append(path, protocol.Position{X: x, Y: y})
	}

	return path
}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}
