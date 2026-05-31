package room

import (
	"context"
	"fmt"

	"github.com/vmihailenco/msgpack/v5"

	"github.com/timeline-wars/server/internal/redis"
	"github.com/timeline-wars/server/internal/ws"
	"github.com/timeline-wars/server/pkg/protocol"
)

type RoomService struct {
	manager  *RoomManager
	hub      *ws.Hub
	redisCli *redis.Client
}

func NewRoomService(manager *RoomManager, hub *ws.Hub, redisCli *redis.Client) *RoomService {
	return &RoomService{
		manager:  manager,
		hub:      hub,
		redisCli: redisCli,
	}
}

func (s *RoomService) HandleCreateRoom(ctx context.Context, client *ws.Client, req *protocol.CreateRoomRequest) error {
	room, err := s.manager.CreateRoom(ctx, req.PlayerID, req.PlayerName, req.RoomName, req.MaxPlayers, req.Password)
	if err != nil {
		return s.sendError(client, protocol.ErrCodeInternalError, err.Error())
	}

	client.RoomID = room.ID
	client.PlayerID = req.PlayerID
	s.hub.SetClientRoom(client, room.ID)
	s.hub.SetClientPlayerID(client, req.PlayerID)

	roomInfo := room.ToRoomInfoResponse()
	if err := s.sendRoomInfo(client, roomInfo); err != nil {
		return err
	}

	return s.broadcastPlayerList(ctx, room)
}

func (s *RoomService) HandleJoinRoom(ctx context.Context, client *ws.Client, req *protocol.JoinRoomRequest) error {
	room, err := s.manager.JoinRoom(ctx, req.RoomID, req.PlayerID, req.PlayerName, req.Password)
	if err != nil {
		switch err {
		case ErrRoomNotFound:
			return s.sendError(client, protocol.ErrCodeRoomNotFound, err.Error())
		case ErrRoomFull:
			return s.sendError(client, protocol.ErrCodeRoomFull, err.Error())
		case ErrWrongPassword:
			return s.sendError(client, protocol.ErrCodeWrongPassword, err.Error())
		case ErrGameAlreadyStarted:
			return s.sendError(client, protocol.ErrCodeGameAlreadyStarted, err.Error())
		default:
			return s.sendError(client, protocol.ErrCodeInternalError, err.Error())
		}
	}

	client.RoomID = room.ID
	client.PlayerID = req.PlayerID
	s.hub.SetClientRoom(client, room.ID)
	s.hub.SetClientPlayerID(client, req.PlayerID)

	roomInfo := room.ToRoomInfoResponse()
	if err := s.sendRoomInfo(client, roomInfo); err != nil {
		return err
	}

	return s.broadcastPlayerList(ctx, room)
}

func (s *RoomService) HandleLeaveRoom(ctx context.Context, client *ws.Client, req *protocol.LeaveRoomRequest) error {
	room, ok := s.manager.GetRoom(req.RoomID)
	if !ok {
		return s.sendError(client, protocol.ErrCodeRoomNotFound, "room not found")
	}

	if err := s.manager.LeaveRoom(ctx, req.RoomID, req.PlayerID); err != nil {
		switch err {
		case ErrRoomNotFound:
			return s.sendError(client, protocol.ErrCodeRoomNotFound, err.Error())
		case ErrPlayerNotInRoom:
			return s.sendError(client, protocol.ErrCodePlayerNotInRoom, err.Error())
		default:
			return s.sendError(client, protocol.ErrCodeInternalError, err.Error())
		}
	}

	client.RoomID = ""
	s.hub.SetClientRoom(client, "")

	room, ok = s.manager.GetRoom(req.RoomID)
	if ok {
		if err := s.broadcastRoomInfo(ctx, room); err != nil {
			return err
		}
		return s.broadcastPlayerList(ctx, room)
	}

	return nil
}

