package room

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/timeline-wars/server/internal/redis"
	"github.com/timeline-wars/server/internal/ws"
	"github.com/timeline-wars/server/pkg/protocol"
)

var (
	ErrRoomFull        = errors.New("room is full")
	ErrPlayerNotFound  = errors.New("player not found in room")
	ErrInvalidMaxPlayers = errors.New("max players must be between 2 and 4")
)

var playerColors = []string{
	"#FF6B6B",
	"#4ECDC4",
	"#45B7D1",
	"#96CEB4",
}

type RoomStatus string

const (
	RoomStatusWaiting  RoomStatus = "waiting"
	RoomStatusPlaying  RoomStatus = "playing"
	RoomStatusFinished RoomStatus = "finished"
)

type Room struct {
	ID           string
	Name         string
	HostID       string
	MaxPlayers   int
	Players      map[string]*protocol.Player
	PlayerColors map[string]string
	Status       RoomStatus
	CurrentRound int
	Phase        protocol.GamePhase
	Password     string
	CreatedAt    int64

	mu        sync.RWMutex
	hub       *ws.Hub
	redisCli  *redis.Client
}

func NewRoom(id, name, hostID string, maxPlayers int, password string, hub *ws.Hub, redisCli *redis.Client) (*Room, error) {
	if maxPlayers < 2 || maxPlayers > 4 {
		return nil, ErrInvalidMaxPlayers
	}

	return &Room{
		ID:           id,
		Name:         name,
		HostID:       hostID,
		MaxPlayers:   maxPlayers,
		Players:      make(map[string]*protocol.Player),
		PlayerColors: make(map[string]string),
		Status:       RoomStatusWaiting,
		CurrentRound: 0,
		Phase:        protocol.GamePhaseLobby,
		Password:     password,
		CreatedAt:    0,
		hub:          hub,
		redisCli:     redisCli,
	}, nil
}

func (r *Room) AddPlayer(player *protocol.Player) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if len(r.Players) >= r.MaxPlayers {
		return ErrRoomFull
	}

	color, err := r.assignColor()
	if err != nil {
		return err
	}

	player.Ready = false
	r.Players[player.ID] = player
	r.PlayerColors[player.ID] = color

	return nil
}

func (r *Room) RemovePlayer(playerID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.Players[playerID]; !ok {
		return ErrPlayerNotFound
	}

	delete(r.Players, playerID)
	delete(r.PlayerColors, playerID)

	return nil
}

func (r *Room) SetPlayerReady(playerID string, ready bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	player, ok := r.Players[playerID]
	if !ok {
		return ErrPlayerNotFound
	}

	player.Ready = ready
	return nil
}

func (r *Room) AllPlayersReady() bool {
	r.mu.RLock()
	defer r.mu.RUnlock()

	if len(r.Players) < 2 {
		return false
	}

	for _, player := range r.Players {
		if !player.Ready {
			return false
		}
	}

	return true
}

func (r *Room) GetPlayerCount() int {
	r.mu.RLock()
	defer r.mu.RUnlock()

	return len(r.Players)
}

func (r *Room) GetPlayers() []protocol.Player {
	r.mu.RLock()
	defer r.mu.RUnlock()

	players := make([]protocol.Player, 0, len(r.Players))
	for _, player := range r.Players {
		players = append(players, *player)
	}

	return players
}

func (r *Room) HasPlayer(playerID string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()

	_, ok := r.Players[playerID]
	return ok
}

func (r *Room) GetPlayer(playerID string) (*protocol.Player, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	player, ok := r.Players[playerID]
	return player, ok
}

func (r *Room) GetPlayerColor(playerID string) (string, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	color, ok := r.PlayerColors[playerID]
	return color, ok
}

func (r *Room) BroadcastMessage(ctx context.Context, msg *ws.Message) error {
	return r.hub.BroadcastToRoom(r.ID, msg)
}

func (r *Room) SendToPlayer(playerID string, msg *ws.Message) error {
	return r.hub.SendToPlayer(playerID, msg)
}

func (r *Room) SetStatus(status RoomStatus) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.Status = status
}

func (r *Room) SetPhase(phase protocol.GamePhase) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.Phase = phase
}

func (r *Room) IncrementRound() {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.CurrentRound++
}

func (r *Room) GetHostID() string {
	r.mu.RLock()
	defer r.mu.RUnlock()

	return r.HostID
}

func (r *Room) SetHostID(hostID string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.HostID = hostID
}

func (r *Room) HasPassword() bool {
	r.mu.RLock()
	defer r.mu.RUnlock()

	return r.Password != ""
}

func (r *Room) CheckPassword(password string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()

	return r.Password == password
}

func (r *Room) Persist(ctx context.Context) error {
	roomData := &redis.Room{
		ID:         r.ID,
		Name:       r.Name,
		OwnerID:    r.HostID,
		MaxPlayers: r.MaxPlayers,
		Status:     string(r.Status),
	}

	return r.redisCli.SaveRoom(ctx, roomData, 0)
}

func (r *Room) ToRoomInfoResponse() *protocol.RoomInfoResponse {
	r.mu.RLock()
	defer r.mu.RUnlock()

	return &protocol.RoomInfoResponse{
		RoomID:      r.ID,
		RoomName:    r.Name,
		HostID:      r.HostID,
		Players:     r.getPlayersLocked(),
		MaxPlayers:  r.MaxPlayers,
		HasPassword: r.Password != "",
		Phase:       r.Phase,
	}
}

func (r *Room) assignColor() (string, error) {
	usedColors := make(map[string]bool)
	for _, color := range r.PlayerColors {
		usedColors[color] = true
	}

	for _, color := range playerColors {
		if !usedColors[color] {
			return color, nil
		}
	}

	return "", fmt.Errorf("no available colors")
}

func (r *Room) getPlayersLocked() []protocol.Player {
	players := make([]protocol.Player, 0, len(r.Players))
	for _, player := range r.Players {
		players = append(players, *player)
	}
	return players
}
