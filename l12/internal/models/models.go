package models

import "time"

type User struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	IsOwner  bool   `json:"is_owner"`
	RoomID   string `json:"room_id"`
	ClientID string `json:"client_id"`
}

type Room struct {
	ID         string
	OwnerID    string
	Name       string
	Users      map[string]*User
	Lock       bool
	LockOwner  string
	LockedAt   time.Time
	CreatedAt  time.Time
}

type ICEServer struct {
	URLs       string `json:"urls"`
	Username   string `json:"username,omitempty"`
	Credential string `json:"credential,omitempty"`
}

type ICECandidate struct {
	Candidate        string `json:"candidate"`
	SDPMid           string `json:"sdpMid"`
	SDPMLineIndex    int    `json:"sdpMLineIndex"`
	UsernameFragment string `json:"usernameFragment"`
}

type SessionDescription struct {
	Type string `json:"type"`
	SDP  string `json:"sdp"`
}

type SignalMessage struct {
	Type    string      `json:"type"`
	From    string      `json:"from"`
	To      string      `json:"to"`
	Payload interface{} `json:"payload"`
	RoomID  string      `json:"room_id"`
}

type WrapperMessage struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}

type JSONPatchOperation struct {
	Op    string      `json:"op"`
	Path  string      `json:"path"`
	Value interface{} `json:"value,omitempty"`
	From  string      `json:"from,omitempty"`
}

type CanvasOperation struct {
	ID        string              `json:"id"`
	UserID    string              `json:"user_id"`
	Timestamp int64               `json:"timestamp"`
	Patches   []JSONPatchOperation `json:"patches"`
	BaseState string              `json:"base_state,omitempty"`
}

type CanvasSnapshot struct {
	ID         string            `json:"id"`
	RoomID     string            `json:"room_id"`
	Timestamp  int64             `json:"timestamp"`
	State      map[string]interface{} `json:"state"`
	OperationCount int            `json:"operation_count"`
	Hash       string            `json:"hash"`
}

const (
	MsgTypeJoin         = "join"
	MsgTypeLeave        = "leave"
	MsgTypeOffer        = "offer"
	MsgTypeAnswer       = "answer"
	MsgTypeCandidate    = "candidate"
	MsgTypeHeartbeat    = "heartbeat"
	MsgTypeRoomLocked   = "room_locked"
	MsgTypeRoomUnlocked = "room_unlocked"
	MsgTypeUserJoined   = "user_joined"
	MsgTypeUserLeft     = "user_left"
	MsgTypeKicked       = "kicked"
	MsgTypeError        = "error"
	MsgTypeCanvasOp     = "canvas_op"
	MsgTypeCanvasSync   = "canvas_sync"
	MsgTypeCanvasRollback = "canvas_rollback"
)

const (
	WebSocketSubprotocol = "canvas-signal/1.0"
	HeartbeatInterval    = 30 * time.Second
	HeartbeatTimeout     = 90 * time.Second
	LockTimeout          = 5 * time.Minute
	SnapshotInterval     = 10 * time.Second
	SnapshotRetention    = 5 * time.Minute
)

const (
	BucketSnapshots = "snapshots"
	BucketOperations = "operations"
	BucketRooms    = "rooms"
)

