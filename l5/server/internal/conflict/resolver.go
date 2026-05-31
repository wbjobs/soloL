package conflict

import (
	"fmt"
	"math"
	"sort"

	"github.com/timeline-wars/server/pkg/protocol"
)

type ConflictType int

const (
	ConflictTypeAttack ConflictType = iota + 1
	ConflictTypeResource
	ConflictTypeBuild
	ConflictTypeMovement
)

type Conflict struct {
	Type         ConflictType
	TargetID     string
	TargetPos    *protocol.Position
	Participants []ConflictParticipant
	Resolved     bool
	Winner       string
	Result       string
}

type ConflictParticipant struct {
	PlayerID    string
	UnitID      string
	ActionID    string
	Position    protocol.Position
	UnitCount   int
	AttackPower int
	Priority    int
	SubmitTime  int64
	Distance    float64
	OriginalAction protocol.Action
}

type ResolvedAction struct {
	Action  protocol.Action
	Success bool
	Result  string
}

type ConflictResolver struct {
	units      map[string]*protocol.Unit
	buildings  map[string]*protocol.Building
	players    map[string]*protocol.Player
	positions  map[string]protocol.Position
}

func NewConflictResolver() *ConflictResolver {
	return &ConflictResolver{
		units:     make(map[string]*protocol.Unit),
		buildings: make(map[string]*protocol.Building),
		players:   make(map[string]*protocol.Player),
		positions: make(map[string]protocol.Position),
	}
}

func (r *ConflictResolver) Resolve(state protocol.GameState, actions []protocol.Action, timelines []protocol.Timeline) ([]ResolvedAction, []Conflict, error) {
	r.loadState(state)

	attackConflicts := r.findAttackConflicts(actions)
	resourceConflicts := r.findResourceConflicts(actions)
	buildConflicts := r.findBuildConflicts(actions)
	movementConflicts := r.findMovementConflicts(actions)

	allConflicts := append(attackConflicts, resourceConflicts...)
	allConflicts = append(allConflicts, buildConflicts...)
	allConflicts = append(allConflicts, movementConflicts...)

	resolvedActions := make([]ResolvedAction, 0)
	actionResolved := make(map[string]bool)

	for i := range allConflicts {
		conflict := &allConflicts[i]
		switch conflict.Type {
		case ConflictTypeAttack:
			r.resolveAttackConflict(conflict)
		case ConflictTypeResource:
			r.resolveResourceConflict(conflict)
		case ConflictTypeBuild:
			r.resolveBuildConflict(conflict)
		case ConflictTypeMovement:
			r.resolveMovementConflict(conflict)
		}

		for _, p := range conflict.Participants {
			if actionResolved[p.ActionID] {
				continue
			}
			success := p.UnitID == conflict.Winner
			resolvedActions = append(resolvedActions, ResolvedAction{
				Action:  p.OriginalAction,
				Success: success,
				Result:  conflict.Result,
			})
			actionResolved[p.ActionID] = true
		}
	}

	for _, action := range actions {
		if actionResolved[action.ID] {
			continue
		}
		resolvedActions = append(resolvedActions, ResolvedAction{
			Action:  action,
			Success: true,
			Result:  "no conflict",
		})
	}

	sort.Slice(resolvedActions, func(i, j int) bool {
		return resolvedActions[i].Action.ExecuteTime < resolvedActions[j].Action.ExecuteTime
	})

	return resolvedActions, allConflicts, nil
}

func (r *ConflictResolver) loadState(state protocol.GameState) {
	r.units = make(map[string]*protocol.Unit)
	r.buildings = make(map[string]*protocol.Building)
	r.players = make(map[string]*protocol.Player)
	r.positions = make(map[string]protocol.Position)

	for i := range state.Units {
		unit := &state.Units[i]
		r.units[unit.ID] = unit
		r.positions[unit.ID] = unit.Position
	}

	for i := range state.Buildings {
		building := &state.Buildings[i]
		r.buildings[building.ID] = building
		r.positions[building.ID] = building.Position
	}

	for i := range state.Players {
		player := &state.Players[i]
		r.players[player.ID] = player
	}
}

