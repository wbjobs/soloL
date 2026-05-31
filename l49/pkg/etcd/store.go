package etcd

import (
	"context"
	"crypto-proxy/pkg/crypto"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"
)

type KeyData struct {
	ID        string `json:"id"`
	Version   int    `json:"version"`
	KeyBytes  []byte `json:"key_bytes"`
	CreatedAt int64  `json:"created_at"`
	Active    bool   `json:"active"`
}

type ColumnConfigData struct {
	TableSchema string `json:"table_schema"`
	TableName   string `json:"table_name"`
	ColumnName  string `json:"column_name"`
	ColumnType  byte   `json:"column_type"`
	Enabled     bool   `json:"enabled"`
	KeyVersion  int    `json:"key_version"`
	CreatedAt   int64  `json:"created_at"`
	UpdatedAt   int64  `json:"updated_at"`
}

type EtcdClient interface {
	Put(ctx context.Context, key, value string) error
	Get(ctx context.Context, key string) (string, error)
	GetPrefix(ctx context.Context, prefix string) (map[string]string, error)
	Delete(ctx context.Context, key string) error
	Watch(ctx context.Context, key string) chan WatchEvent
	Close() error
}

type WatchEvent struct {
	Type   string
	Key    string
	Value  string
}

type MockEtcdClient struct {
	mu     sync.RWMutex
	data   map[string]string
	watchers map[string][]chan WatchEvent
}

func NewMockEtcdClient() *MockEtcdClient {
	return &MockEtcdClient{
		data:     make(map[string]string),
		watchers: make(map[string][]chan WatchEvent),
	}
}

func (m *MockEtcdClient) Put(ctx context.Context, key, value string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.data[key] = value
	m.notifyWatchers(key, value, "PUT")
	return nil
}

func (m *MockEtcdClient) Get(ctx context.Context, key string) (string, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	value, exists := m.data[key]
	if !exists {
		return "", errors.New("key not found")
	}
	return value, nil
}

func (m *MockEtcdClient) GetPrefix(ctx context.Context, prefix string) (map[string]string, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	result := make(map[string]string)
	for k, v := range m.data {
		if len(k) >= len(prefix) && k[:len(prefix)] == prefix {
			result[k] = v
		}
	}
	return result, nil
}

func (m *MockEtcdClient) Delete(ctx context.Context, key string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.data, key)
	m.notifyWatchers(key, "", "DELETE")
	return nil
}

func (m *MockEtcdClient) Watch(ctx context.Context, key string) chan WatchEvent {
	m.mu.Lock()
	defer m.mu.Unlock()
	ch := make(chan WatchEvent, 10)
	m.watchers[key] = append(m.watchers[key], ch)
	return ch
}

func (m *MockEtcdClient) notifyWatchers(key, value, eventType string) {
	for k, watchers := range m.watchers {
		if len(key) >= len(k) && key[:len(k)] == k {
			for _, ch := range watchers {
				select {
				case ch <- WatchEvent{Type: eventType, Key: key, Value: value}:
				default:
				}
			}
		}
	}
}

func (m *MockEtcdClient) Close() error {
	return nil
}

type MetadataStore struct {
	client EtcdClient
	prefix string
}

func NewMetadataStore(client EtcdClient, prefix string) *MetadataStore {
	if prefix == "" {
		prefix = "/crypto-proxy/"
	}
	return &MetadataStore{
		client: client,
		prefix: prefix,
	}
}

func (s *MetadataStore) getKeyPath(subPath string) string {
	return s.prefix + subPath
}

func (s *MetadataStore) SaveKey(ctx context.Context, key *crypto.RC4Key) error {
	data := KeyData{
		ID:        key.ID,
		Version:   key.Version,
		KeyBytes:  key.KeyBytes,
		CreatedAt: key.CreatedAt,
		Active:    key.Active,
	}
	
	jsonData, err := json.Marshal(data)
	if err != nil {
		return err
	}
	
	keyPath := s.getKeyPath(fmt.Sprintf("keys/version-%d", key.Version))
	return s.client.Put(ctx, keyPath, string(jsonData))
}

func (s *MetadataStore) GetKey(ctx context.Context, version int) (*crypto.RC4Key, error) {
	keyPath := s.getKeyPath(fmt.Sprintf("keys/version-%d", version))
	data, err := s.client.Get(ctx, keyPath)
	if err != nil {
		return nil, err
	}
	
	var keyData KeyData
	if err := json.Unmarshal([]byte(data), &keyData); err != nil {
		return nil, err
	}
	
	return &crypto.RC4Key{
		ID:        keyData.ID,
		Version:   keyData.Version,
		KeyBytes:  keyData.KeyBytes,
		CreatedAt: keyData.CreatedAt,
		Active:    keyData.Active,
	}, nil
}

func (s *MetadataStore) GetAllKeys(ctx context.Context) ([]*crypto.RC4Key, error) {
	prefix := s.getKeyPath("keys/")
	dataMap, err := s.client.GetPrefix(ctx, prefix)
	if err != nil {
		return nil, err
	}
	
	keys := make([]*crypto.RC4Key, 0, len(dataMap))
	for _, data := range dataMap {
		var keyData KeyData
		if err := json.Unmarshal([]byte(data), &keyData); err != nil {
			continue
		}
		keys = append(keys, &crypto.RC4Key{
			ID:        keyData.ID,
			Version:   keyData.Version,
			KeyBytes:  keyData.KeyBytes,
			CreatedAt: keyData.CreatedAt,
			Active:    keyData.Active,
		})
	}
	
	return keys, nil
}

