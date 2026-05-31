package api

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"canvas-signal/internal/auth"
	"canvas-signal/internal/models"
	"canvas-signal/internal/room"
	"canvas-signal/internal/store"
	"canvas-signal/internal/ws"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type Handler struct {
	roomManager       *room.RoomManager
	keyManager        *auth.KeyManager
	connectionManager *ws.ConnectionManager
	store             *store.Store
}

func NewHandler(roomManager *room.RoomManager, keyManager *auth.KeyManager, connectionManager *ws.ConnectionManager, store *store.Store) *Handler {
	return &Handler{
		roomManager:       roomManager,
		keyManager:        keyManager,
		connectionManager: connectionManager,
		store:             store,
	}
}

type CreateRoomRequest struct {
	RoomName string `json:"room_name" binding:"required"`
	UserID   string `json:"user_id"`
	UserName string `json:"user_name" binding:"required"`
}

type CreateRoomResponse struct {
	RoomID  string `json:"room_id"`
	Token   string `json:"token"`
	OwnerID string `json:"owner_id"`
}

func (h *Handler) CreateRoom(c *gin.Context) {
	var req CreateRoomRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	roomID := uuid.New().String()
	if req.UserID == "" {
		req.UserID = uuid.New().String()
	}

	_, err := h.roomManager.CreateRoom(roomID, req.RoomName, req.UserID)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}

	token, err := h.keyManager.GenerateToken(req.UserID, req.UserName, roomID, true)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate token"})
		return
	}

	c.JSON(http.StatusOK, CreateRoomResponse{
		RoomID:  roomID,
		Token:   token,
		OwnerID: req.UserID,
	})
}

type JoinRoomRequest struct {
	UserName string `json:"user_name" binding:"required"`
}

type JoinRoomResponse struct {
	Token  string `json:"token"`
	UserID string `json:"user_id"`
}

func (h *Handler) JoinRoom(c *gin.Context) {
	roomID := c.Param("room_id")
	if roomID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "room_id required"})
		return
	}

	if _, exists := h.roomManager.GetRoom(roomID); !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "room not found"})
		return
	}

	var req JoinRoomRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID := uuid.New().String()
	token, err := h.keyManager.GenerateToken(userID, req.UserName, roomID, false)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate token"})
		return
	}

	c.JSON(http.StatusOK, JoinRoomResponse{
		Token:  token,
		UserID: userID,
	})
}

type RoomInfoResponse struct {
	RoomID       string      `json:"room_id"`
	RoomName     string      `json:"room_name"`
	OnlineCount  int         `json:"online_count"`
	Users        interface{} `json:"users,omitempty"`
	Locked       bool        `json:"locked"`
	LockOwner    string      `json:"lock_owner,omitempty"`
	LockedAt     string      `json:"locked_at,omitempty"`
	LockDuration string      `json:"lock_duration,omitempty"`
	LockExpires  string      `json:"lock_expires,omitempty"`
}

