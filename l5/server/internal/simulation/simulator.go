package simulation

import (
	"fmt"
	"math"
	"sort"

	"github.com/timeline-wars/server/pkg/protocol"
)

const (
	simulationDuration = 5.0
	totalFrames        = 100
	defaultFrameTime   = 0.05
)

type unitState struct {
	protocol.Unit
	AttackCooldown float64
	BuildProgress  float64
	TargetPos      *protocol.Position
	TargetID       string
	PendingDamage  int
}

type buildingState struct {
	protocol.Building
	BuildProgress  float64
	IsComplete     bool
	AttackCooldown float64
	PendingDamage  int
}

type SimulationEngine struct {
	randomSeed    int64
	frameTime     float64
	units         map[string]*unitState
	buildings     map[string]*buildingState
	players       map[string]*protocol.Player
	resources     map[string]map[protocol.Position]int
	actionCounter int64
}

func NewSimulationEngine(randomSeed int64) *SimulationEngine {
	return &SimulationEngine{
		randomSeed:    randomSeed,
		frameTime:     defaultFrameTime,
		units:         make(map[string]*unitState),
		buildings:     make(map[string]*buildingState),
		players:       make(map[string]*protocol.Player),
		resources:     make(map[string]map[protocol.Position]int),
		actionCounter: 0,
	}
}

type FrameResult struct {
	FrameNumber int
	GameState   protocol.GameState
	Actions     []protocol.Action
	Errors      []string
}

func (e *SimulationEngine) Simulate(initialState protocol.GameState, timelines []protocol.Timeline) ([]FrameResult, error) {
	e.reset()
	e.loadInitialState(initialState)

	allActions := e.collectAndSortActions(timelines)

	results := make([]FrameResult, 0, totalFrames)

	for frame := 0; frame < totalFrames; frame++ {
		frameTime := float64(frame) * e.frameTime

		actionsAtTime := e.getActionsAtTime(allActions, frameTime)

		frameActions, frameErrors := e.executeActions(actionsAtTime)

		e.physicsUpdate()

		e.applyPendingDamage()

		e.cleanupDestroyed()

		gameOver, winnerTeam := e.checkGameOver()

		frameResult := FrameResult{
			FrameNumber: frame,
			GameState:   e.snapshotState(frame, gameOver, winnerTeam),
			Actions:     frameActions,
			Errors:      frameErrors,
		}
		results = append(results, frameResult)

		if gameOver {
			break
		}
	}

	return results, nil
}

func (e *SimulationEngine) reset() {
	e.units = make(map[string]*unitState)
	e.buildings = make(map[string]*buildingState)
	e.players = make(map[string]*protocol.Player)
	e.resources = make(map[string]map[protocol.Position]int)
	e.actionCounter = 0
}

func (e *SimulationEngine) loadInitialState(state protocol.GameState) {
	for i := range state.Units {
		unit := state.Units[i]
		e.units[unit.ID] = &unitState{
			Unit: unit,
		}
	}

	for i := range state.Buildings {
		building := state.Buildings[i]
		e.buildings[building.ID] = &buildingState{
			Building:   building,
			IsComplete: true,
		}
	}

	for i := range state.Players {
		player := state.Players[i]
		e.players[player.ID] = &player
	}
}

func (e *SimulationEngine) collectAndSortActions(timelines []protocol.Timeline) []protocol.Action {
	var allActions []protocol.Action

	for _, timeline := range timelines {
		for i := range timeline.Actions {
			action := timeline.Actions[i]
			if action.ID == "" {
				e.actionCounter++
				action.ID = fmt.Sprintf("action_%s_%d", timeline.PlayerID, e.actionCounter)
			}
			if action.PlayerID == "" {
				action.PlayerID = timeline.PlayerID
			}
			allActions = append(allActions, action)
		}
	}

	sort.Slice(allActions, func(i, j int) bool {
		if allActions[i].ExecuteTime != allActions[j].ExecuteTime {
			return allActions[i].ExecuteTime < allActions[j].ExecuteTime
		}
		if allActions[i].PlayerID != allActions[j].PlayerID {
			return allActions[i].PlayerID < allActions[j].PlayerID
		}
		return allActions[i].ID < allActions[j].ID
	})

	return allActions
}

func (e *SimulationEngine) getActionsAtTime(allActions []protocol.Action, frameTime float64) []protocol.Action {
	var actions []protocol.Action

	for _, action := range allActions {
		actionTime := float64(action.ExecuteTime) / 1000.0
		if actionTime >= frameTime && actionTime < frameTime+e.frameTime {
			actions = append(actions, action)
		}
	}

	return actions
}

