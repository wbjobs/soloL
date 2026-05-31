package ws

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	"canvas-signal/internal/models"

	"github.com/gorilla/websocket"
)

type Connection struct {
	ID         string
	UserID     string
	RoomID     string
	Conn       *websocket.Conn
	Send       chan []byte
	LastPong   time.Time
	Once       sync.Once
	CloseChan  chan struct{}
	ReadChan   chan []byte
}

func NewConnection(id, userID, roomID string, conn *websocket.Conn) *Connection {
	return &Connection{
		ID:        id,
		UserID:    userID,
		RoomID:    roomID,
		Conn:      conn,
		Send:      make(chan []byte, 256),
		LastPong:  time.Now(),
		CloseChan: make(chan struct{}),
		ReadChan:  make(chan []byte, 256),
	}
}

func (c *Connection) ReadPump() {
	defer func() {
		c.Close()
	}()

	c.Conn.SetReadLimit(1024 * 1024)
	c.Conn.SetPongHandler(func(string) error {
		c.LastPong = time.Now()
		return nil
	})

	for {
		select {
		case <-c.CloseChan:
			return
		default:
			_, message, err := c.Conn.ReadMessage()
			if err != nil {
				if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
					log.Printf("WebSocket read error for user %s: %v", c.UserID, err)
				}
				return
			}

			var msg models.WrapperMessage
			if err := json.Unmarshal(message, &msg); err != nil {
				log.Printf("Failed to unmarshal message from user %s: %v", c.UserID, err)
				continue
			}

			if msg.Type == models.MsgTypeHeartbeat {
				c.LastPong = time.Now()
				continue
			}

			c.ReadChan <- message
		}
	}
}

func (c *Connection) WritePump() {
	ticker := time.NewTicker(models.HeartbeatInterval)
	defer func() {
		ticker.Stop()
		c.Close()
	}()

	for {
		select {
		case <-c.CloseChan:
			return
		case message, ok := <-c.Send:
			if !ok {
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			if err := c.Conn.WriteMessage(websocket.TextMessage, message); err != nil {
				log.Printf("WebSocket write error for user %s: %v", c.UserID, err)
				return
			}
		case <-ticker.C:
			heartbeatMsg, _ := json.Marshal(models.WrapperMessage{
				Type: models.MsgTypeHeartbeat,
				Data: time.Now().Unix(),
			})
			if err := c.Conn.WriteMessage(websocket.TextMessage, heartbeatMsg); err != nil {
				log.Printf("Heartbeat send error for user %s: %v", c.UserID, err)
				return
			}
		}
	}
}

func (c *Connection) SendMessage(msg interface{}) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	select {
	case c.Send <- data:
		return nil
	case <-c.CloseChan:
		return nil
	}
}

func (c *Connection) IsAlive() bool {
	select {
	case <-c.CloseChan:
		return false
	default:
		return time.Since(c.LastPong) < models.HeartbeatTimeout
	}
}

func (c *Connection) Close() {
	c.Once.Do(func() {
		close(c.CloseChan)
		close(c.Send)
		c.Conn.Close()
		log.Printf("Connection closed for user %s", c.UserID)
	})
}
