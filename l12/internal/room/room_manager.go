package room

import (
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"canvas-signal/internal/models"
)

type RoomManager struct {
	rooms map[string]*models.Room
	mu    sync.RWMutex
}

func NewRoomManager() *RoomManager {
	return &RoomManager{
		rooms: make(map[string]*models.Room),
	}
}

func (rm *RoomManager) CreateRoom(roomID, roomName, ownerID string) (*models.Room, error) {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	if _, exists := rm.rooms[roomID]; exists {
		return nil, fmt.Errorf("room %s already exists", roomID)
	}

	room := &models.Room{
		ID:        roomID,
		Name:      roomName,
		OwnerID:   ownerID,
		Users:     make(map[string]*models.User),
		Lock:      false,
		LockOwner: "",
		CreatedAt: time.Now(),
	}

	rm.rooms[roomID] = room
	return room, nil
}

func (rm *RoomManager) GetRoom(roomID string) (*models.Room, bool) {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	room, exists := rm.rooms[roomID]
	return room, exists
}

func (rm *RoomManager) JoinRoom(roomID, userID, userName, clientID string) (*models.Room, *models.User, error) {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	room, exists := rm.rooms[roomID]
	if !exists {
		return nil, nil, fmt.Errorf("room %s does not exist", roomID)
	}

	isOwner := userID == room.OwnerID

	user := &models.User{
		ID:       userID,
		Name:     userName,
		IsOwner:  isOwner,
		RoomID:   roomID,
		ClientID: clientID,
	}

	room.Users[userID] = user
	return room, user, nil
}

func (rm *RoomManager) LeaveRoom(roomID, userID string) error {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	room, exists := rm.rooms[roomID]
	if !exists {
		return fmt.Errorf("room %s does not exist", roomID)
	}

	if _, exists := room.Users[userID]; !exists {
		return fmt.Errorf("user %s not in room %s", userID, roomID)
	}

	delete(room.Users, userID)

	if len(room.Users) == 0 {
		delete(rm.rooms, roomID)
		return nil
	}

	if room.OwnerID == userID {
		for _, u := range room.Users {
			room.OwnerID = u.ID
			u.IsOwner = true
			break
		}
	}

	if room.Lock && room.LockOwner == userID {
		room.Lock = false
		room.LockOwner = ""
	}

	return nil
}

func (rm *RoomManager) LockRoom(roomID, userID string) error {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	room, exists := rm.rooms[roomID]
	if !exists {
		return fmt.Errorf("room %s does not exist", roomID)
	}

	if _, userExists := room.Users[userID]; !userExists {
		return fmt.Errorf("user %s not in room %s", userID, roomID)
	}

	if room.Lock {
		if room.LockOwner == userID {
			room.LockedAt = time.Now()
			return nil
		}
		return errors.New("room is already locked by another user")
	}

	room.Lock = true
	room.LockOwner = userID
	room.LockedAt = time.Now()
	return nil
}

func (rm *RoomManager) UnlockRoom(roomID, userID string) error {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	room, exists := rm.rooms[roomID]
	if !exists {
		return fmt.Errorf("room %s does not exist", roomID)
	}

	if !room.Lock {
		return nil
	}

	if room.LockOwner != userID {
		return errors.New("only the lock owner can unlock the room")
	}

	room.Lock = false
	room.LockOwner = ""
	return nil
}

func (rm *RoomManager) IsRoomLocked(roomID string) (bool, string, error) {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	room, exists := rm.rooms[roomID]
	if !exists {
		return false, "", fmt.Errorf("room %s does not exist", roomID)
	}

	return room.Lock, room.LockOwner, nil
}

func (rm *RoomManager) GetOnlineCount(roomID string) (int, error) {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	room, exists := rm.rooms[roomID]
	if !exists {
		return 0, fmt.Errorf("room %s does not exist", roomID)
	}

	return len(room.Users), nil
}

func (rm *RoomManager) GetUsers(roomID string) (map[string]*models.User, error) {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	room, exists := rm.rooms[roomID]
	if !exists {
		return nil, fmt.Errorf("room %s does not exist", roomID)
	}

	users := make(map[string]*models.User)
	for k, v := range room.Users {
		users[k] = v
	}
	return users, nil
}

func (rm *RoomManager) KickUser(roomID, targetUserID, ownerID string) error {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	room, exists := rm.rooms[roomID]
	if !exists {
		return fmt.Errorf("room %s does not exist", roomID)
	}

	if room.OwnerID != ownerID {
		return errors.New("only room owner can kick users")
	}

	if targetUserID == ownerID {
		return errors.New("cannot kick yourself")
	}

	if _, exists := room.Users[targetUserID]; !exists {
		return fmt.Errorf("user %s not in room %s", targetUserID, roomID)
	}

	delete(room.Users, targetUserID)

	if room.Lock && room.LockOwner == targetUserID {
		room.Lock = false
		room.LockOwner = ""
	}

	return nil
}

func (rm *RoomManager) GetOwnerID(roomID string) (string, error) {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	room, exists := rm.rooms[roomID]
	if !exists {
		return "", fmt.Errorf("room %s does not exist", roomID)
	}

	return room.OwnerID, nil
}

func (rm *RoomManager) GetRoomList() []*models.Room {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	rooms := make([]*models.Room, 0, len(rm.rooms))
	for _, room := range rm.rooms {
		rooms = append(rooms, room)
	}
	return rooms
}

func (rm *RoomManager) IsLockExpired(roomID string) (bool, error) {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	room, exists := rm.rooms[roomID]
	if !exists {
		return false, fmt.Errorf("room %s does not exist", roomID)
	}

	if !room.Lock {
		return false, nil
	}

	return time.Since(room.LockedAt) > models.LockTimeout, nil
}

func (rm *RoomManager) ForceUnlockIfExpired(roomID string) (bool, string, error) {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	room, exists := rm.rooms[roomID]
	if !exists {
		return false, "", fmt.Errorf("room %s does not exist", roomID)
	}

	if !room.Lock {
		return false, "", nil
	}

	if time.Since(room.LockedAt) <= models.LockTimeout {
		return false, room.LockOwner, nil
	}

	lockOwner := room.LockOwner
	room.Lock = false
	room.LockOwner = ""
	room.LockedAt = time.Time{}

	log.Printf("Force unlocked room %s, lock expired for user %s (held for %v)",
		roomID, lockOwner, time.Since(room.LockedAt))

	return true, lockOwner, nil
}

func (rm *RoomManager) GetLockInfo(roomID string) (bool, string, time.Time, error) {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	room, exists := rm.rooms[roomID]
	if !exists {
		return false, "", time.Time{}, fmt.Errorf("room %s does not exist", roomID)
	}

	return room.Lock, room.LockOwner, room.LockedAt, nil
}

func (rm *RoomManager) CleanupExpiredLocks() []string {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	var unlockedRooms []string

	for roomID, room := range rm.rooms {
		if room.Lock && time.Since(room.LockedAt) > models.LockTimeout {
			lockOwner := room.LockOwner
			room.Lock = false
			room.LockOwner = ""
			room.LockedAt = time.Time{}
			unlockedRooms = append(unlockedRooms, roomID)

			log.Printf("Cleanup: Force unlocked room %s, lock expired for user %s",
				roomID, lockOwner)
		}
	}

	return unlockedRooms
}
