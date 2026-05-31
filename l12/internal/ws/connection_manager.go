package ws

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"canvas-signal/internal/auth"
	"canvas-signal/internal/models"
	"canvas-signal/internal/room"
	"canvas-signal/internal/store"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
	Subprotocols: []string{models.WebSocketSubprotocol},
}

type PeerConnectionMap struct {
	usernameFragment string
	userID           string
	roomID           string
	createdAt        time.Time
}

type ConnectionManager struct {
	connections       map[string]*Connection
	peerConnections   map[string]*PeerConnectionMap
	roomManager       *room.RoomManager
	keyManager        *auth.KeyManager
	store             *store.Store
	mu                sync.RWMutex
}

func NewConnectionManager(roomManager *room.RoomManager, keyManager *auth.KeyManager, store *store.Store) *ConnectionManager {
	cm := &ConnectionManager{
		connections:     make(map[string]*Connection),
		peerConnections: make(map[string]*PeerConnectionMap),
		roomManager:     roomManager,
		keyManager:      keyManager,
		store:           store,
	}

	go cm.startZombieCleaner()
	go cm.startLockCleaner()
	go cm.startSnapshotTaker()
	return cm
}

func generateConnID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func (cm *ConnectionManager) HandleWebSocket(c *gin.Context) {
	token := c.Query("token")
	if token == "" {
		authHeader := c.GetHeader("Authorization")
		if strings.HasPrefix(authHeader, "Bearer ") {
			token = strings.TrimPrefix(authHeader, "Bearer ")
		}
	}

	if token == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "token required"})
		return
	}

	claims, err := cm.keyManager.ValidateToken(token)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
		return
	}

	roomID := c.Param("room_id")
	if roomID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "room_id required"})
		return
	}

	if _, exists := cm.roomManager.GetRoom(roomID); !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "room not found"})
		return
	}

	subprotocol := c.GetHeader("Sec-WebSocket-Protocol")
	if !strings.Contains(subprotocol, models.WebSocketSubprotocol) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid subprotocol, required: " + models.WebSocketSubprotocol})
		return
	}

	conn, err := upgrader.Upgrade(c.Writer, c.Request, http.Header{
		"Sec-WebSocket-Protocol": {models.WebSocketSubprotocol},
	})
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	connID := generateConnID()
	clientID := connID

	_, user, err := cm.roomManager.JoinRoom(roomID, claims.UserID, claims.UserName, clientID)
	if err != nil {
		conn.Close()
		log.Printf("Join room error: %v", err)
		return
	}

	connection := NewConnection(connID, claims.UserID, roomID, conn)

	cm.mu.Lock()
	cm.connections[connID] = connection
	cm.mu.Unlock()

	log.Printf("User %s joined room %s with connection %s", claims.UserID, roomID, connID)

	cm.broadcastUserJoined(roomID, user)

	go connection.ReadPump()
	go connection.WritePump()
	go cm.handleMessages(connection)
	go cm.sendCanvasSync(connection)
}

func (cm *ConnectionManager) handleMessages(conn *Connection) {
	defer func() {
		cm.cleanupConnection(conn)
	}()

	for {
		select {
		case <-conn.CloseChan:
			return
		case msg, ok := <-conn.ReadChan:
			if !ok {
				return
			}
			cm.processMessage(conn, msg)
		}
	}
}

func (cm *ConnectionManager) processMessage(conn *Connection, rawMsg []byte) {
	var msg models.SignalMessage
	if err := parseMessage(rawMsg, &msg); err != nil {
		log.Printf("Failed to parse message: %v", err)
		sendError(conn, "invalid message format")
		return
	}

	msg.From = conn.UserID
	msg.RoomID = conn.RoomID

	switch msg.Type {
	case models.MsgTypeOffer, models.MsgTypeAnswer:
		cm.registerSDPUfrag(conn, &msg)
		cm.forwardSignal(conn, &msg)
	case models.MsgTypeCandidate:
		cm.forwardSignal(conn, &msg)
	case models.MsgTypeLeave:
		cm.handleLeave(conn)
	case models.MsgTypeRoomLocked:
		cm.handleLockRoom(conn)
	case models.MsgTypeRoomUnlocked:
		cm.handleUnlockRoom(conn)
	case models.MsgTypeCanvasOp:
		cm.handleCanvasOperation(conn, &msg)
	default:
		log.Printf("Unknown message type: %s", msg.Type)
		sendError(conn, "unknown message type")
	}
}

