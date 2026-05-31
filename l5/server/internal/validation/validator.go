package validation

import (
	"strconv"

	"github.com/timeline-wars/server/pkg/protocol"
)

const (
	ErrCodeSpeedHack      = 3001
	ErrCodeTeleport       = 3002
	ErrCodeOutOfRange     = 3003
	ErrCodeNotOwner       = 3004
	ErrCodeUnitDead       = 3005
	ErrCodeTooManyActions = 3006
	ErrCodeDuplicateAction = 3007
	ErrCodeInvalidTime    = 3008
	ErrCodeTargetNotFound = 3009
	ErrCodeTargetFriendly = 3010
)

type ValidationError struct {
	ActionID string
	Code     int
	Message  string
}

type ActionValidator struct {
	maxActionsPerTimeline int
	maxSimDuration        int64
}

func NewActionValidator() *ActionValidator {
	return &ActionValidator{
		maxActionsPerTimeline: 20,
		maxSimDuration:        5000,
	}
}

func (v *ActionValidator) ValidateTimeline(timeline protocol.Timeline, gameState *protocol.GameState) []ValidationError {
	var errors []ValidationError

	if len(timeline.Actions) > v.maxActionsPerTimeline {
		errors = append(errors, ValidationError{
			Code:    ErrCodeTooManyActions,
			Message: "too many actions in timeline",
		})
		return errors
	}

	seen := make(map[string]struct{})
	for _, action := range timeline.Actions {
		if action.ExecuteTime < 0 || action.ExecuteTime > v.maxSimDuration {
			errors = append(errors, ValidationError{
				ActionID: action.ID,
				Code:     ErrCodeInvalidTime,
				Message:  "execute time out of valid range",
			})
			continue
		}

		dupKey := action.UnitID + "|" + strconv.Itoa(int(action.Type)) + "|" + strconv.FormatInt(action.ExecuteTime, 10)
		if _, exists := seen[dupKey]; exists {
			errors = append(errors, ValidationError{
				ActionID: action.ID,
				Code:     ErrCodeDuplicateAction,
				Message:  "duplicate action for same unit at same time",
			})
			continue
		}
		seen[dupKey] = struct{}{}

		unit, found := findUnit(gameState, action.UnitID)
		if !found {
			errors = append(errors, ValidationError{
				ActionID: action.ID,
				Code:     ErrCodeTargetNotFound,
				Message:  "unit not found",
			})
			continue
		}

		if unit.PlayerID != timeline.PlayerID {
			errors = append(errors, ValidationError{
				ActionID: action.ID,
				Code:     ErrCodeNotOwner,
				Message:  "unit does not belong to player",
			})
			continue
		}

		if unit.HP <= 0 {
			errors = append(errors, ValidationError{
				ActionID: action.ID,
				Code:     ErrCodeUnitDead,
				Message:  "unit is dead",
			})
			continue
		}

		switch action.Type {
		case protocol.ActionMove:
			errors = append(errors, v.validateMoveAction(action, unit)...)
		case protocol.ActionAttack:
			errors = append(errors, v.validateAttackAction(action, unit, gameState, timeline.PlayerID)...)
		case protocol.ActionBuild:
			errors = append(errors, v.validateBuildAction(action, unit, gameState, timeline.PlayerID)...)
		}
	}

	return errors
}

func (v *ActionValidator) validateMoveAction(action protocol.Action, unit protocol.Unit) []ValidationError {
	var errors []ValidationError

	if action.TargetPos == nil {
		errors = append(errors, ValidationError{
			ActionID: action.ID,
			Code:     ErrCodeTeleport,
			Message:  "move action missing target position",
		})
		return errors
	}

	distance := manhattanDistance(unit.Position, *action.TargetPos)
	maxDist := maxMoveDistance(unit.Speed, v.maxSimDuration)

	if distance > maxDist {
		errors = append(errors, ValidationError{
			ActionID: action.ID,
			Code:     ErrCodeSpeedHack,
			Message:  "move distance exceeds maximum allowed distance",
		})
	}

	return errors
}

