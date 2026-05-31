package room

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"strconv"
	"sync"
	"time"

	"github.com/timeline-wars/server/internal/redis"
	"github.com/timeline-wars/server/internal/ws"
	"github.com/timeline-wars/server/pkg/protocol"
)

var (
	ErrRoomNotFound    = errors.New("room not found")
	ErrRoomExists      = errors.New("room already exists")
	ErrNotHost         = errors.New("player is not the host")
	ErrGameAlreadyStarted = errors.New("game already started")
	ErrNotAllReady     = errors.New("not all players are ready")
	ErrPlayerNotInRoom = errors.New("player not in room")
	ErrWrongPassword   = errors.New("wrong password")
)

const (
	maxRoomIDRetries = 100
	roomIDLength     = 4
)

type RoomManager struct {
	rooms    map[string]*Room
	roomIDs  map[string]bool
	mu       sync.RWMutex
	hub      *ws.Hub
	redisCli *redis.Client
}

func NewRoomManager(hub *ws.Hub, redisCli *redis.Client) *RoomManager {
	return &RoomManager{
		rooms:    make(map[string]*Room),
		roomIDs:  make(map[string]bool),
		hub:      hub,
		redisCli: redisCli,
	}
}

func (m *RoomManager) CreateRoom(ctx context.Context, playerID, playerName, roomName string, maxPlayers int, password string) (*Room, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	roomID, err := m.generateRoomID()
	if err != nil {
		return nil, fmt.Errorf("failed to generate room id: %w", err)
	}

	room, err := NewRoom(roomID, roomName, playerID, maxPlayers, password, m.hub, m.redisCli)
	if err != nil {
		return nil, err
	}

	player := &protocol.Player{
		ID:       playerID,
		Name:     playerName,
		Team:     1,
		Resources: protocol.InitialResources,
		Ready:    false,
	}

	if err := room.AddPlayer(player); err != nil {
		return nil, err
	}

	m.rooms[roomID] = room
	m.roomIDs[roomID] = true

	if err := room.Persist(ctx); err != nil {
		return nil, fmt.Errorf("failed to persist room: %w", err)
	}

	if err := m.redisCli.AddPlayerToRoom(ctx, roomID, playerID); err != nil {
		return nil, fmt.Errorf("failed to add player to room in redis: %w", err)
	}

	return room, nil
}

func (m *RoomManager) JoinRoom(ctx context.Context, roomID, playerID, playerName, password string) (*Room, error) {
	m.mu.Lock()
	room, ok := m.rooms[roomID]
	m.mu.Unlock()

	if !ok {
		return nil, ErrRoomNotFound
	}

	if room.HasPassword() && !room.CheckPassword(password) {
		return nil, ErrWrongPassword
	}

	if room.Status != RoomStatusWaiting {
		return nil, ErrGameAlreadyStarted
	}

	player := &protocol.Player{
		ID:       playerID,
		Name:     playerName,
		Team:     room.GetPlayerCount() + 1,
		Resources: protocol.InitialResources,
		Ready:    false,
	}

	if err := room.AddPlayer(player); err != nil {
		return nil, err
	}

	if err := room.Persist(ctx); err != nil {
		room.RemovePlayer(playerID)
		return nil, fmt.Errorf("failed to persist room: %w", err)
	}

	if err := m.redisCli.AddPlayerToRoom(ctx, roomID, playerID); err != nil {
		room.RemovePlayer(playerID)
		return nil, fmt.Errorf("failed to add player to room in redis: %w", err)
	}

	return room, nil
}