func (s *RoomService) HandlePlayerReady(ctx context.Context, client *ws.Client, req *protocol.ReadyRequest) error {
	if err := s.manager.PlayerReady(ctx, req.RoomID, req.PlayerID, req.Ready); err != nil {
		switch err {
		case ErrRoomNotFound:
			return s.sendError(client, protocol.ErrCodeRoomNotFound, err.Error())
		case ErrPlayerNotInRoom:
			return s.sendError(client, protocol.ErrCodePlayerNotInRoom, err.Error())
		case ErrGameAlreadyStarted:
			return s.sendError(client, protocol.ErrCodeGameAlreadyStarted, err.Error())
		default:
			return s.sendError(client, protocol.ErrCodeInternalError, err.Error())
		}
	}

	room, ok := s.manager.GetRoom(req.RoomID)
	if !ok {
		return s.sendError(client, protocol.ErrCodeRoomNotFound, "room not found")
	}

	return s.broadcastPlayerList(ctx, room)
}

func (s *RoomService) HandleStartGame(ctx context.Context, client *ws.Client, req *protocol.StartGameRequest) error {
	if err := s.manager.StartGame(ctx, req.RoomID, req.PlayerID); err != nil {
		switch err {
		case ErrRoomNotFound:
			return s.sendError(client, protocol.ErrCodeRoomNotFound, err.Error())
		case ErrNotHost:
			return s.sendError(client, protocol.ErrCodeNotHost, err.Error())
		case ErrGameAlreadyStarted:
			return s.sendError(client, protocol.ErrCodeGameAlreadyStarted, err.Error())
		case ErrNotAllReady:
			return s.sendError(client, protocol.ErrCodeInternalError, err.Error())
		default:
			return s.sendError(client, protocol.ErrCodeInternalError, err.Error())
		}
	}

	room, ok := s.manager.GetRoom(req.RoomID)
	if !ok {
		return s.sendError(client, protocol.ErrCodeRoomNotFound, "room not found")
	}

	gameState := s.createInitialGameState(room)

	startMsg := &protocol.GameStartMessage{
		RoomID:    room.ID,
		GameState: gameState,
	}

	data, err := msgpack.Marshal(startMsg)
	if err != nil {
		return fmt.Errorf("failed to marshal game start message: %w", err)
	}

	msg := &ws.Message{
		Type: fmt.Sprintf("%d", protocol.MsgTypeStartGame),
		Data: data,
	}

	return room.BroadcastMessage(ctx, msg)
}

func (s *RoomService) broadcastRoomInfo(ctx context.Context, room *Room) error {
	roomInfo := room.ToRoomInfoResponse()
	data, err := msgpack.Marshal(roomInfo)
	if err != nil {
		return fmt.Errorf("failed to marshal room info: %w", err)
	}

	msg := &ws.Message{
		Type: fmt.Sprintf("%d", protocol.MsgTypeRoomInfo),
		Data: data,
	}

	return room.BroadcastMessage(ctx, msg)
}

func (s *RoomService) broadcastPlayerList(ctx context.Context, room *Room) error {
	playerList := &protocol.PlayerListMessage{
		RoomID:  room.ID,
		Players: room.GetPlayers(),
	}

	data, err := msgpack.Marshal(playerList)
	if err != nil {
		return fmt.Errorf("failed to marshal player list: %w", err)
	}

	msg := &ws.Message{
		Type: fmt.Sprintf("%d", protocol.MsgTypePlayerList),
		Data: data,
	}

	return room.BroadcastMessage(ctx, msg)
}

func (s *RoomService) sendRoomInfo(client *ws.Client, roomInfo *protocol.RoomInfoResponse) error {
	data, err := msgpack.Marshal(roomInfo)
	if err != nil {
		return fmt.Errorf("failed to marshal room info: %w", err)
	}

	msg := &ws.Message{
		Type: fmt.Sprintf("%d", protocol.MsgTypeRoomInfo),
		Data: data,
	}

	return client.SendMessage(msg)
}

