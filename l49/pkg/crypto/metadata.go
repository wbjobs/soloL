package crypto

import (
	"sync"
)

type ColumnEncryptionConfig struct {
	TableSchema string
	TableName   string
	ColumnName  string
	ColumnType  DataType
	Enabled     bool
	KeyVersion  int
	CreatedAt   int64
	UpdatedAt   int64
}

type MetadataManager struct {
	mu        sync.RWMutex
	columns   map[string]*ColumnEncryptionConfig
}

func NewMetadataManager() *MetadataManager {
	return &MetadataManager{
		columns: make(map[string]*ColumnEncryptionConfig),
	}
}

func (m *MetadataManager) getColumnKey(schema, table, column string) string {
	return schema + "." + table + "." + column
}

func (m *MetadataManager) AddColumn(config *ColumnEncryptionConfig) {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := m.getColumnKey(config.TableSchema, config.TableName, config.ColumnName)
	m.columns[key] = config
}

func (m *MetadataManager) RemoveColumn(schema, table, column string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := m.getColumnKey(schema, table, column)
	_, exists := m.columns[key]
	if exists {
		delete(m.columns, key)
	}
	return exists
}

func (m *MetadataManager) GetColumn(schema, table, column string) (*ColumnEncryptionConfig, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	key := m.getColumnKey(schema, table, column)
	config, exists := m.columns[key]
	return config, exists
}

func (m *MetadataManager) GetAllColumns() []*ColumnEncryptionConfig {
	m.mu.RLock()
	defer m.mu.RUnlock()
	configs := make([]*ColumnEncryptionConfig, 0, len(m.columns))
	for _, config := range m.columns {
		configs = append(configs, config)
	}
	return configs
}

func (m *MetadataManager) IsColumnEncrypted(schema, table, column string) bool {
	config, exists := m.GetColumn(schema, table, column)
	if !exists {
		return false
	}
	return config.Enabled
}

func (m *MetadataManager) UpdateKeyVersion(schema, table, column string, newVersion int) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := m.getColumnKey(schema, table, column)
	config, exists := m.columns[key]
	if !exists {
		return false
	}
	config.KeyVersion = newVersion
	return true
}