func (cm *ConnectionManager) handleCanvasOperation(conn *Connection, msg *models.SignalMessage) {
	opData, err := json.Marshal(msg.Payload)
	if err != nil {
		log.Printf("[CANVAS] Failed to marshal operation: %v", err)
		sendError(conn, "invalid operation format")
		return
	}

	var op models.CanvasOperation
	if err := json.Unmarshal(opData, &op); err != nil {
		log.Printf("[CANVAS] Failed to parse operation: %v", err)
		sendError(conn, "invalid operation format")
		return
	}

	op.ID = uuid.New().String()
	op.UserID = conn.UserID
	op.Timestamp = time.Now().UnixMilli()

	if err := cm.store.AddOperation(conn.RoomID, &op); err != nil {
		log.Printf("[CANVAS] Failed to save operation: %v", err)
		sendError(conn, "failed to save operation")
		return
	}

	cm.broadcastCanvasOperation(conn.RoomID, conn.UserID, &op)

	log.Printf("[CANVAS] Operation: room=%s user=%s op=%s patches=%d",
		conn.RoomID, conn.UserID, op.ID, len(op.Patches))
}

func (cm *ConnectionManager) broadcastCanvasOperation(roomID, excludeUserID string, op *models.CanvasOperation) {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	wrapper := models.WrapperMessage{
		Type: models.MsgTypeCanvasOp,
		Data: op,
	}

	for _, conn := range cm.connections {
		if conn.RoomID == roomID && conn.UserID != excludeUserID {
			conn.SendMessage(wrapper)
		}
	}
}

func (cm *ConnectionManager) sendCanvasSync(conn *Connection) {
	snapshot, err := cm.store.GetLatestSnapshot(conn.RoomID)
	if err != nil {
		log.Printf("[CANVAS_SYNC] Failed to get snapshot: %v", err)
		return
	}

	pendingOps := cm.store.GetPendingOperations(conn.RoomID)

	syncData := gin.H{
		"snapshot":       snapshot,
		"pending_ops":    pendingOps,
		"current_state":  cm.store.GetCurrentState(conn.RoomID),
		"sync_timestamp": time.Now().UnixMilli(),
	}

	wrapper := models.WrapperMessage{
		Type: models.MsgTypeCanvasSync,
		Data: syncData,
	}

	if err := conn.SendMessage(wrapper); err != nil {
		log.Printf("[CANVAS_SYNC] Failed to send sync to %s: %v", conn.UserID, err)
	}

	if snapshot != nil {
		log.Printf("[CANVAS_SYNC] Sent to %s: snapshot=%s pending_ops=%d",
			conn.UserID, snapshot.ID, len(pendingOps))
	} else {
		log.Printf("[CANVAS_SYNC] Sent to %s: no snapshot, pending_ops=%d",
			conn.UserID, len(pendingOps))
	}
}

func (cm *ConnectionManager) startSnapshotTaker() {
	ticker := time.NewTicker(models.SnapshotInterval)
	defer ticker.Stop()

	for range ticker.C {
		cm.takeSnapshotsForActiveRooms()
	}
}

func (cm *ConnectionManager) takeSnapshotsForActiveRooms() {
	rooms := cm.roomManager.GetRoomList()
	for _, room := range rooms {
		pendingOps := cm.store.GetPendingOperations(room.ID)
		if len(pendingOps) > 0 {
			_, err := cm.store.TakeSnapshot(room.ID)
			if err != nil {
				log.Printf("[SNAPSHOT] Failed for room %s: %v", room.ID, err)
			}
		}
	}
}