func (h *Handler) GetRoomInfo(c *gin.Context) {
	roomID := c.Param("room_id")
	if roomID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "room_id required"})
		return
	}

	room, exists := h.roomManager.GetRoom(roomID)
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "room not found"})
		return
	}

	count, err := h.roomManager.GetOnlineCount(roomID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	locked, lockOwner, lockedAt, err := h.roomManager.GetLockInfo(roomID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	resp := RoomInfoResponse{
		RoomID:      room.ID,
		RoomName:    room.Name,
		OnlineCount: count,
		Locked:      locked,
		LockOwner:   lockOwner,
	}

	if locked && !lockedAt.IsZero() {
		resp.LockedAt = lockedAt.Format(time.RFC3339)
		duration := time.Since(lockedAt)
		expiresAt := lockedAt.Add(models.LockTimeout)
		resp.LockDuration = duration.Round(time.Second).String()
		resp.LockExpires = expiresAt.Format(time.RFC3339)
	}

	c.JSON(http.StatusOK, resp)
}

type KickUserRequest struct {
	TargetUserID string `json:"target_user_id" binding:"required"`
	Signature    string `json:"signature" binding:"required"`
}

func (h *Handler) KickUser(c *gin.Context) {
	roomID := c.Param("room_id")
	if roomID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "room_id required"})
		return
	}

	var req KickUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

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

	claims, err := h.keyManager.ValidateToken(token)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
		return
	}

	if !claims.IsOwner {
		c.JSON(http.StatusForbidden, gin.H{"error": "only room owner can kick users"})
		return
	}

	ownerID, err := h.roomManager.GetOwnerID(roomID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	if ownerID != claims.UserID {
		c.JSON(http.StatusForbidden, gin.H{"error": "you are not the room owner"})
		return
	}

	if !h.keyManager.VerifyOwnerSignature(roomID, req.TargetUserID, req.Signature) {
		c.JSON(http.StatusForbidden, gin.H{"error": "invalid signature"})
		return
	}

	if err := h.roomManager.KickUser(roomID, req.TargetUserID, claims.UserID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	h.connectionManager.KickUser(roomID, req.TargetUserID)

	c.JSON(http.StatusOK, gin.H{"message": "user kicked successfully"})
}

type HealthResponse struct {
	Status           string `json:"status"`
	ConnectionCount  int    `json:"connection_count"`
	RoomCount        int    `json:"room_count"`
	PublicKey        string `json:"public_key,omitempty"`
}

func (h *Handler) Health(c *gin.Context) {
	rooms := h.roomManager.GetRoomList()
	c.JSON(http.StatusOK, HealthResponse{
		Status:          "ok",
		ConnectionCount: h.connectionManager.GetConnectionCount(),
		RoomCount:       len(rooms),
		PublicKey:       h.keyManager.GetPublicKey(),
	})
}

func (h *Handler) GetPublicKey(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"public_key": h.keyManager.GetPublicKey(),
	})
}

type GenerateSignatureRequest struct {
	RoomID       string `json:"room_id" binding:"required"`
	TargetUserID string `json:"target_user_id" binding:"required"`
}

func (h *Handler) GenerateKickSignature(c *gin.Context) {
	var req GenerateSignatureRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

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

	claims, err := h.keyManager.ValidateToken(token)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
		return
	}

	if !claims.IsOwner {
		c.JSON(http.StatusForbidden, gin.H{"error": "only room owner can generate kick signature"})
		return
	}

	data := []byte("kick:" + req.RoomID + ":" + req.TargetUserID)
	signature := h.keyManager.Sign(data)

	c.JSON(http.StatusOK, gin.H{
		"signature": signature,
		"data":      string(data),
	})
}

func (h *Handler) GetLatestSnapshot(c *gin.Context) {
	roomID := c.Param("room_id")
	if roomID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "room_id required"})
		return
	}

	if _, exists := h.roomManager.GetRoom(roomID); !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "room not found"})
		return
	}

	snapshot, err := h.store.GetLatestSnapshot(roomID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	pendingOps := h.store.GetPendingOperations(roomID)

	c.JSON(http.StatusOK, gin.H{
		"snapshot":    snapshot,
		"pending_ops": pendingOps,
		"total_ops":   len(pendingOps),
	})
}

func (h *Handler) GetSnapshotHistory(c *gin.Context) {
	roomID := c.Param("room_id")
	if roomID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "room_id required"})
		return
	}

	if _, exists := h.roomManager.GetRoom(roomID); !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "room not found"})
		return
	}

	sinceMs := int64(0)
	if sinceStr := c.Query("since"); sinceStr != "" {
		if val, err := strconv.ParseInt(sinceStr, 10, 64); err == nil {
			sinceMs = val
		}
	}

	if sinceMs == 0 {
		sinceMs = time.Now().Add(-models.SnapshotRetention).UnixMilli()
	}

	snapshots, err := h.store.GetSnapshotsSince(roomID, sinceMs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"room_id":      roomID,
		"since":        sinceMs,
		"snapshot_count": len(snapshots),
		"snapshots":    snapshots,
	})
}