func (s *RoomService) sendError(client *ws.Client, code int, message string) error {
	errMsg := &protocol.ErrorMessage{
		Code:    code,
		Message: message,
	}

	data, err := msgpack.Marshal(errMsg)
	if err != nil {
		return fmt.Errorf("failed to marshal error message: %w", err)
	}

	msg := &ws.Message{
		Type: fmt.Sprintf("%d", protocol.MsgTypeError),
		Data: data,
	}

	return client.SendMessage(msg)
}

func (s *RoomService) createInitialGameState(room *Room) protocol.GameState {
	players := room.GetPlayers()
	units := s.createInitialUnits(players)
	buildings := s.createInitialBuildings(players)

	return protocol.GameState{
		Phase:     protocol.GamePhasePlanning,
		Turn:      room.CurrentRound,
		Units:     units,
		Buildings: buildings,
		Players:   players,
		Timestamp: 0,
	}
}

func (s *RoomService) createInitialUnits(players []protocol.Player) []protocol.Unit {
	units := make([]protocol.Unit, 0)
	basePositions := []protocol.Position{
		{X: 2, Y: 2},
		{X: 17, Y: 17},
		{X: 2, Y: 17},
		{X: 17, Y: 2},
	}

	for i, player := range players {
		basePos := basePositions[i%len(basePositions)]

		for j := 0; j < protocol.InitialWarriors; j++ {
			units = append(units, protocol.Unit{
				ID:       fmt.Sprintf("%s_warrior_%d", player.ID, j),
				Type:     protocol.UnitWarrior,
				PlayerID: player.ID,
				HP:       protocol.WarriorHP,
				MaxHP:    protocol.WarriorHP,
				Position: protocol.Position{
					X: basePos.X + (j % 3),
					Y: basePos.Y + (j / 3),
				},
				Attack:  protocol.WarriorAttack,
				Range:   protocol.WarriorRange,
				Speed:   protocol.WarriorSpeed,
			})
		}

		for j := 0; j < protocol.InitialArchers; j++ {
			units = append(units, protocol.Unit{
				ID:       fmt.Sprintf("%s_archer_%d", player.ID, j),
				Type:     protocol.UnitArcher,
				PlayerID: player.ID,
				HP:       protocol.ArcherHP,
				MaxHP:    protocol.ArcherHP,
				Position: protocol.Position{
					X: basePos.X + 1 + (j % 2),
					Y: basePos.Y + 2 + (j / 2),
				},
				Attack:  protocol.ArcherAttack,
				Range:   protocol.ArcherRange,
				Speed:   protocol.ArcherSpeed,
			})
		}

		for j := 0; j < protocol.InitialMages; j++ {
			units = append(units, protocol.Unit{
				ID:       fmt.Sprintf("%s_mage_%d", player.ID, j),
				Type:     protocol.UnitMage,
				PlayerID: player.ID,
				HP:       protocol.MageHP,
				MaxHP:    protocol.MageHP,
				Position: protocol.Position{
					X: basePos.X + 2,
					Y: basePos.Y + 1,
				},
				Attack:  protocol.MageAttack,
				Range:   protocol.MageRange,
				Speed:   protocol.MageSpeed,
			})
		}
	}

	return units
}

func (s *RoomService) createInitialBuildings(players []protocol.Player) []protocol.Building {
	buildings := make([]protocol.Building, 0)
	basePositions := []protocol.Position{
		{X: 1, Y: 1},
		{X: 18, Y: 18},
		{X: 1, Y: 18},
		{X: 18, Y: 1},
	}

	for i, player := range players {
		basePos := basePositions[i%len(basePositions)]

		buildings = append(buildings, protocol.Building{
			ID:       fmt.Sprintf("%s_base", player.ID),
			Type:     protocol.BuildingBase,
			PlayerID: player.ID,
			HP:       protocol.BaseHP,
			MaxHP:    protocol.BaseHP,
			Position: basePos,
		})
	}

	return buildings
}
