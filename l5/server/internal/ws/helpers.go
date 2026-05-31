package ws

import (
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/vmihailenco/msgpack/v5"
)

var (
	heartbeatTimeoutVar = 5 * time.Second
)

func SetHeartbeatTimeout(timeout time.Duration) {
	heartbeatTimeoutVar = timeout
}

func (h *Hub) NewClient(conn *websocket.Conn) *Client {
	id := uuid.New().String()
	return NewClient(id, conn, h, nil)
}

func (h *Hub) NewClientWithRouter(conn *websocket.Conn, router *Router) *Client {
	id := uuid.New().String()
	return NewClient(id, conn, h, router)
}

func (h *Hub) Run() {
	h.run()
}

func (h *Hub) Stop() {
	h.mu.Lock()
	defer h.mu.Unlock()

	for _, client := range h.clients {
		client.cancel()
		close(client.Send)
	}

	h.clients = make(map[string]*Client)
	h.rooms = make(map[string]map[string]*Client)
	h.playerIDs = make(map[string]*Client)
}

func (h *Hub) GetClientCount() int {
	return h.ClientCount()
}

func (h *Hub) GetRoomCount() int {
	return h.RoomCount()
}

func (h *Hub) BroadcastToRoomWithType(roomID string, msgType string, data interface{}) error {
	msg := &Message{
		Type: msgType,
		Data: data,
	}
	return h.BroadcastToRoom(roomID, msg)
}

func (c *Client) SendMessageWithType(msgType string, data interface{}) error {
	msg := &Message{
		Type: msgType,
		Data: data,
	}
	return c.SendMessage(msg)
}

func (c *Client) ReadPumpWithContext(ctx interface{}, router *Router) {
	c.Router = router
	c.ReadPump()
}

func CreateMessage(msgType string, data interface{}) (*Message, error) {
	return &Message{
		Type: msgType,
		Data: data,
	}, nil
}

func SerializeMessage(msg *Message) ([]byte, error) {
	return msgpack.Marshal(msg)
}

func DeserializeMessage(data []byte) (*Message, error) {
	var msg Message
	err := msgpack.Unmarshal(data, &msg)
	if err != nil {
		return nil, err
	}
	return &msg, nil
}