func (e *SimulationEngine) executeActions(actions []protocol.Action) ([]protocol.Action, []string) {
	var executed []protocol.Action
	var errors []string

	for _, action := range actions {
		if err := e.validateAction(action); err != nil {
			errors = append(errors, fmt.Sprintf("action %s: %v", action.ID, err))
			continue
		}

		if err := e.executeSingleAction(action); err != nil {
			errors = append(errors, fmt.Sprintf("action %s failed: %v", action.ID, err))
			continue
		}

		executed = append(executed, action)
	}

	return executed, errors
}

func (e *SimulationEngine) validateAction(action protocol.Action) error {
	if _, exists := e.players[action.PlayerID]; !exists {
		return fmt.Errorf("player %s not found", action.PlayerID)
	}

	switch action.Type {
	case protocol.ActionMove, protocol.ActionAttack:
		unit, exists := e.units[action.UnitID]
		if !exists {
			return fmt.Errorf("unit %s not found", action.UnitID)
		}
		if unit.PlayerID != action.PlayerID {
			return fmt.Errorf("unit %s does not belong to player %s", action.UnitID, action.PlayerID)
		}
		if unit.HP <= 0 {
			return fmt.Errorf("unit %s is destroyed", action.UnitID)
		}
	case protocol.ActionBuild:
		player := e.players[action.PlayerID]
		cost := e.getBuildingCost(action.BuildingType)
		if player.Resources < cost {
			return fmt.Errorf("insufficient resources: need %d, have %d", cost, player.Resources)
		}
		if action.TargetPos == nil {
			return fmt.Errorf("target position is required for build action")
		}
		if !e.isValidPosition(*action.TargetPos) {
			return fmt.Errorf("invalid build position: (%d, %d)", action.TargetPos.X, action.TargetPos.Y)
		}
		if e.isPositionOccupied(*action.TargetPos) {
			return fmt.Errorf("position (%d, %d) is already occupied", action.TargetPos.X, action.TargetPos.Y)
		}
	}

	return nil
}

func (e *SimulationEngine) executeSingleAction(action protocol.Action) error {
	switch action.Type {
	case protocol.ActionMove:
		return e.executeMoveAction(action)
	case protocol.ActionAttack:
		return e.executeAttackAction(action)
	case protocol.ActionBuild:
		return e.executeBuildAction(action)
	default:
		return fmt.Errorf("unknown action type: %d", action.Type)
	}
}

func (e *SimulationEngine) executeMoveAction(action protocol.Action) error {
	unit := e.units[action.UnitID]
	if action.TargetPos == nil {
		return fmt.Errorf("target position required for move")
	}
	unit.TargetPos = action.TargetPos
	unit.TargetID = ""
	return nil
}

func (e *SimulationEngine) executeAttackAction(action protocol.Action) error {
	unit := e.units[action.UnitID]
	unit.TargetID = action.TargetID
	unit.TargetPos = action.TargetPos
	return nil
}

func (e *SimulationEngine) executeBuildAction(action protocol.Action) error {
	player := e.players[action.PlayerID]
	cost := e.getBuildingCost(action.BuildingType)
	player.Resources -= cost

	e.actionCounter++
	buildingID := fmt.Sprintf("bld_%s_%d_%d", action.PlayerID, action.ExecuteTime, e.actionCounter)

	building := &buildingState{
		Building: protocol.Building{
			ID:       buildingID,
			Type:     action.BuildingType,
			PlayerID: action.PlayerID,
			HP:       1,
			MaxHP:    e.getBuildingMaxHP(action.BuildingType),
			Position: *action.TargetPos,
		},
		BuildProgress: 0,
		IsComplete:    false,
	}

	e.buildings[building.ID] = building
	return nil
}

func (e *SimulationEngine) physicsUpdate() {
	e.updateMovement()
	e.updateAttacks()
	e.updateBuildings()
	e.updateTurrets()
}

func (e *SimulationEngine) updateMovement() {
	sortedUnits := e.getSortedUnits()

	for _, unit := range sortedUnits {
		if unit.HP <= 0 || unit.TargetPos == nil {
			continue
		}

		dx := unit.TargetPos.X - unit.Position.X
		dy := unit.TargetPos.Y - unit.Position.Y
		distance := math.Sqrt(float64(dx*dx + dy*dy))

		if distance < 0.1 {
			unit.TargetPos = nil
			continue
		}

		speed := float64(unit.Speed) * e.frameTime
		if distance <= speed {
			unit.Position = *unit.TargetPos
			unit.TargetPos = nil
		} else {
			ratio := speed / distance
			unit.Position.X += int(float64(dx) * ratio)
			unit.Position.Y += int(float64(dy) * ratio)
		}
	}
}