func (r *ConflictResolver) findAttackConflicts(actions []protocol.Action) []Conflict {
	targetMap := make(map[string][]ConflictParticipant)

	for _, action := range actions {
		if action.Type != protocol.ActionAttack || action.TargetID == "" {
			continue
		}

		unit, exists := r.units[action.UnitID]
		if !exists || unit.HP <= 0 {
			continue
		}

		participant := ConflictParticipant{
			PlayerID:       action.PlayerID,
			UnitID:         action.UnitID,
			ActionID:       action.ID,
			Position:       unit.Position,
			AttackPower:    unit.Attack,
			SubmitTime:     action.ExecuteTime,
			Distance:       r.calculateDistance(unit.Position, action.TargetID),
			OriginalAction: action,
		}

		targetMap[action.TargetID] = append(targetMap[action.TargetID], participant)
	}

	var conflicts []Conflict
	for targetID, participants := range targetMap {
		if len(participants) >= 2 {
			conflicts = append(conflicts, Conflict{
				Type:         ConflictTypeAttack,
				TargetID:     targetID,
				Participants: participants,
			})
		}
	}

	return conflicts
}

func (r *ConflictResolver) resolveAttackConflict(conflict *Conflict) {
	sort.Slice(conflict.Participants, func(i, j int) bool {
		if conflict.Participants[i].AttackPower != conflict.Participants[j].AttackPower {
			return conflict.Participants[i].AttackPower > conflict.Participants[j].AttackPower
		}
		if conflict.Participants[i].SubmitTime != conflict.Participants[j].SubmitTime {
			return conflict.Participants[i].SubmitTime < conflict.Participants[j].SubmitTime
		}
		if conflict.Participants[i].PlayerID != conflict.Participants[j].PlayerID {
			return conflict.Participants[i].PlayerID < conflict.Participants[j].PlayerID
		}
		return conflict.Participants[i].ActionID < conflict.Participants[j].ActionID
	})

	totalDamage := 0
	for _, p := range conflict.Participants {
		totalDamage += p.AttackPower
	}

	if len(conflict.Participants) > 0 {
		conflict.Winner = conflict.Participants[0].UnitID
		conflict.Resolved = true
		conflict.Result = fmt.Sprintf("resolved: %d attackers, total damage %d, priority to %s",
			len(conflict.Participants), totalDamage, conflict.Winner)
	}
}

func (r *ConflictResolver) findResourceConflicts(actions []protocol.Action) []Conflict {
	resourceMap := make(map[protocol.Position][]ConflictParticipant)

	for _, action := range actions {
		if action.Type != protocol.ActionMove || action.TargetPos == nil {
			continue
		}

		unit, exists := r.units[action.UnitID]
		if !exists || unit.HP <= 0 {
			continue
		}

		if !r.isResourcePosition(*action.TargetPos) {
			continue
		}

		playerUnitCount := r.countPlayerUnits(action.PlayerID, *action.TargetPos)

		participant := ConflictParticipant{
			PlayerID:       action.PlayerID,
			UnitID:         action.UnitID,
			ActionID:       action.ID,
			Position:       unit.Position,
			UnitCount:      playerUnitCount + 1,
			SubmitTime:     action.ExecuteTime,
			Distance:       r.distance(unit.Position, *action.TargetPos),
			OriginalAction: action,
		}

		resourceMap[*action.TargetPos] = append(resourceMap[*action.TargetPos], participant)
	}

	var conflicts []Conflict
	for pos, participants := range resourceMap {
		if len(participants) >= 2 {
			posCopy := pos
			conflicts = append(conflicts, Conflict{
				Type:         ConflictTypeResource,
				TargetPos:    &posCopy,
				Participants: participants,
			})
		}
	}

	return conflicts
}

