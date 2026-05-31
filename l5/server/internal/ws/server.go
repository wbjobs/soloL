package ws

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"sync"
	"sync/atomic"

	"github.com/gorilla/websocket"
)

type Server struct {
	Hub        *Hub
	Router     *Router
	upgrader   websocket.Upgrader
	clientID   uint64
	started    bool
	mu         sync.Mutex
	options    *ServerOptions
}

type ServerOptions struct {
	ReadBufferSize    int
	WriteBufferSize   int
	CheckOrigin       func(r *http.Request) bool
	EnableCompression bool
}

func NewServer(options *ServerOptions) *Server {
	if options == nil {
		options = &ServerOptions{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin: func(r *http.Request) bool {
				return true
			},
			EnableCompression: false,
		}
	}

	s := &Server{
		Hub:     NewHub(),
		Router:  NewRouter(),
		options: options,
		upgrader: websocket.Upgrader{
			ReadBufferSize:    options.ReadBufferSize,
			WriteBufferSize:   options.WriteBufferSize,
			CheckOrigin:       options.CheckOrigin,
			EnableCompression: options.EnableCompression,
		},
	}

	return s
}

func (s *Server) Start() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.started {
		return errors.New("server already started")
	}

	s.started = true
	return nil
}

func (s *Server) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.started {
		return
	}

	s.started = false
	s.Hub.Close()
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !s.started {
		http.Error(w, "server not started", http.StatusServiceUnavailable)
		return
	}

	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	clientID := s.generateClientID()
	client := NewClient(clientID, conn, s.Hub, s.Router)

	s.Hub.Register(client)

	go client.WritePump()
	client.ReadPump()
}

func (s *Server) HandleFunc(msgType string, handler HandlerFunc) error {
	return s.Router.Register(msgType, handler)
}

func (s *Server) Broadcast(roomID string, msg *Message) error {
	return s.Hub.BroadcastToRoom(roomID, msg)
}

func (s *Server) SendToPlayer(playerID string, msg *Message) error {
	return s.Hub.SendToPlayer(playerID, msg)
}

func (s *Server) GetClientCount() int {
	return s.Hub.ClientCount()
}

func (s *Server) GetRoomCount() int {
	return s.Hub.RoomCount()
}

func (s *Server) generateClientID() string {
	id := atomic.AddUint64(&s.clientID, 1)
	randomBytes := make([]byte, 8)
	rand.Read(randomBytes)
	randomStr := hex.EncodeToString(randomBytes)
	return "client_" + randomStr + "_" + uint64ToString(id)
}

func uint64ToString(n uint64) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte(n%10) + '0'
		n /= 10
	}
	return string(buf[i:])
}