func (e *SimulationEngine) updateAttacks() {
	sortedUnits := e.getSortedUnits()

	for _, unit := range sortedUnits {
		if unit.HP <= 0 {
			continue
		}

		if unit.AttackCooldown > 0 {
			unit.AttackCooldown -= e.frameTime
			continue
		}

		target := e.findAttackTarget(unit)
		if target == nil {
			continue
		}

		if e.checkAABBCollision(unit.Position, unit.Range, target.GetPosition()) {
			damage := unit.Attack
			target.AddPendingDamage(damage)
			unit.AttackCooldown = 1.0
		}
	}
}

func (e *SimulationEngine) applyPendingDamage() {
	sortedUnits := e.getSortedUnits()
	for _, unit := range sortedUnits {
		if unit.PendingDamage > 0 {
			unit.HP -= unit.PendingDamage
			unit.PendingDamage = 0
		}
	}

	sortedBuildings := e.getSortedBuildings()
	for _, building := range sortedBuildings {
		if building.PendingDamage > 0 {
			building.HP -= building.PendingDamage
			building.PendingDamage = 0
		}
	}
}

func (e *SimulationEngine) updateBuildings() {
	sortedBuildings := e.getSortedBuildings()

	for _, building := range sortedBuildings {
		if building.IsComplete {
			continue
		}

		building.BuildProgress += e.frameTime * 10

		requiredProgress := 100.0
		if building.BuildProgress >= requiredProgress {
			building.IsComplete = true
			building.HP = building.MaxHP
		} else {
			building.HP = int(float64(building.MaxHP) * (building.BuildProgress / requiredProgress))
			if building.HP < 1 {
				building.HP = 1
			}
		}
	}
}

func (e *SimulationEngine) updateTurrets() {
	sortedBuildings := e.getSortedBuildings()

	for _, building := range sortedBuildings {
		if !building.IsComplete || building.Type != protocol.BuildingTurret {
			continue
		}

		if building.AttackCooldown > 0 {
			building.AttackCooldown -= e.frameTime
			continue
		}

		target := e.findTurretTarget(building)
		if target == nil {
			continue
		}

		if e.checkAABBCollision(building.Position, protocol.TurretRange, target.GetPosition()) {
			target.AddPendingDamage(protocol.TurretAttack)
			building.AttackCooldown = float64(protocol.TurretFireRate) / 1000.0
		}
	}
}

func (e *SimulationEngine) cleanupDestroyed() {
	for id, unit := range e.units {
		if unit.HP <= 0 {
			delete(e.units, id)
		}
	}

	for id, building := range e.buildings {
		if building.HP <= 0 {
			delete(e.buildings, id)
		}
	}
}

type target interface {
	GetPosition() protocol.Position
	AddPendingDamage(damage int)
	GetPlayerID() string
	GetID() string
}

func (u *unitState) GetPosition() protocol.Position {
	return u.Position
}

func (u *unitState) AddPendingDamage(damage int) {
	u.PendingDamage += damage
}

func (u *unitState) GetPlayerID() string {
	return u.PlayerID
}

func (u *unitState) GetID() string {
	return u.ID
}

func (b *buildingState) GetPosition() protocol.Position {
	return b.Position
}

func (b *buildingState) AddPendingDamage(damage int) {
	b.PendingDamage += damage
}

func (b *buildingState) GetPlayerID() string {
	return b.PlayerID
}

func (b *buildingState) GetID() string {
	return b.ID
}

func (e *SimulationEngine) findAttackTarget(unit *unitState) target {
	if unit.TargetID != "" {
		if u, exists := e.units[unit.TargetID]; exists && u.HP > 0 && u.PlayerID != unit.PlayerID {
			return u
		}
		if b, exists := e.buildings[unit.TargetID]; exists && b.HP > 0 && b.PlayerID != unit.PlayerID {
			return b
		}
	}

	sortedUnits := e.getSortedUnits()
	sortedBuildings := e.getSortedBuildings()

	var closest target
	closestDist := float64(unit.Range + 1)
	closestID := ""

	for _, u := range sortedUnits {
		if u.HP <= 0 || u.PlayerID == unit.PlayerID {
			continue
		}
		dist := e.distance(unit.Position, u.Position)
		if dist < closestDist || (dist == closestDist && u.ID < closestID) {
			closestDist = dist
			closest = u
			closestID = u.ID
		}
	}

	for _, b := range sortedBuildings {
		if b.HP <= 0 || !b.IsComplete || b.PlayerID == unit.PlayerID {
			continue
		}
		dist := e.distance(unit.Position, b.Position)
		if dist < closestDist || (dist == closestDist && b.ID < closestID) {
			closestDist = dist
			closest = b
			closestID = b.ID
		}
	}

	return closest
}

func (e *SimulationEngine) findTurretTarget(building *buildingState) target {
	sortedUnits := e.getSortedUnits()

	var closest target
	closestDist := float64(protocol.TurretRange + 1)
	closestID := ""

	for _, u := range sortedUnits {
		if u.HP <= 0 || u.PlayerID == building.PlayerID {
			continue
		}
		dist := e.distance(building.Position, u.Position)
		if dist < closestDist || (dist == closestDist && u.ID < closestID) {
			closestDist = dist
			closest = u
			closestID = u.ID
		}
	}

	return closest
}