func (cm *ConnectionManager) forwardSignal(conn *Connection, msg *models.SignalMessage) {
	if msg.To == "" {
		sendError(conn, "recipient (to) required")
		return
	}

	log.Printf("[SIGNAL] type=%s from=%s to=%s room=%s", msg.Type, conn.UserID, msg.To, conn.RoomID)

	unlocked, owner, err := cm.roomManager.ForceUnlockIfExpired(conn.RoomID)
	if err != nil {
		log.Printf("[SIGNAL] Lock check error for room %s: %v", conn.RoomID, err)
	} else if unlocked {
		log.Printf("[SIGNAL] Room %s lock expired, auto-unlocked (was held by %s)", conn.RoomID, owner)
		cm.broadcastRoomLockStatus(conn.RoomID, false, "")
	}

	locked, lockOwner, err := cm.roomManager.IsRoomLocked(conn.RoomID)
	if err != nil {
		sendError(conn, err.Error())
		return
	}

	if locked && lockOwner != conn.UserID && lockOwner != msg.To {
		log.Printf("[SIGNAL] BLOCKED: room %s locked by %s, signal from %s to %s rejected",
			conn.RoomID, lockOwner, conn.UserID, msg.To)
		sendError(conn, "room is locked, signaling restricted")
		return
	}

	if msg.Type == models.MsgTypeCandidate {
		if err := cm.validateAndRegisterCandidate(conn, msg); err != nil {
			log.Printf("[SIGNAL] Candidate validation failed: from=%s to=%s room=%s error=%v",
				conn.UserID, msg.To, conn.RoomID, err)
			sendError(conn, err.Error())
			return
		}
	}

	cm.mu.RLock()
	defer cm.mu.RUnlock()

	var targetConn *Connection
	for _, c := range cm.connections {
		if c.RoomID == conn.RoomID && c.UserID == msg.To {
			targetConn = c
			break
		}
	}

	if targetConn == nil {
		log.Printf("[SIGNAL] FAILED: recipient %s not found in room %s (signal from %s)",
			msg.To, conn.RoomID, conn.UserID)
		sendError(conn, "recipient not found")
		return
	}

	wrapper := models.WrapperMessage{
		Type: msg.Type,
		Data: msg,
	}

	if err := targetConn.SendMessage(wrapper); err != nil {
		log.Printf("[SIGNAL] FAILED: send to %s (conn=%s) error: %v",
			msg.To, targetConn.ID, err)
	} else {
		log.Printf("[SIGNAL] SUCCESS: forwarded %s from %s to %s (conn=%s) in room %s",
			msg.Type, conn.UserID, msg.To, targetConn.ID, conn.RoomID)
	}
}

func (cm *ConnectionManager) handleLeave(conn *Connection) {
	conn.Close()
}

func (cm *ConnectionManager) handleLockRoom(conn *Connection) {
	if err := cm.roomManager.LockRoom(conn.RoomID, conn.UserID); err != nil {
		log.Printf("[ROOM_LOCK] Failed: user=%s room=%s error=%v", conn.UserID, conn.RoomID, err)
		sendError(conn, err.Error())
		return
	}

	log.Printf("[ROOM_LOCK] ACQUIRED: user=%s room=%s (timeout=%v)", conn.UserID, conn.RoomID, models.LockTimeout)
	cm.broadcastRoomLockStatus(conn.RoomID, true, conn.UserID)
}

func (cm *ConnectionManager) handleUnlockRoom(conn *Connection) {
	locked, lockOwner, lockedAt, _ := cm.roomManager.GetLockInfo(conn.RoomID)
	if locked && lockOwner == conn.UserID && !lockedAt.IsZero() {
		heldFor := time.Since(lockedAt).Round(time.Second)
		log.Printf("[ROOM_LOCK] RELEASED: user=%s room=%s (held for %v)", conn.UserID, conn.RoomID, heldFor)
	}

	if err := cm.roomManager.UnlockRoom(conn.RoomID, conn.UserID); err != nil {
		log.Printf("[ROOM_LOCK] Unlock failed: user=%s room=%s error=%v", conn.UserID, conn.RoomID, err)
		sendError(conn, err.Error())
		return
	}

	cm.broadcastRoomLockStatus(conn.RoomID, false, "")
}

func (cm *ConnectionManager) broadcastUserJoined(roomID string, user *models.User) {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	msg := models.WrapperMessage{
		Type: models.MsgTypeUserJoined,
		Data: user,
	}

	for _, conn := range cm.connections {
		if conn.RoomID == roomID && conn.UserID != user.ID {
			conn.SendMessage(msg)
		}
	}
}