func (v *ActionValidator) validateAttackAction(action protocol.Action, unit protocol.Unit, gameState *protocol.GameState, playerID string) []ValidationError {
	var errors []ValidationError

	if action.TargetID == "" {
		errors = append(errors, ValidationError{
			ActionID: action.ID,
			Code:     ErrCodeTargetNotFound,
			Message:  "attack action missing target id",
		})
		return errors
	}

	target, found := findUnit(gameState, action.TargetID)
	if !found {
		errors = append(errors, ValidationError{
			ActionID: action.ID,
			Code:     ErrCodeTargetNotFound,
			Message:  "attack target not found",
		})
		return errors
	}

	distance := manhattanDistance(unit.Position, target.Position)
	if distance > unit.Range {
		errors = append(errors, ValidationError{
			ActionID: action.ID,
			Code:     ErrCodeOutOfRange,
			Message:  "attack target out of range",
		})
	}

	if target.PlayerID == playerID {
		errors = append(errors, ValidationError{
			ActionID: action.ID,
			Code:     ErrCodeTargetFriendly,
			Message:  "cannot attack friendly unit",
		})
	}

	return errors
}

func (v *ActionValidator) validateBuildAction(action protocol.Action, unit protocol.Unit, gameState *protocol.GameState, playerID string) []ValidationError {
	var errors []ValidationError

	if action.TargetPos == nil {
		errors = append(errors, ValidationError{
			ActionID: action.ID,
			Code:     ErrCodeTeleport,
			Message:  "build action missing target position",
		})
		return errors
	}

	pos := *action.TargetPos
	if pos.X < 0 || pos.X >= protocol.MapWidth || pos.Y < 0 || pos.Y >= protocol.MapHeight {
		errors = append(errors, ValidationError{
			ActionID: action.ID,
			Code:     ErrCodeOutOfRange,
			Message:  "build position out of map bounds",
		})
	}

	if isPositionOccupied(gameState, pos) {
		errors = append(errors, ValidationError{
			ActionID: action.ID,
			Code:     ErrCodeOutOfRange,
			Message:  "build position is occupied",
		})
	}

	var cost int
	switch action.BuildingType {
	case protocol.BuildingTurret:
		cost = protocol.TurretCost
	case protocol.BuildingBarracks:
		cost = protocol.BarracksCost
	default:
		errors = append(errors, ValidationError{
			ActionID: action.ID,
			Code:     ErrCodeOutOfRange,
			Message:  "invalid building type",
		})
		return errors
	}

	player := findPlayer(gameState, playerID)
	if player != nil && player.Resources < cost {
		errors = append(errors, ValidationError{
			ActionID: action.ID,
			Code:     ErrCodeOutOfRange,
			Message:  "insufficient resources to build",
		})
	}

	return errors
}

func findUnit(gameState *protocol.GameState, unitID string) (protocol.Unit, bool) {
	for _, unit := range gameState.Units {
		if unit.ID == unitID {
			return unit, true
		}
	}
	return protocol.Unit{}, false
}

func findPlayer(gameState *protocol.GameState, playerID string) *protocol.Player {
	for i := range gameState.Players {
		if gameState.Players[i].ID == playerID {
			return &gameState.Players[i]
		}
	}
	return nil
}

func getUnitPosition(gameState *protocol.GameState, unitID string) (protocol.Position, bool) {
	unit, found := findUnit(gameState, unitID)
	if !found {
		return protocol.Position{}, false
	}
	return unit.Position, true
}

func manhattanDistance(a, b protocol.Position) int {
	dx := a.X - b.X
	dy := a.Y - b.Y
	if dx < 0 {
		dx = -dx
	}
	if dy < 0 {
		dy = -dy
	}
	return dx + dy
}

func maxMoveDistance(speed int, durationMs int64) int {
	return speed * int(durationMs/1000)
}

func isPositionOccupied(gameState *protocol.GameState, pos protocol.Position) bool {
	for _, unit := range gameState.Units {
		if unit.Position.X == pos.X && unit.Position.Y == pos.Y {
			return true
		}
	}
	for _, building := range gameState.Buildings {
		if building.Position.X == pos.X && building.Position.Y == pos.Y {
			return true
		}
	}
	return false
}