func (m *RoomManager) LeaveRoom(ctx context.Context, roomID, playerID string) error {
	m.mu.Lock()
	room, ok := m.rooms[roomID]
	m.mu.Unlock()

	if !ok {
		return ErrRoomNotFound
	}

	if !room.HasPlayer(playerID) {
		return ErrPlayerNotInRoom
	}

	isHost := room.GetHostID() == playerID

	if err := room.RemovePlayer(playerID); err != nil {
		return err
	}

	if err := m.redisCli.RemovePlayerFromRoom(ctx, roomID, playerID); err != nil {
		return fmt.Errorf("failed to remove player from room in redis: %w", err)
	}

	playerCount := room.GetPlayerCount()

	if playerCount == 0 {
		m.mu.Lock()
		delete(m.rooms, roomID)
		delete(m.roomIDs, roomID)
		m.mu.Unlock()

		if err := m.redisCli.DeleteRoom(ctx, roomID); err != nil {
			return fmt.Errorf("failed to delete room from redis: %w", err)
		}

		return nil
	}

	if isHost {
		m.transferHost(room)
	}

	if err := room.Persist(ctx); err != nil {
		return fmt.Errorf("failed to persist room: %w", err)
	}

	return nil
}

func (m *RoomManager) GetRoom(roomID string) (*Room, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	room, ok := m.rooms[roomID]
	return room, ok
}

func (m *RoomManager) StartGame(ctx context.Context, roomID, playerID string) error {
	room, ok := m.GetRoom(roomID)
	if !ok {
		return ErrRoomNotFound
	}

	if room.GetHostID() != playerID {
		return ErrNotHost
	}

	if room.Status != RoomStatusWaiting {
		return ErrGameAlreadyStarted
	}

	if !room.AllPlayersReady() {
		return ErrNotAllReady
	}

	room.SetStatus(RoomStatusPlaying)
	room.SetPhase(protocol.GamePhasePlanning)
	room.IncrementRound()

	if err := room.Persist(ctx); err != nil {
		return fmt.Errorf("failed to persist room: %w", err)
	}

	gameState := &redis.GameState{
		RoomID:    roomID,
		Phase:     fmt.Sprint(protocol.GamePhasePlanning),
		Turn:      room.CurrentRound,
		Data:      make(map[string]interface{}),
		UpdatedAt: time.Now(),
	}

	if err := m.redisCli.SaveGameState(ctx, gameState, 0); err != nil {
		return fmt.Errorf("failed to save game state: %w", err)
	}

	return nil
}

func (m *RoomManager) PlayerReady(ctx context.Context, roomID, playerID string, ready bool) error {
	room, ok := m.GetRoom(roomID)
	if !ok {
		return ErrRoomNotFound
	}

	if !room.HasPlayer(playerID) {
		return ErrPlayerNotInRoom
	}

	if room.Status != RoomStatusWaiting {
		return ErrGameAlreadyStarted
	}

	if err := room.SetPlayerReady(playerID, ready); err != nil {
		return err
	}

	return nil
}

func (m *RoomManager) GetAllRooms() []*Room {
	m.mu.RLock()
	defer m.mu.RUnlock()

	rooms := make([]*Room, 0, len(m.rooms))
	for _, room := range m.rooms {
		rooms = append(rooms, room)
	}

	return rooms
}

func (m *RoomManager) transferHost(room *Room) {
	players := room.GetPlayers()
	if len(players) > 0 {
		room.SetHostID(players[0].ID)
	}
}

func (m *RoomManager) generateRoomID() (string, error) {
	for i := 0; i < maxRoomIDRetries; i++ {
		id, err := m.generateRandomDigits(roomIDLength)
		if err != nil {
			return "", err
		}

		if !m.roomIDs[id] {
			return id, nil
		}
	}

	return "", fmt.Errorf("failed to generate unique room id after %d retries", maxRoomIDRetries)
}

func (m *RoomManager) generateRandomDigits(length int) (string, error) {
	result := ""
	for i := 0; i < length; i++ {
		n, err := rand.Int(rand.Reader, big.NewInt(10))
		if err != nil {
			return "", fmt.Errorf("failed to generate random digit: %w", err)
		}
		result += strconv.Itoa(int(n.Int64()))
	}
	return result, nil
}

func (m *RoomManager) GetRoomCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.rooms)
}