func (cm *ConnectionManager) broadcastUserLeft(roomID, userID string) {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	msg := models.WrapperMessage{
		Type: models.MsgTypeUserLeft,
		Data: gin.H{"user_id": userID},
	}

	for _, conn := range cm.connections {
		if conn.RoomID == roomID {
			conn.SendMessage(msg)
		}
	}
}

func (cm *ConnectionManager) broadcastRoomLockStatus(roomID string, locked bool, lockOwner string) {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	msgType := models.MsgTypeRoomUnlocked
	if locked {
		msgType = models.MsgTypeRoomLocked
	}

	msg := models.WrapperMessage{
		Type: msgType,
		Data: gin.H{
			"locked":     locked,
			"lock_owner": lockOwner,
		},
	}

	for _, conn := range cm.connections {
		if conn.RoomID == roomID {
			conn.SendMessage(msg)
		}
	}
}

func (cm *ConnectionManager) cleanupConnection(conn *Connection) {
	cm.mu.Lock()
	delete(cm.connections, conn.ID)
	cm.mu.Unlock()

	cm.cleanupPeerConnections(conn.UserID, conn.RoomID)

	if err := cm.roomManager.LeaveRoom(conn.RoomID, conn.UserID); err != nil {
		log.Printf("Leave room error: %v", err)
	}

	cm.broadcastUserLeft(conn.RoomID, conn.UserID)
	log.Printf("User %s left room %s", conn.UserID, conn.RoomID)
}

func (cm *ConnectionManager) KickUser(roomID, userID string) error {
	cm.mu.RLock()
	var targetConn *Connection
	for _, conn := range cm.connections {
		if conn.RoomID == roomID && conn.UserID == userID {
			targetConn = conn
			break
		}
	}
	cm.mu.RUnlock()

	cm.cleanupPeerConnections(userID, roomID)

	if targetConn != nil {
		kickMsg := models.WrapperMessage{
			Type: models.MsgTypeKicked,
			Data: gin.H{"reason": "kicked by owner"},
		}
		targetConn.SendMessage(kickMsg)
		log.Printf("[KICK] User %s kicked from room %s by owner", userID, roomID)
		go targetConn.Close()
		return nil
	}

	log.Printf("[KICK] User %s not connected, removing from room %s state", userID, roomID)
	return cm.roomManager.KickUser(roomID, userID, "")
}

func (cm *ConnectionManager) GetConnectionCount() int {
	cm.mu.RLock()
	defer cm.mu.RUnlock()
	return len(cm.connections)
}

func (cm *ConnectionManager) startZombieCleaner() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		cm.cleanZombies()
	}
}

func (cm *ConnectionManager) cleanZombies() {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	var zombies []*Connection
	for _, conn := range cm.connections {
		if !conn.IsAlive() {
			zombies = append(zombies, conn)
		}
	}

	for _, conn := range zombies {
		log.Printf("Cleaning zombie connection for user %s", conn.UserID)
		delete(cm.connections, conn.ID)
		go func(c *Connection) {
			cm.roomManager.LeaveRoom(c.RoomID, c.UserID)
			cm.broadcastUserLeft(c.RoomID, c.UserID)
			c.Close()
		}(conn)
	}

	if len(zombies) > 0 {
		log.Printf("Cleaned %d zombie connections", len(zombies))
	}
}

func parseMessage(data []byte, v interface{}) error {
	return json.Unmarshal(data, v)
}

func sendError(conn *Connection, errMsg string) {
	msg := models.WrapperMessage{
		Type: models.MsgTypeError,
		Data: gin.H{"message": errMsg},
	}
	conn.SendMessage(msg)
}

func (cm *ConnectionManager) startLockCleaner() {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		cm.cleanExpiredLocks()
	}
}

func (cm *ConnectionManager) cleanExpiredLocks() {
	rooms := cm.roomManager.GetRoomList()
	for _, room := range rooms {
		if !room.Lock {
			continue
		}

		unlocked, owner, err := cm.roomManager.ForceUnlockIfExpired(room.ID)
		if err != nil {
			log.Printf("[LOCK_CLEANUP] Error checking room %s: %v", room.ID, err)
			continue
		}

		if unlocked {
			log.Printf("[LOCK_CLEANUP] Room %s lock expired (held by %s), auto-unlocked", room.ID, owner)
			cm.broadcastRoomLockStatus(room.ID, false, "")
		}
	}
}

