package handler

import (
	"log"
	"net/http"
	"sync"
	"vct-gi-system/middleware"
	"vct-gi-system/models"
	"vct-gi-system/repository"
	"vct-gi-system/service"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

type WebSocketMessage struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}

type Client struct {
	ID     uuid.UUID
	UserID uuid.UUID
	Conn   *websocket.Conn
	Send   chan WebSocketMessage
}

type WebSocketHandler struct {
	upgrader   websocket.Upgrader
	clients    map[uuid.UUID]*Client
	sceneRooms map[uuid.UUID]map[uuid.UUID]*Client
	mu         sync.RWMutex
	lightRepo  *repository.LightRepository
	sceneRepo  *repository.SceneRepository
	voxelRepo  *repository.VoxelRepository
}

func NewWebSocketHandler() *WebSocketHandler {
	return &WebSocketHandler{
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin: func(r *http.Request) bool {
				return true
			},
		},
		clients:    make(map[uuid.UUID]*Client),
		sceneRooms: make(map[uuid.UUID]map[uuid.UUID]*Client),
		lightRepo:  repository.NewLightRepository(),
		sceneRepo:  repository.NewSceneRepository(),
		voxelRepo:  repository.NewVoxelRepository(),
	}
}

func (h *WebSocketHandler) HandleConnection(c *gin.Context) {
	userID, exists := middleware.GetUserID(c)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	sceneIDParam := c.Param("scene_id")
	sceneID, err := uuid.Parse(sceneIDParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid scene ID"})
		return
	}

	owned, err := h.sceneRepo.OwnedByUser(sceneID, userID)
	if err != nil || !owned {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	conn, err := h.upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("Failed to upgrade websocket connection: %v", err)
		return
	}

	clientID := uuid.New()
	client := &Client{
		ID:     clientID,
		UserID: userID,
		Conn:   conn,
		Send:   make(chan WebSocketMessage, 256),
	}

	h.registerClient(client, sceneID)

	go h.handleClientMessages(client, sceneID)
	go h.sendClientMessages(client)

	log.Printf("Client %s connected to scene %s", clientID, sceneID)

	h.broadcastToScene(sceneID, WebSocketMessage{
		Type: "client_connected",
		Payload: gin.H{
			"client_id": clientID,
			"user_id":   userID,
		},
	})
}

func (h *WebSocketHandler) registerClient(client *Client, sceneID uuid.UUID) {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.clients[client.ID] = client

	if h.sceneRooms[sceneID] == nil {
		h.sceneRooms[sceneID] = make(map[uuid.UUID]*Client)
	}
	h.sceneRooms[sceneID][client.ID] = client
}

func (h *WebSocketHandler) unregisterClient(client *Client, sceneID uuid.UUID) {
	h.mu.Lock()
	defer h.mu.Unlock()

	delete(h.clients, client.ID)
	if h.sceneRooms[sceneID] != nil {
		delete(h.sceneRooms[sceneID], client.ID)
	}

	close(client.Send)
}

func (h *WebSocketHandler) handleClientMessages(client *Client, sceneID uuid.UUID) {
	defer func() {
		h.unregisterClient(client, sceneID)
		client.Conn.Close()
	}()

	for {
		var msg WebSocketMessage
		err := client.Conn.ReadJSON(&msg)
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error: %v", err)
			}
			break
		}

		h.handleMessage(client, sceneID, msg)
	}
}

func (h *WebSocketHandler) handleMessage(client *Client, sceneID uuid.UUID, msg WebSocketMessage) {
	switch msg.Type {
	case "light_update":
		h.handleLightUpdate(client, sceneID, msg.Payload)
	case "light_toggle":
		h.handleLightToggle(client, sceneID, msg.Payload)
	case "voxel_update":
		h.handleVoxelUpdate(client, sceneID, msg.Payload)
	case "camera_position":
		h.broadcastToScene(sceneID, WebSocketMessage{
			Type: "camera_position",
			Payload: gin.H{
				"client_id": client.ID,
				"position":  msg.Payload,
			},
		})
	case "ping":
		client.Send <- WebSocketMessage{
			Type:    "pong",
			Payload: gin.H{"timestamp": msg.Payload},
		}
	default:
		log.Printf("Unknown message type: %s", msg.Type)
	}
}

