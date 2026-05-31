package ws

import (
	"errors"
	"sync"
)

type Hub struct {
	clients    map[string]*Client
	rooms      map[string]map[string]*Client
	playerIDs  map[string]*Client
	mu         sync.RWMutex
	register   chan *Client
	unregister chan *Client
}

func NewHub() *Hub {
	h := &Hub{
		clients:    make(map[string]*Client),
		rooms:      make(map[string]map[string]*Client),
		playerIDs:  make(map[string]*Client),
		register:   make(chan *Client, 100),
		unregister: make(chan *Client, 100),
	}
	go h.run()
	return h
}

func (h *Hub) run() {
	for {
		select {
		case client := <-h.register:
			h.registerClient(client)
		case client := <-h.unregister:
			h.unregisterClient(client)
		}
	}
}

func (h *Hub) Register(client *Client) {
	h.register <- client
}

func (h *Hub) Unregister(client *Client) {
	select {
	case h.unregister <- client:
	default:
		h.unregisterClient(client)
	}
}

func (h *Hub) registerClient(client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.clients[client.ID] = client

	if client.PlayerID != "" {
		h.playerIDs[client.PlayerID] = client
	}

	if client.RoomID != "" {
		if _, ok := h.rooms[client.RoomID]; !ok {
			h.rooms[client.RoomID] = make(map[string]*Client)
		}
		h.rooms[client.RoomID][client.ID] = client
	}
}

func (h *Hub) unregisterClient(client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if _, ok := h.clients[client.ID]; !ok {
		return
	}

	delete(h.clients, client.ID)

	if client.PlayerID != "" {
		delete(h.playerIDs, client.PlayerID)
	}

	if client.RoomID != "" {
		if room, ok := h.rooms[client.RoomID]; ok {
			delete(room, client.ID)
			if len(room) == 0 {
				delete(h.rooms, client.RoomID)
			}
		}
	}

	close(client.Send)
}

func (h *Hub) BroadcastToRoom(roomID string, msg *Message) error {
	if roomID == "" {
		return errors.New("room id is empty")
	}

	h.mu.RLock()
	room, ok := h.rooms[roomID]
	if !ok {
		h.mu.RUnlock()
		return errors.New("room not found")
	}

	clients := make([]*Client, 0, len(room))
	for _, client := range room {
		clients = append(clients, client)
	}
	h.mu.RUnlock()

	for _, client := range clients {
		client.SendMessage(msg)
	}

	return nil
}

func (h *Hub) SendToPlayer(playerID string, msg *Message) error {
	if playerID == "" {
		return errors.New("player id is empty")
	}

	h.mu.RLock()
	client, ok := h.playerIDs[playerID]
	h.mu.RUnlock()

	if !ok {
		return errors.New("player not found")
	}

	return client.SendMessage(msg)
}

func (h *Hub) GetClientByID(id string) (*Client, bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	client, ok := h.clients[id]
	return client, ok
}

func (h *Hub) GetClientByPlayerID(playerID string) (*Client, bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	client, ok := h.playerIDs[playerID]
	return client, ok
}

func (h *Hub) GetRoomClients(roomID string) ([]*Client, error) {
	if roomID == "" {
		return nil, errors.New("room id is empty")
	}

	h.mu.RLock()
	defer h.mu.RUnlock()

	room, ok := h.rooms[roomID]
	if !ok {
		return nil, errors.New("room not found")
	}

	clients := make([]*Client, 0, len(room))
	for _, client := range room {
		clients = append(clients, client)
	}

	return clients, nil
}

func (h *Hub) GetAllClients() []*Client {
	h.mu.RLock()
	defer h.mu.RUnlock()

	clients := make([]*Client, 0, len(h.clients))
	for _, client := range h.clients {
		clients = append(clients, client)
	}

	return clients
}

func (h *Hub) SetClientRoom(client *Client, roomID string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if client.RoomID != "" {
		if oldRoom, ok := h.rooms[client.RoomID]; ok {
			delete(oldRoom, client.ID)
			if len(oldRoom) == 0 {
				delete(h.rooms, client.RoomID)
			}
		}
	}

	client.RoomID = roomID

	if roomID != "" {
		if _, ok := h.rooms[roomID]; !ok {
			h.rooms[roomID] = make(map[string]*Client)
		}
		h.rooms[roomID][client.ID] = client
	}
}

func (h *Hub) SetClientPlayerID(client *Client, playerID string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if client.PlayerID != "" {
		delete(h.playerIDs, client.PlayerID)
	}

	client.PlayerID = playerID

	if playerID != "" {
		h.playerIDs[playerID] = client
	}
}

func (h *Hub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

func (h *Hub) RoomCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.rooms)
}

func (h *Hub) Close() {
	h.mu.Lock()
	defer h.mu.Unlock()

	for _, client := range h.clients {
		close(client.Send)
		client.Conn.Close()
	}

	h.clients = make(map[string]*Client)
	h.rooms = make(map[string]map[string]*Client)
	h.playerIDs = make(map[string]*Client)
}