func (r *ConflictResolver) resolveResourceConflict(conflict *Conflict) {
	sort.Slice(conflict.Participants, func(i, j int) bool {
		diff := conflict.Participants[i].Distance - conflict.Participants[j].Distance
		if math.Abs(diff) > 0.1 {
			return diff < 0
		}
		if conflict.Participants[i].UnitCount != conflict.Participants[j].UnitCount {
			return conflict.Participants[i].UnitCount > conflict.Participants[j].UnitCount
		}
		if conflict.Participants[i].SubmitTime != conflict.Participants[j].SubmitTime {
			return conflict.Participants[i].SubmitTime < conflict.Participants[j].SubmitTime
		}
		if conflict.Participants[i].PlayerID != conflict.Participants[j].PlayerID {
			return conflict.Participants[i].PlayerID < conflict.Participants[j].PlayerID
		}
		return conflict.Participants[i].ActionID < conflict.Participants[j].ActionID
	})

	if len(conflict.Participants) > 0 {
		conflict.Winner = conflict.Participants[0].UnitID
		conflict.Resolved = true
		conflict.Result = fmt.Sprintf("resource resolved: distance %.2f, units %d",
			conflict.Participants[0].Distance, conflict.Participants[0].UnitCount)
	}
}

func (r *ConflictResolver) findBuildConflicts(actions []protocol.Action) []Conflict {
	positionMap := make(map[protocol.Position][]ConflictParticipant)

	for _, action := range actions {
		if action.Type != protocol.ActionBuild || action.TargetPos == nil {
			continue
		}

		player, exists := r.players[action.PlayerID]
		if !exists {
			continue
		}

		participant := ConflictParticipant{
			PlayerID:       action.PlayerID,
			ActionID:       action.ID,
			Position:       *action.TargetPos,
			SubmitTime:     action.ExecuteTime,
			Priority:       player.Team,
			OriginalAction: action,
		}

		positionMap[*action.TargetPos] = append(positionMap[*action.TargetPos], participant)
	}

	var conflicts []Conflict
	for pos, participants := range positionMap {
		if len(participants) >= 2 {
			posCopy := pos
			conflicts = append(conflicts, Conflict{
				Type:         ConflictTypeBuild,
				TargetPos:    &posCopy,
				Participants: participants,
			})
		}
	}

	return conflicts
}

func (r *ConflictResolver) resolveBuildConflict(conflict *Conflict) {
	sort.Slice(conflict.Participants, func(i, j int) bool {
		if conflict.Participants[i].SubmitTime != conflict.Participants[j].SubmitTime {
			return conflict.Participants[i].SubmitTime < conflict.Participants[j].SubmitTime
		}
		if conflict.Participants[i].PlayerID != conflict.Participants[j].PlayerID {
			return conflict.Participants[i].PlayerID < conflict.Participants[j].PlayerID
		}
		return conflict.Participants[i].ActionID < conflict.Participants[j].ActionID
	})

	if len(conflict.Participants) > 0 {
		conflict.Winner = conflict.Participants[0].ActionID
		conflict.Resolved = true
		conflict.Result = fmt.Sprintf("build resolved: earliest submit at %d ms",
			conflict.Participants[0].SubmitTime)

		for i := 1; i < len(conflict.Participants); i++ {
			p := &conflict.Participants[i]
			if player, exists := r.players[p.PlayerID]; exists {
				cost := r.getBuildingCost(p.OriginalAction.BuildingType)
				player.Resources += cost
			}
		}
	}
}