func (h *WebSocketHandler) handleLightUpdate(client *Client, sceneID uuid.UUID, payload interface{}) {
	payloadMap, ok := payload.(map[string]interface{})
	if !ok {
		return
	}

	lightIDStr, ok := payloadMap["id"].(string)
	if !ok {
		return
	}

	lightID, err := uuid.Parse(lightIDStr)
	if err != nil {
		return
	}

	belongs, err := h.lightRepo.BelongsToScene(lightID, sceneID)
	if err != nil || !belongs {
		return
	}

	light, err := h.lightRepo.GetByID(lightID)
	if err != nil {
		return
	}

	if position, ok := payloadMap["position"]; ok {
		light.Position = toJSON(position)
	}
	if color, ok := payloadMap["color"]; ok {
		light.Color = toJSON(color)
	}
	if intensity, ok := payloadMap["intensity"].(float64); ok {
		light.Intensity = intensity
	}
	if enabled, ok := payloadMap["enabled"].(bool); ok {
		light.Enabled = enabled
	}

	if err := h.lightRepo.Update(light); err != nil {
		return
	}

	h.broadcastToScene(sceneID, WebSocketMessage{
		Type:    "light_updated",
		Payload: light,
	})
}

func (h *WebSocketHandler) handleLightToggle(client *Client, sceneID uuid.UUID, payload interface{}) {
	payloadMap, ok := payload.(map[string]interface{})
	if !ok {
		return
	}

	lightIDStr, ok := payloadMap["id"].(string)
	if !ok {
		return
	}

	lightID, err := uuid.Parse(lightIDStr)
	if err != nil {
		return
	}

	belongs, err := h.lightRepo.BelongsToScene(lightID, sceneID)
	if err != nil || !belongs {
		return
	}

	light, err := h.lightRepo.ToggleEnabled(lightID)
	if err != nil {
		return
	}

	h.broadcastToScene(sceneID, WebSocketMessage{
		Type:    "light_toggled",
		Payload: light,
	})
}

func (h *WebSocketHandler) handleVoxelUpdate(client *Client, sceneID uuid.UUID, payload interface{}) {
	payloadMap, ok := payload.(map[string]interface{})
	if !ok {
		return
	}

	gridIDStr, ok := payloadMap["voxel_grid_id"].(string)
	if !ok {
		return
	}

	gridID, err := uuid.Parse(gridIDStr)
	if err != nil {
		return
	}

	grid, err := h.voxelRepo.GetGridByID(gridID)
	if err != nil || grid.SceneID != sceneID {
		return
	}

	h.broadcastToScene(sceneID, WebSocketMessage{
		Type:    "voxel_updated",
		Payload: payloadMap,
	})
}

func (h *WebSocketHandler) sendClientMessages(client *Client) {
	defer client.Conn.Close()

	for msg := range client.Send {
		err := client.Conn.WriteJSON(msg)
		if err != nil {
			log.Printf("Failed to send message to client %s: %v", client.ID, err)
			break
		}
	}
}

func (h *WebSocketHandler) broadcastToScene(sceneID uuid.UUID, msg interface{}) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	room, exists := h.sceneRooms[sceneID]
	if !exists {
		return
	}

	var wsMsg WebSocketMessage
	switch m := msg.(type) {
	case WebSocketMessage:
		wsMsg = m
	case service.WebSocketMessage:
		wsMsg = WebSocketMessage{
			Type:    m.Type,
			Payload: m.Payload,
		}
	default:
		return
	}

	for _, client := range room {
		select {
		case client.Send <- wsMsg:
		default:
			close(client.Send)
			delete(room, client.ID)
		}
	}
}

func (h *WebSocketHandler) BroadcastLightUpdate(sceneID uuid.UUID, light *models.Light) {
	h.broadcastToScene(sceneID, WebSocketMessage{
		Type:    "light_updated",
		Payload: light,
	})
}

func (h *WebSocketHandler) BroadcastVoxelUpdate(sceneID uuid.UUID, data interface{}) {
	h.broadcastToScene(sceneID, WebSocketMessage{
		Type:    "voxel_updated",
		Payload: data,
	})
}

func (h *WebSocketHandler) BroadcastBakeProgress(sceneID uuid.UUID, progress int, status string) {
	h.broadcastToScene(sceneID, WebSocketMessage{
		Type: "bake_progress",
		Payload: gin.H{
			"progress": progress,
			"status":   status,
		},
	})
}

func (h *WebSocketHandler) BroadcastToScene(sceneID uuid.UUID, msg interface{}) {
	h.broadcastToScene(sceneID, msg)
}
