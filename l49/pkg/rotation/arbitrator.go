package rotation

import (
	"context"
	"crypto-proxy/pkg/crypto"
	"crypto-proxy/pkg/etcd"
	"crypto-proxy/pkg/raft"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"sync"
	"time"
)

type RotationStatus int

const (
	StatusIdle RotationStatus = iota
	StatusInProgress
	StatusCompleted
	StatusFailed
)

type RotationPhase int

const (
	PhaseInit RotationPhase = iota
	PhaseKeyGeneration
	PhaseDistribution
	PhaseMetadataUpdate
	PhaseDataRewrap
	PhaseCleanup
	PhaseComplete
)

type RotationRequest struct {
	RequestID     string
	InitiatorID   string
	RequestedAt   int64
	NewKeyID      string
	NewKeyBytes   []byte
	TargetColumns []string
	Force         bool
}

type RotationState struct {
	RequestID    string
	Status       RotationStatus
	Phase        RotationPhase
	CurrentKey   int
	NewKey       int
	Progress     float64
	StartedAt    int64
	CompletedAt  int64
	Error        string
	ParticipantNodes map[string]bool
}

type KeyRotationArbitrator struct {
	mu            sync.Mutex
	raftNode      *raft.RaftNode
	metadataStore *etcd.MetadataStore
	cryptoEngine  *crypto.RC4Engine
	metadataMgr   *crypto.MetadataManager
	nodeID        string
	currentState  *RotationState
	rotationCh    chan RotationRequest
	stopCh        chan struct{}
	autoRotate    bool
	rotateInterval time.Duration
	keyTTL        time.Duration
}

func NewKeyRotationArbitrator(
	nodeID string,
	raftNode *raft.RaftNode,
	metadataStore *etcd.MetadataStore,
	cryptoEngine *crypto.RC4Engine,
	metadataMgr *crypto.MetadataManager,
	autoRotate bool,
	keyTTL time.Duration,
) *KeyRotationArbitrator {
	return &KeyRotationArbitrator{
		raftNode:       raftNode,
		metadataStore:  metadataStore,
		cryptoEngine:   cryptoEngine,
		metadataMgr:    metadataMgr,
		nodeID:         nodeID,
		rotationCh:     make(chan RotationRequest, 10),
		stopCh:         make(chan struct{}),
		autoRotate:     autoRotate,
		rotateInterval: time.Hour,
		keyTTL:         keyTTL,
		currentState: &RotationState{
			Status:            StatusIdle,
			ParticipantNodes:  make(map[string]bool),
		},
	}
}

func (a *KeyRotationArbitrator) Start() {
	go a.run()
	if a.autoRotate {
		go a.autoRotateCheck()
	}
}

func (a *KeyRotationArbitrator) Stop() {
	close(a.stopCh)
}

func (a *KeyRotationArbitrator) run() {
	for {
		select {
		case <-a.stopCh:
			return
		case req := <-a.rotationCh:
			a.handleRotationRequest(req)
		}
	}
}

func (a *KeyRotationArbitrator) autoRotateCheck() {
	ticker := time.NewTicker(a.rotateInterval)
	defer ticker.Stop()

	for {
		select {
		case <-a.stopCh:
			return
		case <-ticker.C:
			if a.shouldRotate() {
				req := RotationRequest{
					RequestID:   GenerateRequestID(),
					InitiatorID: a.nodeID,
					RequestedAt: time.Now().Unix(),
					Force:       false,
				}
				a.rotationCh <- req
			}
		}
	}
}

func (a *KeyRotationArbitrator) shouldRotate() bool {
	if !a.raftNode.IsLeader() {
		return false
	}

	keys := a.cryptoEngine.GetActiveVersions()
	if len(keys) == 0 {
		return false
	}

	latestVersion := a.cryptoEngine.GetLatestVersion()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	key, err := a.metadataStore.GetKey(ctx, latestVersion)
	if err != nil {
		return false
	}

	keyAge := time.Since(time.Unix(key.CreatedAt, 0))
	return keyAge > a.keyTTL
}

