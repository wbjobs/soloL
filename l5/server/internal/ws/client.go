package ws

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/vmihailenco/msgpack/v5"
)

const (
	heartbeatTimeout = 5 * time.Second
	writeWait        = 10 * time.Second
	pongWait         = 5 * time.Second
	pingPeriod       = (pongWait * 9) / 10
	maxMessageSize   = 1024 * 1024
)

type Message struct {
	Type string      `json:"type" msgpack:"type"`
	Data interface{} `json:"data" msgpack:"data"`
}

type Client struct {
	ID            string
	Conn          *websocket.Conn
	Send          chan []byte
	RoomID        string
	PlayerID      string
	LastHeartbeat time.Time
	Hub           *Hub
	Router        *Router
	mu            sync.RWMutex
	ctx           context.Context
	cancel        context.CancelFunc
}

func NewClient(id string, conn *websocket.Conn, hub *Hub, router *Router) *Client {
	ctx, cancel := context.WithCancel(context.Background())
	return &Client{
		ID:            id,
		Conn:          conn,
		Send:          make(chan []byte, 256),
		LastHeartbeat: time.Now(),
		Hub:           hub,
		Router:        router,
		ctx:           ctx,
		cancel:        cancel,
	}
}

func (c *Client) SendMessage(msg *Message) error {
	data, err := msgpack.Marshal(msg)
	if err != nil {
		return err
	}
	select {
	case c.Send <- data:
		return nil
	case <-c.ctx.Done():
		return errors.New("client closed")
	default:
		return errors.New("send buffer full")
	}
}

func (c *Client) ReadPump() {
	defer func() {
		c.Hub.Unregister(c)
		c.cancel()
	}()

	c.Conn.SetReadLimit(maxMessageSize)
	c.Conn.SetReadDeadline(time.Now().Add(pongWait))
	c.Conn.SetPongHandler(func(string) error {
		c.mu.Lock()
		c.LastHeartbeat = time.Now()
		c.mu.Unlock()
		c.Conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		select {
		case <-c.ctx.Done():
			return
		default:
			_, data, err := c.Conn.ReadMessage()
			if err != nil {
				if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				}
				return
			}

			c.mu.Lock()
			c.LastHeartbeat = time.Now()
			c.mu.Unlock()

			var msg Message
			if err := json.Unmarshal(data, &msg); err != nil {
				c.SendError("invalid_message", "invalid message format")
				continue
			}

			if msg.Type == "heartbeat" {
				c.handleHeartbeat()
				continue
			}

			if err := c.Router.Route(c.ctx, c, msg.Type, data); err != nil {
				c.SendError("route_error", err.Error())
			}
		}
	}
}

func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()

	for {
		select {
		case <-c.ctx.Done():
			c.Conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
			return
		case message, ok := <-c.Send:
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.Conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
				return
			}

			if err := c.Conn.WriteMessage(websocket.BinaryMessage, message); err != nil {
				return
			}
		case <-ticker.C:
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}

			c.mu.RLock()
			lastHeartbeat := c.LastHeartbeat
			c.mu.RUnlock()

			if time.Since(lastHeartbeat) > heartbeatTimeout {
				return
			}
		}
	}
}

func (c *Client) handleHeartbeat() {
	c.mu.Lock()
	c.LastHeartbeat = time.Now()
	c.mu.Unlock()

	resp := &Message{
		Type: "heartbeat_ack",
		Data: map[string]interface{}{
			"timestamp": time.Now().Unix(),
		},
	}
	c.SendMessage(resp)
}

func (c *Client) SendError(code, message string) {
	errMsg := &Message{
		Type: "error",
		Data: map[string]interface{}{
			"code":    code,
			"message": message,
		},
	}
	c.SendMessage(errMsg)
}

func (c *Client) Close() {
	c.cancel()
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.Conn != nil {
		c.Conn.Close()
	}
}

func (c *Client) RemoteAddr() net.Addr {
	return c.Conn.RemoteAddr()
}
