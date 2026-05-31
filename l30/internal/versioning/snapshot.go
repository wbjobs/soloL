package versioning

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path"
	"sort"
	"strconv"
	"strings"
	"time"

	clientv3 "go.etcd.io/etcd/client/v3"
)

const (
	SnapshotPrefix = "/snapshots"
)

type Snapshot struct {
	Version   int       `json:"version"`
	Key       string    `json:"key"`
	Value     string    `json:"value"`
	Timestamp time.Time `json:"timestamp"`
	Operator  string    `json:"operator"`
	Action    string    `json:"action"`
	PrevValue string    `json:"prev_value,omitempty"`
}

type HistoryEntry struct {
	Version   int       `json:"version"`
	Timestamp time.Time `json:"timestamp"`
	Operator  string    `json:"operator"`
	Action    string    `json:"action"`
	Change    string    `json:"change"`
}

func GetCurrentOperator() string {
	op := os.Getenv("ETCD_CONFIG_OPERATOR")
	if op == "" {
		op = os.Getenv("USER")
	}
	if op == "" {
		op = os.Getenv("USERNAME")
	}
	if op == "" {
		op = "unknown"
	}
	return op
}

func SnapshotKeyPath(key string, version int) string {
	escapedKey := strings.ReplaceAll(key, "/", ":")
	return path.Join(SnapshotPrefix, escapedKey, strconv.Itoa(version))
}

func SnapshotKeyPrefix(key string) string {
	escapedKey := strings.ReplaceAll(key, "/", ":")
	return path.Join(SnapshotPrefix, escapedKey) + "/"
}

func GetNextVersion(ctx context.Context, kv clientv3.KV, key string) (int, error) {
	prefix := SnapshotKeyPrefix(key)
	resp, err := kv.Get(ctx, prefix, clientv3.WithPrefix(), clientv3.WithKeysOnly(), clientv3.WithSort(clientv3.SortByKey, clientv3.SortDescend), clientv3.WithLimit(1))
	if err != nil {
		return 0, fmt.Errorf("get latest version: %w", err)
	}

	if len(resp.Kvs) == 0 {
		return 1, nil
	}

	lastKey := string(resp.Kvs[0].Key)
	parts := strings.Split(lastKey, "/")
	if len(parts) == 0 {
		return 1, nil
	}

	lastVerStr := parts[len(parts)-1]
	lastVer, err := strconv.Atoi(lastVerStr)
	if err != nil {
		return 1, nil
	}

	return lastVer + 1, nil
}

func CreateSnapshot(ctx context.Context, kv clientv3.KV, key, value, prevValue string) (*Snapshot, error) {
	version, err := GetNextVersion(ctx, kv, key)
	if err != nil {
		return nil, err
	}

	snapshot := &Snapshot{
		Version:   version,
		Key:       key,
		Value:     value,
		Timestamp: time.Now(),
		Operator:  GetCurrentOperator(),
		Action:    "set",
		PrevValue: prevValue,
	}

	data, err := json.Marshal(snapshot)
	if err != nil {
		return nil, fmt.Errorf("marshal snapshot: %w", err)
	}

	snapKey := SnapshotKeyPath(key, version)
	_, err = kv.Put(ctx, snapKey, string(data))
	if err != nil {
		return nil, fmt.Errorf("store snapshot: %w", err)
	}

	return snapshot, nil
}

func GetSnapshot(ctx context.Context, kv clientv3.KV, key string, version int) (*Snapshot, error) {
	snapKey := SnapshotKeyPath(key, version)
	resp, err := kv.Get(ctx, snapKey)
	if err != nil {
		return nil, fmt.Errorf("get snapshot: %w", err)
	}

	if len(resp.Kvs) == 0 {
		return nil, fmt.Errorf("snapshot not found for key %q version %d", key, version)
	}

	var snapshot Snapshot
	if err := json.Unmarshal(resp.Kvs[0].Value, &snapshot); err != nil {
		return nil, fmt.Errorf("unmarshal snapshot: %w", err)
	}

	return &snapshot, nil
}

func GetHistory(ctx context.Context, kv clientv3.KV, key string, limit int) ([]*HistoryEntry, error) {
	prefix := SnapshotKeyPrefix(key)
	opts := []clientv3.OpOption{
		clientv3.WithPrefix(),
		clientv3.WithSort(clientv3.SortByKey, clientv3.SortDescend),
	}
	if limit > 0 {
		opts = append(opts, clientv3.WithLimit(int64(limit)))
	}

	resp, err := kv.Get(ctx, prefix, opts...)
	if err != nil {
		return nil, fmt.Errorf("get history: %w", err)
	}

	entries := make([]*HistoryEntry, 0, len(resp.Kvs))
	for _, kv := range resp.Kvs {
		var snap Snapshot
		if err := json.Unmarshal(kv.Value, &snap); err != nil {
			continue
		}

		entry := &HistoryEntry{
			Version:   snap.Version,
			Timestamp: snap.Timestamp,
			Operator:  snap.Operator,
			Action:    snap.Action,
			Change:    formatChangeSummary(snap),
		}
		entries = append(entries, entry)
	}

	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Version > entries[j].Version
	})

	return entries, nil
}

func formatChangeSummary(snap Snapshot) string {
	if snap.PrevValue == "" {
		return fmt.Sprintf("created: %q", truncate(snap.Value, 30))
	}
	if snap.Value == "" {
		return fmt.Sprintf("deleted (was: %q)", truncate(snap.PrevValue, 30))
	}
	return fmt.Sprintf("%q -> %q", truncate(snap.PrevValue, 15), truncate(snap.Value, 15))
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}

func RollbackToVersion(ctx context.Context, kv clientv3.KV, key string, version int) (*Snapshot, error) {
	snapshot, err := GetSnapshot(ctx, kv, key, version)
	if err != nil {
		return nil, err
	}

	_, err = kv.Put(ctx, key, snapshot.Value)
	if err != nil {
		return nil, fmt.Errorf("rollback put: %w", err)
	}

	rollbackSnap, err := CreateSnapshot(ctx, kv, key, snapshot.Value, "rollback to v"+strconv.Itoa(version))
	if err != nil {
		return nil, fmt.Errorf("create rollback snapshot: %w", err)
	}
	rollbackSnap.Action = "rollback"

	return rollbackSnap, nil
}

func ListSnapshotKeys(ctx context.Context, kv clientv3.KV) ([]string, error) {
	resp, err := kv.Get(ctx, SnapshotPrefix, clientv3.WithPrefix(), clientv3.WithKeysOnly())
	if err != nil {
		return nil, fmt.Errorf("list snapshot keys: %w", err)
	}

	keySet := make(map[string]bool)
	for _, kv := range resp.Kvs {
		parts := strings.SplitN(string(kv.Key), "/", 4)
		if len(parts) >= 3 {
			escapedKey := parts[2]
			originalKey := strings.ReplaceAll(escapedKey, ":", "/")
			keySet[originalKey] = true
		}
	}

	keys := make([]string, 0, len(keySet))
	for k := range keySet {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	return keys, nil
}