func (a *KeyRotationArbitrator) RequestRotation(req RotationRequest) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	if a.currentState.Status == StatusInProgress && !req.Force {
		return errors.New("rotation already in progress")
	}

	if !a.raftNode.IsLeader() {
		return errors.New("only leader can initiate rotation")
	}

	if req.RequestID == "" {
		req.RequestID = GenerateRequestID()
	}

	req.InitiatorID = a.nodeID
	req.RequestedAt = time.Now().Unix()

	a.rotationCh <- req
	return nil
}

func (a *KeyRotationArbitrator) handleRotationRequest(req RotationRequest) {
	a.mu.Lock()
	if a.currentState.Status == StatusInProgress && !req.Force {
		a.mu.Unlock()
		return
	}

	a.currentState = &RotationState{
		RequestID:        req.RequestID,
		Status:           StatusInProgress,
		Phase:            PhaseInit,
		CurrentKey:       a.cryptoEngine.GetLatestVersion(),
		StartedAt:        time.Now().Unix(),
		ParticipantNodes: make(map[string]bool),
	}
	a.currentState.ParticipantNodes[a.nodeID] = true
	a.mu.Unlock()

	ctx := context.Background()

	defer func() {
		a.mu.Lock()
		if r := recover(); r != nil {
			a.currentState.Status = StatusFailed
			a.currentState.Error = fmt.Sprintf("panic: %v", r)
		}
		a.mu.Unlock()
	}()

	if err := a.executeRotation(ctx, req); err != nil {
		a.mu.Lock()
		a.currentState.Status = StatusFailed
		a.currentState.Error = err.Error()
		a.mu.Unlock()
		return
	}

	a.mu.Lock()
	a.currentState.Status = StatusCompleted
	a.currentState.Phase = PhaseComplete
	a.currentState.CompletedAt = time.Now().Unix()
	a.currentState.Progress = 100.0
	a.mu.Unlock()

	a.metadataStore.SaveRotationStatus(ctx, false, 0)
}

func (a *KeyRotationArbitrator) executeRotation(ctx context.Context, req RotationRequest) error {
	a.updatePhase(PhaseKeyGeneration, 10.0)

	var newKeyID string
	var newKeyBytes []byte
	var newVersion int

	if req.NewKeyID != "" && len(req.NewKeyBytes) > 0 {
		newKeyID = req.NewKeyID
		newKeyBytes = req.NewKeyBytes
	} else {
		var err error
		newKeyID, newKeyBytes, err = GenerateNewKey()
		if err != nil {
			return fmt.Errorf("key generation failed: %w", err)
		}
	}

	a.updatePhase(PhaseDistribution, 30.0)

	newVersion, err := a.cryptoEngine.RotateKey(newKeyID, newKeyBytes)
	if err != nil {
		return fmt.Errorf("key rotation failed: %w", err)
	}

	newKey := &crypto.RC4Key{
		ID:        newKeyID,
		Version:   newVersion,
		KeyBytes:  newKeyBytes,
		CreatedAt: time.Now().Unix(),
		Active:    true,
	}
	if err := a.metadataStore.SaveKey(ctx, newKey); err != nil {
		return fmt.Errorf("failed to save new key: %w", err)
	}

	a.mu.Lock()
	a.currentState.NewKey = newVersion
	a.mu.Unlock()

	a.updatePhase(PhaseMetadataUpdate, 50.0)
	if err := a.updateMetadataToNewKey(ctx, newVersion); err != nil {
		return fmt.Errorf("metadata update failed: %w", err)
	}

	a.updatePhase(PhaseDataRewrap, 75.0)
	if err := a.triggerDataRewrap(ctx); err != nil {
		return fmt.Errorf("data rewrap failed: %w", err)
	}

	a.updatePhase(PhaseCleanup, 90.0)
	if err := a.cleanupOldKeys(ctx); err != nil {
		return fmt.Errorf("cleanup failed: %w", err)
	}

	a.updatePhase(PhaseComplete, 100.0)
	return nil
}

