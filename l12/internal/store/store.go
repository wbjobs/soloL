package store

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"canvas-signal/internal/models"

	"go.etcd.io/bbolt"
)

type Store struct {
	db          *bbolt.DB
	pendingOps  map[string][]*models.CanvasOperation
	pendingMu   sync.RWMutex
	currentState map[string]map[string]interface{}
	stateMu     sync.RWMutex
}

func NewStore(dbPath string) (*Store, error) {
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create db directory: %w", err)
	}

	db, err := bbolt.Open(dbPath, 0600, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to open bolt db: %w", err)
	}

	err = db.Update(func(tx *bbolt.Tx) error {
		if _, err := tx.CreateBucketIfNotExists([]byte(models.BucketSnapshots)); err != nil {
			return err
		}
		if _, err := tx.CreateBucketIfNotExists([]byte(models.BucketOperations)); err != nil {
			return err
		}
		if _, err := tx.CreateBucketIfNotExists([]byte(models.BucketRooms)); err != nil {
			return err
		}
		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("failed to create buckets: %w", err)
	}

	s := &Store{
		db:           db,
		pendingOps:   make(map[string][]*models.CanvasOperation),
		currentState: make(map[string]map[string]interface{}),
	}

	go s.startSnapshotCleaner()

	log.Printf("[STORE] BoltDB initialized at %s", dbPath)
	return s, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) AddOperation(roomID string, op *models.CanvasOperation) error {
	s.pendingMu.Lock()
	s.pendingOps[roomID] = append(s.pendingOps[roomID], op)
	s.pendingMu.Unlock()

	s.applyOperation(roomID, op)

	opKey := fmt.Sprintf("%s_%d_%s", roomID, op.Timestamp, op.ID)
	opData, err := json.Marshal(op)
	if err != nil {
		return fmt.Errorf("failed to marshal operation: %w", err)
	}

	err = s.db.Update(func(tx *bbolt.Tx) error {
		b := tx.Bucket([]byte(models.BucketOperations))
		return b.Put([]byte(opKey), opData)
	})

	if err != nil {
		return fmt.Errorf("failed to save operation: %w", err)
	}

	log.Printf("[STORE] Operation saved: room=%s op=%s user=%s patches=%d",
		roomID, op.ID, op.UserID, len(op.Patches))

	return nil
}

func (s *Store) applyOperation(roomID string, op *models.CanvasOperation) {
	s.stateMu.Lock()
	defer s.stateMu.Unlock()

	if _, exists := s.currentState[roomID]; !exists {
		s.currentState[roomID] = make(map[string]interface{})
	}

	state := s.currentState[roomID]
	for _, patch := range op.Patches {
		applyJSONPatch(state, patch)
	}
}

func applyJSONPatch(state map[string]interface{}, patch models.JSONPatchOperation) {
	switch patch.Op {
	case "add", "replace":
		state[patch.Path] = patch.Value
	case "remove":
		delete(state, patch.Path)
	}
}

func (s *Store) GetCurrentState(roomID string) map[string]interface{} {
	s.stateMu.RLock()
	defer s.stateMu.RUnlock()

	if state, exists := s.currentState[roomID]; exists {
		result := make(map[string]interface{})
		for k, v := range state {
			result[k] = v
		}
		return result
	}
	return make(map[string]interface{})
}

func (s *Store) TakeSnapshot(roomID string) (*models.CanvasSnapshot, error) {
	s.stateMu.RLock()
	state, exists := s.currentState[roomID]
	if !exists {
		state = make(map[string]interface{})
	}
	s.stateMu.RUnlock()

	s.pendingMu.RLock()
	opCount := len(s.pendingOps[roomID])
	s.pendingMu.RUnlock()

	stateCopy := make(map[string]interface{})
	for k, v := range state {
		stateCopy[k] = v
	}

	stateHash := computeStateHash(stateCopy)
	now := time.Now().UnixMilli()

	snapshot := &models.CanvasSnapshot{
		ID:             fmt.Sprintf("%s_%d", roomID, now),
		RoomID:         roomID,
		Timestamp:      now,
		State:          stateCopy,
		OperationCount: opCount,
		Hash:           stateHash,
	}

	snapshotData, err := json.Marshal(snapshot)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal snapshot: %w", err)
	}

	err = s.db.Update(func(tx *bbolt.Tx) error {
		b := tx.Bucket([]byte(models.BucketSnapshots))
		key := fmt.Sprintf("%s_%d", roomID, now)
		return b.Put([]byte(key), snapshotData)
	})

	if err != nil {
		return nil, fmt.Errorf("failed to save snapshot: %w", err)
	}

	s.pendingMu.Lock()
	s.pendingOps[roomID] = nil
	s.pendingMu.Unlock()

	log.Printf("[STORE] Snapshot taken: room=%s id=%s ops=%d hash=%s",
		roomID, snapshot.ID, opCount, stateHash[:16])

	return snapshot, nil
}

func computeStateHash(state map[string]interface{}) string {
	data, _ := json.Marshal(state)
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}

func (s *Store) GetLatestSnapshot(roomID string) (*models.CanvasSnapshot, error) {
	var snapshot *models.CanvasSnapshot

	err := s.db.View(func(tx *bbolt.Tx) error {
		b := tx.Bucket([]byte(models.BucketSnapshots))
		c := b.Cursor()

		prefix := []byte(roomID + "_")
		for k, v := c.Last(); k != nil; k, v = c.Prev() {
			if len(k) >= len(prefix) && string(k[:len(prefix)]) == string(prefix) {
				var snap models.CanvasSnapshot
				if err := json.Unmarshal(v, &snap); err != nil {
					return err
				}
				snapshot = &snap
				return nil
			}
		}
		return nil
	})

	return snapshot, err
}

