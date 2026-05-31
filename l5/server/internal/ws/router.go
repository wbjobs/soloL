package ws

import (
	"context"
	"encoding/json"
	"errors"
	"sync"

	"github.com/vmihailenco/msgpack/v5"
)

type HandlerFunc func(ctx context.Context, client *Client, data []byte) error

type Router struct {
	handlers map[string]HandlerFunc
	mu       sync.RWMutex
}

func NewRouter() *Router {
	return &Router{
		handlers: make(map[string]HandlerFunc),
	}
}

func (r *Router) Register(msgType string, handler HandlerFunc) error {
	if msgType == "" {
		return errors.New("message type is empty")
	}
	if handler == nil {
		return errors.New("handler is nil")
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.handlers[msgType]; ok {
		return errors.New("handler already registered for type: " + msgType)
	}

	r.handlers[msgType] = handler
	return nil
}

func (r *Router) Unregister(msgType string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.handlers, msgType)
}

func (r *Router) HasHandler(msgType string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	_, ok := r.handlers[msgType]
	return ok
}

func (r *Router) Route(ctx context.Context, client *Client, msgType string, rawData []byte) error {
	if msgType == "" {
		return errors.New("message type is empty")
	}
	if client == nil {
		return errors.New("client is nil")
	}

	r.mu.RLock()
	handler, ok := r.handlers[msgType]
	r.mu.RUnlock()

	if !ok {
		return errors.New("no handler registered for type: " + msgType)
	}

	return handler(ctx, client, rawData)
}

func ParseMessage(data []byte) (*Message, error) {
	var msg Message
	if err := json.Unmarshal(data, &msg); err != nil {
		if err := msgpack.Unmarshal(data, &msg); err != nil {
			return nil, err
		}
	}
	return &msg, nil
}

func ParseMessageData(data []byte, v interface{}) error {
	var msg Message
	if err := json.Unmarshal(data, &msg); err != nil {
		return err
	}

	dataBytes, ok := msg.Data.(json.RawMessage)
	if !ok {
		dataBytes, err := json.Marshal(msg.Data)
		if err != nil {
			return err
		}
		return json.Unmarshal(dataBytes, v)
	}

	return json.Unmarshal(dataBytes, v)
}

func ParseMessageDataMsgPack(data []byte, v interface{}) error {
	var msg Message
	if err := msgpack.Unmarshal(data, &msg); err != nil {
		return err
	}

	dataBytes, err := msgpack.Marshal(msg.Data)
	if err != nil {
		return err
	}

	return msgpack.Unmarshal(dataBytes, v)
}