func (a *KeyRotationArbitrator) updateMetadataToNewKey(ctx context.Context, newVersion int) error {
	columns := a.metadataMgr.GetAllColumns()
	for _, col := range columns {
		if col.Enabled {
			col.KeyVersion = newVersion
			col.UpdatedAt = time.Now().Unix()
			
			if err := a.metadataStore.SaveColumnConfig(ctx, col); err != nil {
				return err
			}
			
			a.metadataMgr.UpdateKeyVersion(col.TableSchema, col.TableName, col.ColumnName, newVersion)
		}
	}
	return nil
}

func (a *KeyRotationArbitrator) triggerDataRewrap(ctx context.Context) error {
	return nil
}

func (a *KeyRotationArbitrator) cleanupOldKeys(ctx context.Context) error {
	activeVersions := a.cryptoEngine.GetActiveVersions()
	if len(activeVersions) <= 3 {
		return nil
	}

	var oldestVersion int = activeVersions[0]
	for _, v := range activeVersions {
		if v < oldestVersion {
			oldestVersion = v
		}
	}

	if a.cryptoEngine.RemoveKey(oldestVersion) {
		a.metadataStore.DeleteKey(ctx, oldestVersion)
	}

	return nil
}

func (a *KeyRotationArbitrator) updatePhase(phase RotationPhase, progress float64) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.currentState.Phase = phase
	a.currentState.Progress = progress
}

func (a *KeyRotationArbitrator) GetStatus() *RotationState {
	a.mu.Lock()
	defer a.mu.Unlock()
	return &RotationState{
		RequestID:   a.currentState.RequestID,
		Status:      a.currentState.Status,
		Phase:       a.currentState.Phase,
		CurrentKey:  a.currentState.CurrentKey,
		NewKey:      a.currentState.NewKey,
		Progress:    a.currentState.Progress,
		StartedAt:   a.currentState.StartedAt,
		CompletedAt: a.currentState.CompletedAt,
		Error:       a.currentState.Error,
	}
}

func (a *KeyRotationArbitrator) IsRotationInProgress() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.currentState.Status == StatusInProgress
}

func (a *KeyRotationArbitrator) ForceRotate() (string, error) {
	req := RotationRequest{
		RequestID:   GenerateRequestID(),
		InitiatorID: a.nodeID,
		RequestedAt: time.Now().Unix(),
		Force:       true,
	}
	
	err := a.RequestRotation(req)
	if err != nil {
		return "", err
	}
	
	return req.RequestID, nil
}

func GenerateRequestID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func GenerateNewKey() (string, []byte, error) {
	keyID := GenerateRequestID()
	keyBytes := make([]byte, 32)
	_, err := rand.Read(keyBytes)
	if err != nil {
		return "", nil, err
	}
	return keyID, keyBytes, nil
}

func (s RotationStatus) String() string {
	switch s {
	case StatusIdle:
		return "Idle"
	case StatusInProgress:
		return "InProgress"
	case StatusCompleted:
		return "Completed"
	case StatusFailed:
		return "Failed"
	default:
		return fmt.Sprintf("Unknown(%d)", s)
	}
}

func (p RotationPhase) String() string {
	switch p {
	case PhaseInit:
		return "Initialization"
	case PhaseKeyGeneration:
		return "KeyGeneration"
	case PhaseDistribution:
		return "KeyDistribution"
	case PhaseMetadataUpdate:
		return "MetadataUpdate"
	case PhaseDataRewrap:
		return "DataRewrap"
	case PhaseCleanup:
		return "Cleanup"
	case PhaseComplete:
		return "Complete"
	default:
		return fmt.Sprintf("Unknown(%d)", p)
	}
}
