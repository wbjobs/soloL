package redis

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"

	"github.com/redis/go-redis/v9"
	"github.com/vmihailenco/msgpack/v5"
)

type MessageType string

const (
	MessageTypeRoomBroadcast MessageType = "room_broadcast"
	MessageTypePrivate       MessageType = "private"
	MessageTypeSystem        MessageType = "system"
)

type Message struct {
	Type      MessageType            `json:"type" msgpack:"type"`
	RoomID    string                 `json:"room_id,omitempty" msgpack:"room_id,omitempty"`
	PlayerID  string                 `json:"player_id,omitempty" msgpack:"player_id,omitempty"`
	Event     string                 `json:"event" msgpack:"event"`
	Payload   map[string]interface{} `json:"payload,omitempty" msgpack:"payload,omitempty"`
	Timestamp int64                  `json:"timestamp" msgpack:"timestamp"`
}

type MessageHandler func(ctx context.Context, msg *Message) error

type Subscription struct {
	roomID    string
	playerID  string
	ps        *redis.PubSub
	handlers  map[string]MessageHandler
	mu        sync.RWMutex
	ctx       context.Context
	cancel    context.CancelFunc
	client    *Client
}

func (c *Client) Publish(ctx context.Context, roomID string, msg *Message) error {
	if msg == nil {
		return fmt.Errorf("message cannot be nil")
	}

	data, err := msgpack.Marshal(msg)
	if err != nil {
		return fmt.Errorf("failed to marshal message: %w", err)
	}

	channel := BroadcastChannel(roomID)
	if err := c.rdb.Publish(ctx, channel, data).Err(); err != nil {
		return fmt.Errorf("failed to publish message: %w", err)
	}

	return nil
}

func (c *Client) PublishPrivate(ctx context.Context, playerID string, msg *Message) error {
	if msg == nil {
		return fmt.Errorf("message cannot be nil")
	}

	data, err := msgpack.Marshal(msg)
	if err != nil {
		return fmt.Errorf("failed to marshal private message: %w", err)
	}

	channel := PrivateChannel(playerID)
	if err := c.rdb.Publish(ctx, channel, data).Err(); err != nil {
		return fmt.Errorf("failed to publish private message: %w", err)
	}

	return nil
}

func (c *Client) Subscribe(ctx context.Context, roomID, playerID string) (*Subscription, error) {
	subCtx, cancel := context.WithCancel(ctx)

	channels := make([]string, 0, 2)
	if roomID != "" {
		channels = append(channels, BroadcastChannel(roomID))
	}
	if playerID != "" {
		channels = append(channels, PrivateChannel(playerID))
	}

	if len(channels) == 0 {
		cancel()
		return nil, fmt.Errorf("at least one of roomID or playerID must be provided")
	}

	ps := c.rdb.Subscribe(subCtx, channels...)

	if _, err := ps.Receive(subCtx); err != nil {
		cancel()
		return nil, fmt.Errorf("failed to subscribe to channels: %w", err)
	}

	sub := &Subscription{
		roomID:   roomID,
		playerID: playerID,
		ps:       ps,
		handlers: make(map[string]MessageHandler),
		ctx:      subCtx,
		cancel:   cancel,
		client:   c,
	}

	go sub.listen()

	return sub, nil
}

func (s *Subscription) On(event string, handler MessageHandler) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.handlers[event] = handler
}

func (s *Subscription) Off(event string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.handlers, event)
}

func (s *Subscription) Close() error {
	s.cancel()
	return s.ps.Close()
}

func (s *Subscription) listen() {
	ch := s.ps.Channel()

	for {
		select {
		case <-s.ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			s.handleMessage(msg)
		}
	}
}

func (s *Subscription) handleMessage(redisMsg *redis.Message) {
	var msg Message
	if err := msgpack.Unmarshal([]byte(redisMsg.Payload), &msg); err != nil {
		var jsonMsg Message
		if err := json.Unmarshal([]byte(redisMsg.Payload), &jsonMsg); err != nil {
			return
		}
		msg = jsonMsg
	}

	s.mu.RLock()
	handler, ok := s.handlers[msg.Event]
	s.mu.RUnlock()

	if !ok {
		s.mu.RLock()
		handler, ok = s.handlers["*"]
		s.mu.RUnlock()
		if !ok {
			return
		}
	}

	if handler != nil {
		if err := handler(s.ctx, &msg); err != nil {
		}
	}
}

func (s *Subscription) SubscribeRoom(roomID string) error {
	if roomID == "" {
		return fmt.Errorf("roomID cannot be empty")
	}

	channel := BroadcastChannel(roomID)
	if err := s.ps.Subscribe(s.ctx, channel); err != nil {
		return fmt.Errorf("failed to subscribe to room %s: %w", roomID, err)
	}

	s.roomID = roomID
	return nil
}

func (s *Subscription) UnsubscribeRoom(roomID string) error {
	if roomID == "" {
		return fmt.Errorf("roomID cannot be empty")
	}

	channel := BroadcastChannel(roomID)
	if err := s.ps.Unsubscribe(s.ctx, channel); err != nil {
		return fmt.Errorf("failed to unsubscribe from room %s: %w", roomID, err)
	}

	return nil
}

func ParseChannel(channel string) (string, string, error) {
	parts := strings.SplitN(channel, ":", 4)
	if len(parts) < 4 {
		return "", "", fmt.Errorf("invalid channel format: %s", channel)
	}

	channelType := parts[2]
	id := parts[3]

	return channelType, id, nil
}