func (e *SimulationEngine) getSortedUnits() []*unitState {
	units := make([]*unitState, 0, len(e.units))
	for _, u := range e.units {
		units = append(units, u)
	}
	sort.Slice(units, func(i, j int) bool {
		return units[i].ID < units[j].ID
	})
	return units
}

func (e *SimulationEngine) getSortedBuildings() []*buildingState {
	buildings := make([]*buildingState, 0, len(e.buildings))
	for _, b := range e.buildings {
		buildings = append(buildings, b)
	}
	sort.Slice(buildings, func(i, j int) bool {
		return buildings[i].ID < buildings[j].ID
	})
	return buildings
}

func (e *SimulationEngine) checkAABBCollision(pos1 protocol.Position, range1 int, pos2 protocol.Position) bool {
	return math.Abs(float64(pos1.X-pos2.X)) <= float64(range1) &&
		math.Abs(float64(pos1.Y-pos2.Y)) <= float64(range1)
}

func (e *SimulationEngine) distance(pos1, pos2 protocol.Position) float64 {
	dx := pos1.X - pos2.X
	dy := pos1.Y - pos2.Y
	return math.Sqrt(float64(dx*dx + dy*dy))
}

func (e *SimulationEngine) checkGameOver() (bool, int) {
	teamBases := make(map[int]bool)

	sortedBuildings := e.getSortedBuildings()
	for _, building := range sortedBuildings {
		if building.Type == protocol.BuildingBase && building.HP > 0 {
			player := e.players[building.PlayerID]
			if player != nil {
				teamBases[player.Team] = true
			}
		}
	}

	aliveTeams := make([]int, 0)
	for team, alive := range teamBases {
		if alive {
			aliveTeams = append(aliveTeams, team)
		}
	}
	sort.Ints(aliveTeams)

	if len(aliveTeams) <= 1 {
		if len(aliveTeams) == 1 {
			return true, aliveTeams[0]
		}
		return true, 0
	}

	return false, 0
}

func (e *SimulationEngine) snapshotState(frame int, gameOver bool, winnerTeam int) protocol.GameState {
	phase := protocol.GamePhaseSimulating
	if gameOver {
		phase = protocol.GamePhaseGameOver
	}

	sortedUnits := e.getSortedUnits()
	units := make([]protocol.Unit, 0, len(sortedUnits))
	for _, u := range sortedUnits {
		units = append(units, u.Unit)
	}

	sortedBuildings := e.getSortedBuildings()
	buildings := make([]protocol.Building, 0, len(sortedBuildings))
	for _, b := range sortedBuildings {
		buildings = append(buildings, b.Building)
	}

	sortedPlayerIDs := make([]string, 0, len(e.players))
	for id := range e.players {
		sortedPlayerIDs = append(sortedPlayerIDs, id)
	}
	sort.Strings(sortedPlayerIDs)

	players := make([]protocol.Player, 0, len(e.players))
	for _, id := range sortedPlayerIDs {
		players = append(players, *e.players[id])
	}

	return protocol.GameState{
		Phase:     phase,
		Turn:      frame,
		Units:     units,
		Buildings: buildings,
		Players:   players,
		Timestamp: int64(float64(frame) * e.frameTime * 1000),
	}
}

func (e *SimulationEngine) getBuildingCost(buildingType protocol.BuildingType) int {
	switch buildingType {
	case protocol.BuildingTurret:
		return protocol.TurretCost
	case protocol.BuildingBarracks:
		return protocol.BarracksCost
	default:
		return 0
	}
}

func (e *SimulationEngine) GetRandomSeed() int64 {
	return e.randomSeed
}

func (e *SimulationEngine) getBuildingMaxHP(buildingType protocol.BuildingType) int {
	switch buildingType {
	case protocol.BuildingBase:
		return protocol.BaseHP
	case protocol.BuildingTurret:
		return protocol.TurretHP
	case protocol.BuildingBarracks:
		return protocol.BarracksHP
	default:
		return 100
	}
}

func (e *SimulationEngine) isValidPosition(pos protocol.Position) bool {
	return pos.X >= 0 && pos.X < protocol.MapWidth &&
		pos.Y >= 0 && pos.Y < protocol.MapHeight
}

func (e *SimulationEngine) isPositionOccupied(pos protocol.Position) bool {
	for _, u := range e.units {
		if u.HP > 0 && u.Position.X == pos.X && u.Position.Y == pos.Y {
			return true
		}
	}
	for _, b := range e.buildings {
		if b.HP > 0 && b.Position.X == pos.X && b.Position.Y == pos.Y {
			return true
		}
	}
	return false
}