func (s *Store) GetSnapshotsSince(roomID string, sinceMs int64) ([]*models.CanvasSnapshot, error) {
	var snapshots []*models.CanvasSnapshot

	err := s.db.View(func(tx *bbolt.Tx) error {
		b := tx.Bucket([]byte(models.BucketSnapshots))
		c := b.Cursor()

		prefix := []byte(roomID + "_")
		for k, v := c.Seek(prefix); k != nil && string(k[:len(prefix)]) == string(prefix); k, v = c.Next() {
			var snap models.CanvasSnapshot
			if err := json.Unmarshal(v, &snap); err != nil {
				continue
			}
			if snap.Timestamp >= sinceMs {
				snapshots = append(snapshots, &snap)
			}
		}
		return nil
	})

	return snapshots, err
}

func (s *Store) GetOperationsSince(roomID string, sinceMs int64) ([]*models.CanvasOperation, error) {
	var operations []*models.CanvasOperation

	err := s.db.View(func(tx *bbolt.Tx) error {
		b := tx.Bucket([]byte(models.BucketOperations))
		c := b.Cursor()

		prefix := []byte(fmt.Sprintf("%s_", roomID))
		for k, v := c.Seek(prefix); k != nil && string(k[:len(prefix)]) == string(prefix); k, v = c.Next() {
			var op models.CanvasOperation
			if err := json.Unmarshal(v, &op); err != nil {
				continue
			}
			if op.Timestamp >= sinceMs {
				operations = append(operations, &op)
			}
		}
		return nil
	})

	return operations, err
}

func (s *Store) GetSnapshotAtTime(roomID string, targetMs int64) (*models.CanvasSnapshot, error) {
	var snapshot *models.CanvasSnapshot

	err := s.db.View(func(tx *bbolt.Tx) error {
		b := tx.Bucket([]byte(models.BucketSnapshots))
		c := b.Cursor()

		prefix := []byte(roomID + "_")
		var closest *models.CanvasSnapshot
		for k, v := c.Seek(prefix); k != nil && string(k[:len(prefix)]) == string(prefix); k, v = c.Next() {
			var snap models.CanvasSnapshot
			if err := json.Unmarshal(v, &snap); err != nil {
				continue
			}
			if snap.Timestamp <= targetMs {
				closest = &snap
			} else {
				break
			}
		}
		snapshot = closest
		return nil
	})

	return snapshot, err
}

func (s *Store) RollbackToSnapshot(roomID string, snapshotID string) (*models.CanvasSnapshot, error) {
	var targetSnapshot *models.CanvasSnapshot

	err := s.db.View(func(tx *bbolt.Tx) error {
		b := tx.Bucket([]byte(models.BucketSnapshots))
		v := b.Get([]byte(snapshotID))
		if v == nil {
			return fmt.Errorf("snapshot not found: %s", snapshotID)
		}
		var snap models.CanvasSnapshot
		if err := json.Unmarshal(v, &snap); err != nil {
			return err
		}
		targetSnapshot = &snap
		return nil
	})

	if err != nil {
		return nil, err
	}

	s.stateMu.Lock()
	s.currentState[roomID] = make(map[string]interface{})
	for k, v := range targetSnapshot.State {
		s.currentState[roomID][k] = v
	}
	s.stateMu.Unlock()

	s.pendingMu.Lock()
	s.pendingOps[roomID] = nil
	s.pendingMu.Unlock()

	log.Printf("[STORE] Rollback completed: room=%s snapshot=%s", roomID, snapshotID)

	return targetSnapshot, nil
}

func (s *Store) startSnapshotCleaner() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		s.cleanOldSnapshots()
	}
}

func (s *Store) cleanOldSnapshots() {
	cutoff := time.Now().Add(-models.SnapshotRetention).UnixMilli()
	var deleted int

	err := s.db.Update(func(tx *bbolt.Tx) error {
		b := tx.Bucket([]byte(models.BucketSnapshots))
		c := b.Cursor()

		var toDelete [][]byte
		for k, v := c.First(); k != nil; k, v = c.Next() {
			var snap models.CanvasSnapshot
			if err := json.Unmarshal(v, &snap); err != nil {
				continue
			}
			if snap.Timestamp < cutoff {
				toDelete = append(toDelete, append([]byte{}, k...))
			}
		}

		for _, k := range toDelete {
			if err := b.Delete(k); err != nil {
				return err
			}
			deleted++
		}
		return nil
	})

	if err != nil {
		log.Printf("[STORE] Snapshot cleanup error: %v", err)
	} else if deleted > 0 {
		log.Printf("[STORE] Cleaned %d old snapshots (retention: %v)", deleted, models.SnapshotRetention)
	}
}

func (s *Store) ClearRoomData(roomID string) {
	s.stateMu.Lock()
	delete(s.currentState, roomID)
	s.stateMu.Unlock()

	s.pendingMu.Lock()
	delete(s.pendingOps, roomID)
	s.pendingMu.Unlock()
}

func (s *Store) GetPendingOperations(roomID string) []*models.CanvasOperation {
	s.pendingMu.RLock()
	defer s.pendingMu.RUnlock()

	ops := s.pendingOps[roomID]
	result := make([]*models.CanvasOperation, len(ops))
	copy(result, ops)
	return result
}