func (cm *ConnectionManager) validateAndRegisterCandidate(conn *Connection, msg *models.SignalMessage) error {
	candidate, ok := msg.Payload.(map[string]interface{})
	if !ok {
		return fmt.Errorf("invalid candidate payload format")
	}

	ufrag, _ := candidate["usernameFragment"].(string)
	if ufrag == "" {
		log.Printf("[CANDIDATE] WARN: No usernameFragment in candidate from %s to %s, allowing without validation",
			conn.UserID, msg.To)
		return nil
	}

	log.Printf("[CANDIDATE] Validating: from=%s to=%s ufrag=%s room=%s",
		conn.UserID, msg.To, ufrag, conn.RoomID)

	cm.mu.RLock()
	pc, exists := cm.peerConnections[ufrag]
	cm.mu.RUnlock()

	if exists {
		if pc.roomID != conn.RoomID {
			return fmt.Errorf("usernameFragment %s belongs to different room %s", ufrag, pc.roomID)
		}

		if pc.userID != conn.UserID && pc.userID != msg.To {
			log.Printf("[CANDIDATE] CROSS-USER BLOCKED: ufrag=%s registered to user=%s, but candidate from=%s to=%s",
				ufrag, pc.userID, conn.UserID, msg.To)
			return fmt.Errorf("usernameFragment %s does not match sender or recipient", ufrag)
		}

		log.Printf("[CANDIDATE] VALID: ufrag=%s registered to user=%s (from=%s to=%s)",
			ufrag, pc.userID, conn.UserID, msg.To)
	} else {
		log.Printf("[CANDIDATE] REGISTER: ufrag=%s from=%s room=%s",
			ufrag, conn.UserID, conn.RoomID)

		cm.mu.Lock()
		cm.peerConnections[ufrag] = &PeerConnectionMap{
			usernameFragment: ufrag,
			userID:           conn.UserID,
			roomID:           conn.RoomID,
			createdAt:        time.Now(),
		}
		cm.mu.Unlock()
	}

	return nil
}

func extractSDPUfrag(sdp string) string {
	lines := strings.Split(sdp, "\r\n")
	for _, line := range lines {
		if strings.HasPrefix(line, "a=ice-ufrag:") {
			return strings.TrimPrefix(line, "a=ice-ufrag:")
		}
	}
	return ""
}

func (cm *ConnectionManager) registerSDPUfrag(conn *Connection, msg *models.SignalMessage) {
	sdpObj, ok := msg.Payload.(map[string]interface{})
	if !ok {
		return
	}

	sdp, _ := sdpObj["sdp"].(string)
	if sdp == "" {
		return
	}

	ufrag := extractSDPUfrag(sdp)
	if ufrag == "" {
		return
	}

	cm.mu.Lock()
	defer cm.mu.Unlock()

	if _, exists := cm.peerConnections[ufrag]; !exists {
		cm.peerConnections[ufrag] = &PeerConnectionMap{
			usernameFragment: ufrag,
			userID:           conn.UserID,
			roomID:           conn.RoomID,
			createdAt:        time.Now(),
		}
		log.Printf("[SDP] Registered ufrag=%s for user=%s room=%s (from %s)",
			ufrag, conn.UserID, conn.RoomID, msg.Type)
	} else {
		existing := cm.peerConnections[ufrag]
		if existing.userID != conn.UserID || existing.roomID != conn.RoomID {
			log.Printf("[SDP] CONFLICT: ufrag=%s already registered to user=%s room=%s, but new from user=%s room=%s",
				ufrag, existing.userID, existing.roomID, conn.UserID, conn.RoomID)
		}
	}
}

func (cm *ConnectionManager) cleanupPeerConnections(userID, roomID string) {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	var removed []string
	for ufrag, pc := range cm.peerConnections {
		if pc.userID == userID && pc.roomID == roomID {
			removed = append(removed, ufrag)
			delete(cm.peerConnections, ufrag)
		}
	}

	if len(removed) > 0 {
		log.Printf("[PEER_CLEANUP] Removed %d peer connections for user=%s room=%s: %v",
			len(removed), userID, roomID, removed)
	}
}