func (r *ConflictResolver) findMovementConflicts(actions []protocol.Action) []Conflict {
	positionMap := make(map[protocol.Position][]ConflictParticipant)

	for _, action := range actions {
		if action.Type != protocol.ActionMove || action.TargetPos == nil {
			continue
		}

		unit, exists := r.units[action.UnitID]
		if !exists || unit.HP <= 0 {
			continue
		}

		participant := ConflictParticipant{
			PlayerID:       action.PlayerID,
			UnitID:         action.UnitID,
			ActionID:       action.ID,
			Position:       *action.TargetPos,
			Priority:       r.getUnitPriority(unit.Type),
			SubmitTime:     action.ExecuteTime,
			OriginalAction: action,
		}

		positionMap[*action.TargetPos] = append(positionMap[*action.TargetPos], participant)
	}

	for _, building := range r.buildings {
		participant := ConflictParticipant{
			PlayerID: building.PlayerID,
			UnitID:   building.ID,
			Position: building.Position,
			Priority: r.getBuildingPriority(building.Type),
		}
		positionMap[building.Position] = append(positionMap[building.Position], participant)
	}

	var conflicts []Conflict
	for pos, participants := range positionMap {
		if len(participants) >= 2 {
			posCopy := pos
			conflicts = append(conflicts, Conflict{
				Type:         ConflictTypeMovement,
				TargetPos:    &posCopy,
				Participants: participants,
			})
		}
	}

	return conflicts
}

func (r *ConflictResolver) resolveMovementConflict(conflict *Conflict) {
	sort.Slice(conflict.Participants, func(i, j int) bool {
		if conflict.Participants[i].Priority != conflict.Participants[j].Priority {
			return conflict.Participants[i].Priority > conflict.Participants[j].Priority
		}
		if conflict.Participants[i].SubmitTime != conflict.Participants[j].SubmitTime {
			return conflict.Participants[i].SubmitTime < conflict.Participants[j].SubmitTime
		}
		if conflict.Participants[i].PlayerID != conflict.Participants[j].PlayerID {
			return conflict.Participants[i].PlayerID < conflict.Participants[j].PlayerID
		}
		return conflict.Participants[i].UnitID < conflict.Participants[j].UnitID
	})

	if len(conflict.Participants) > 0 {
		conflict.Winner = conflict.Participants[0].UnitID
		conflict.Resolved = true
		conflict.Result = fmt.Sprintf("movement resolved: priority %d for %s",
			conflict.Participants[0].Priority, conflict.Winner)
	}
}

func (r *ConflictResolver) getUnitPriority(unitType protocol.UnitType) int {
	switch unitType {
	case protocol.UnitMage:
		return 3
	case protocol.UnitArcher:
		return 2
	case protocol.UnitWarrior:
		return 1
	default:
		return 0
	}
}

func (r *ConflictResolver) getBuildingPriority(buildingType protocol.BuildingType) int {
	switch buildingType {
	case protocol.BuildingBase:
		return 10
	case protocol.BuildingTurret:
		return 8
	case protocol.BuildingBarracks:
		return 6
	default:
		return 5
	}
}

func (r *ConflictResolver) calculateDistance(from protocol.Position, targetID string) float64 {
	if targetPos, exists := r.positions[targetID]; exists {
		return r.distance(from, targetPos)
	}
	return math.MaxFloat64
}

func (r *ConflictResolver) distance(pos1, pos2 protocol.Position) float64 {
	dx := pos1.X - pos2.X
	dy := pos1.Y - pos2.Y
	return math.Sqrt(float64(dx*dx + dy*dy))
}

func (r *ConflictResolver) isResourcePosition(pos protocol.Position) bool {
	return (pos.X+pos.Y)%5 == 0
}

func (r *ConflictResolver) countPlayerUnits(playerID string, targetPos protocol.Position) int {
	count := 0
	for _, unit := range r.units {
		if unit.PlayerID == playerID && unit.HP > 0 {
			dist := r.distance(unit.Position, targetPos)
			if dist < 2.0 {
				count++
			}
		}
	}
	return count
}

func (r *ConflictResolver) getBuildingCost(buildingType protocol.BuildingType) int {
	switch buildingType {
	case protocol.BuildingTurret:
		return protocol.TurretCost
	case protocol.BuildingBarracks:
		return protocol.BarracksCost
	default:
		return 0
	}
}