func (s *MetadataStore) DeleteKey(ctx context.Context, version int) error {
	keyPath := s.getKeyPath(fmt.Sprintf("keys/version-%d", version))
	return s.client.Delete(ctx, keyPath)
}

func (s *MetadataStore) SaveColumnConfig(ctx context.Context, config *crypto.ColumnEncryptionConfig) error {
	data := ColumnConfigData{
		TableSchema: config.TableSchema,
		TableName:   config.TableName,
		ColumnName:  config.ColumnName,
		ColumnType:  byte(config.ColumnType),
		Enabled:     config.Enabled,
		KeyVersion:  config.KeyVersion,
		CreatedAt:   config.CreatedAt,
		UpdatedAt:   config.UpdatedAt,
	}
	
	jsonData, err := json.Marshal(data)
	if err != nil {
		return err
	}
	
	keyPath := s.getKeyPath(fmt.Sprintf("columns/%s.%s.%s", config.TableSchema, config.TableName, config.ColumnName))
	return s.client.Put(ctx, keyPath, string(jsonData))
}

func (s *MetadataStore) GetColumnConfig(ctx context.Context, schema, table, column string) (*crypto.ColumnEncryptionConfig, error) {
	keyPath := s.getKeyPath(fmt.Sprintf("columns/%s.%s.%s", schema, table, column))
	data, err := s.client.Get(ctx, keyPath)
	if err != nil {
		return nil, err
	}
	
	var configData ColumnConfigData
	if err := json.Unmarshal([]byte(data), &configData); err != nil {
		return nil, err
	}
	
	return &crypto.ColumnEncryptionConfig{
		TableSchema: configData.TableSchema,
		TableName:   configData.TableName,
		ColumnName:  configData.ColumnName,
		ColumnType:  crypto.DataType(configData.ColumnType),
		Enabled:     configData.Enabled,
		KeyVersion:  configData.KeyVersion,
		CreatedAt:   configData.CreatedAt,
		UpdatedAt:   configData.UpdatedAt,
	}, nil
}

func (s *MetadataStore) GetAllColumnConfigs(ctx context.Context) ([]*crypto.ColumnEncryptionConfig, error) {
	prefix := s.getKeyPath("columns/")
	dataMap, err := s.client.GetPrefix(ctx, prefix)
	if err != nil {
		return nil, err
	}
	
	configs := make([]*crypto.ColumnEncryptionConfig, 0, len(dataMap))
	for _, data := range dataMap {
		var configData ColumnConfigData
		if err := json.Unmarshal([]byte(data), &configData); err != nil {
			continue
		}
		configs = append(configs, &crypto.ColumnEncryptionConfig{
			TableSchema: configData.TableSchema,
			TableName:   configData.TableName,
			ColumnName:  configData.ColumnName,
			ColumnType:  crypto.DataType(configData.ColumnType),
			Enabled:     configData.Enabled,
			KeyVersion:  configData.KeyVersion,
			CreatedAt:   configData.CreatedAt,
			UpdatedAt:   configData.UpdatedAt,
		})
	}
	
	return configs, nil
}

func (s *MetadataStore) DeleteColumnConfig(ctx context.Context, schema, table, column string) error {
	keyPath := s.getKeyPath(fmt.Sprintf("columns/%s.%s.%s", schema, table, column))
	return s.client.Delete(ctx, keyPath)
}

func (s *MetadataStore) SaveRotationStatus(ctx context.Context, inProgress bool, startTime int64) error {
	status := map[string]interface{}{
		"in_progress": inProgress,
		"start_time":  startTime,
		"updated_at":  time.Now().Unix(),
	}
	
	jsonData, err := json.Marshal(status)
	if err != nil {
		return err
	}
	
	keyPath := s.getKeyPath("rotation/status")
	return s.client.Put(ctx, keyPath, string(jsonData))
}

func (s *MetadataStore) GetRotationStatus(ctx context.Context) (bool, int64, error) {
	keyPath := s.getKeyPath("rotation/status")
	data, err := s.client.Get(ctx, keyPath)
	if err != nil {
		return false, 0, nil
	}
	
	var status map[string]interface{}
	if err := json.Unmarshal([]byte(data), &status); err != nil {
		return false, 0, err
	}
	
	inProgress, _ := status["in_progress"].(bool)
	startTime, _ := status["start_time"].(float64)
	
	return inProgress, int64(startTime), nil
}

func (s *MetadataStore) WatchKeys(ctx context.Context) chan WatchEvent {
	return s.client.Watch(ctx, s.getKeyPath("keys/"))
}

func (s *MetadataStore) WatchColumns(ctx context.Context) chan WatchEvent {
	return s.client.Watch(ctx, s.getKeyPath("columns/"))
}

func (s *MetadataStore) Close() error {
	return s.client.Close()
}