func (h *Handler) GetOperationHistory(c *gin.Context) {
	roomID := c.Param("room_id")
	if roomID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "room_id required"})
		return
	}

	if _, exists := h.roomManager.GetRoom(roomID); !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "room not found"})
		return
	}

	sinceMs := int64(0)
	if sinceStr := c.Query("since"); sinceStr != "" {
		if val, err := strconv.ParseInt(sinceStr, 10, 64); err == nil {
			sinceMs = val
		}
	}

	if sinceMs == 0 {
		sinceMs = time.Now().Add(-models.SnapshotRetention).UnixMilli()
	}

	operations, err := h.store.GetOperationsSince(roomID, sinceMs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"room_id":      roomID,
		"since":        sinceMs,
		"operation_count": len(operations),
		"operations":   operations,
	})
}

type RollbackByTimeRequest struct {
	Timestamp int64 `json:"timestamp" binding:"required"`
}

type RollbackBySnapshotRequest struct {
	SnapshotID string `json:"snapshot_id" binding:"required"`
}

func (h *Handler) RollbackByTime(c *gin.Context) {
	roomID := c.Param("room_id")
	if roomID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "room_id required"})
		return
	}

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

	claims, err := h.keyManager.ValidateToken(token)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
		return
	}

	if !claims.IsOwner {
		c.JSON(http.StatusForbidden, gin.H{"error": "only room owner can rollback"})
		return
	}

	ownerID, err := h.roomManager.GetOwnerID(roomID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	if ownerID != claims.UserID {
		c.JSON(http.StatusForbidden, gin.H{"error": "you are not the room owner"})
		return
	}

	var req RollbackByTimeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	snapshot, err := h.store.GetSnapshotAtTime(roomID, req.Timestamp)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if snapshot == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "no snapshot found for specified time"})
		return
	}

	rolledBack, err := h.store.RollbackToSnapshot(roomID, snapshot.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":      "rollback successful",
		"snapshot_id":  rolledBack.ID,
		"snapshot_ts":  rolledBack.Timestamp,
		"rollback_ts":  req.Timestamp,
		"state_hash":   rolledBack.Hash,
	})
}

func (h *Handler) RollbackBySnapshot(c *gin.Context) {
	roomID := c.Param("room_id")
	if roomID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "room_id required"})
		return
	}

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

	claims, err := h.keyManager.ValidateToken(token)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
		return
	}

	if !claims.IsOwner {
		c.JSON(http.StatusForbidden, gin.H{"error": "only room owner can rollback"})
		return
	}

	ownerID, err := h.roomManager.GetOwnerID(roomID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	if ownerID != claims.UserID {
		c.JSON(http.StatusForbidden, gin.H{"error": "you are not the room owner"})
		return
	}

	var req RollbackBySnapshotRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	rolledBack, err := h.store.RollbackToSnapshot(roomID, req.SnapshotID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":     "rollback successful",
		"snapshot_id": rolledBack.ID,
		"snapshot_ts": rolledBack.Timestamp,
		"state_hash":  rolledBack.Hash,
	})
}

func (h *Handler) GetCurrentState(c *gin.Context) {
	roomID := c.Param("room_id")
	if roomID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "room_id required"})
		return
	}

	if _, exists := h.roomManager.GetRoom(roomID); !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "room not found"})
		return
	}

	state := h.store.GetCurrentState(roomID)
	count := len(state)

	c.JSON(http.StatusOK, gin.H{
		"room_id":      roomID,
		"element_count": count,
		"state":        state,
		"timestamp":    time.Now().UnixMilli(),
	})
}
