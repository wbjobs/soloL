package audit

import (
	"context"
	"fmt"
	"sync"
	"time"
)

type AuditOperation string

const (
	OpEncrypt     AuditOperation = "ENCRYPT"
	OpDecrypt     AuditOperation = "DECRYPT"
	OpKeyRotate   AuditOperation = "KEY_ROTATE"
	OpKeyGenerate AuditOperation = "KEY_GENERATE"
	OpQuery       AuditOperation = "QUERY"
	OpInsert      AuditOperation = "INSERT"
	OpUpdate      AuditOperation = "UPDATE"
)

type AuditLogEntry struct {
	ID          string
	Timestamp   time.Time
	Operation   AuditOperation
	UserID      string
	TableName   string
	ColumnName  string
	IPAddress   string
	ClientApp   string
	KeyVersion  int
	Success     bool
	ErrorMessage string
	DurationMs  int64
	Extra       map[string]string
}

type AuditLogger interface {
	Log(entry *AuditLogEntry) error
	LogAsync(entry *AuditLogEntry)
	Close() error
	Flush() error
}

type ClickHouseConfig struct {
	Hosts     []string
	Database  string
	Table     string
	Username  string
	Password  string
	BatchSize int
	FlushInterval time.Duration
}

type MockClickHouseLogger struct {
	mu        sync.Mutex
	logs      []*AuditLogEntry
	batchSize int
	batchChan chan *AuditLogEntry
	stopChan  chan struct{}
	wg        sync.WaitGroup
	closed    bool
}

func NewMockClickHouseLogger(batchSize int) *MockClickHouseLogger {
	if batchSize <= 0 {
		batchSize = 100
	}

	logger := &MockClickHouseLogger{
		logs:      make([]*AuditLogEntry, 0, 1000),
		batchSize: batchSize,
		batchChan: make(chan *AuditLogEntry, 1000),
		stopChan:  make(chan struct{}),
	}

	logger.wg.Add(1)
	go logger.processBatch()

	return logger
}

func (l *MockClickHouseLogger) processBatch() {
	defer l.wg.Done()

	batch := make([]*AuditLogEntry, 0, l.batchSize)
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()

	for {
		select {
		case entry := <-l.batchChan:
			batch = append(batch, entry)
			if len(batch) >= l.batchSize {
				l.insertBatch(batch)
				batch = batch[:0]
			}
		case <-ticker.C:
			if len(batch) > 0 {
				l.insertBatch(batch)
				batch = batch[:0]
			}
		case <-l.stopChan:
			if len(batch) > 0 {
				l.insertBatch(batch)
			}
			return
		}
	}
}

func (l *MockClickHouseLogger) insertBatch(batch []*AuditLogEntry) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.logs = append(l.logs, batch...)
}

func (l *MockClickHouseLogger) Log(entry *AuditLogEntry) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.logs = append(l.logs, entry)
	return nil
}

func (l *MockClickHouseLogger) LogAsync(entry *AuditLogEntry) {
	go l.Log(entry)
}

func (l *MockClickHouseLogger) Flush() error {
	l.mu.Lock()
	defer l.mu.Unlock()
	return nil
}

func (l *MockClickHouseLogger) Close() error {
	l.mu.Lock()
	if l.closed {
		l.mu.Unlock()
		return nil
	}
	l.closed = true
	l.mu.Unlock()

	close(l.stopChan)
	l.wg.Wait()
	l.mu.Lock()
	select {
	case <-l.batchChan:
	default:
	}
	l.mu.Unlock()
	return nil
}

func (l *MockClickHouseLogger) GetLogs() []*AuditLogEntry {
	l.mu.Lock()
	defer l.mu.Unlock()
	result := make([]*AuditLogEntry, len(l.logs))
	copy(result, l.logs)
	return result
}

func (l *MockClickHouseLogger) GetLogCount() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.logs)
}

func (l *MockClickHouseLogger) ClearLogs() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.logs = l.logs[:0]
}

func (l *MockClickHouseLogger) FilterByOperation(op AuditOperation) []*AuditLogEntry {
	l.mu.Lock()
	defer l.mu.Unlock()

	result := make([]*AuditLogEntry, 0)
	for _, entry := range l.logs {
		if entry.Operation == op {
			result = append(result, entry)
		}
	}
	return result
}

func (l *MockClickHouseLogger) FilterByTable(tableName string) []*AuditLogEntry {
	l.mu.Lock()
	defer l.mu.Unlock()

	result := make([]*AuditLogEntry, 0)
	for _, entry := range l.logs {
		if entry.TableName == tableName {
			result = append(result, entry)
		}
	}
	return result
}

func (l *MockClickHouseLogger) FilterByUser(userID string) []*AuditLogEntry {
	l.mu.Lock()
	defer l.mu.Unlock()

	result := make([]*AuditLogEntry, 0)
	for _, entry := range l.logs {
		if entry.UserID == userID {
			result = append(result, entry)
		}
	}
	return result
}

type AuditingProxy struct {
	logger AuditLogger
}

func NewAuditingProxy(logger AuditLogger) *AuditingProxy {
	return &AuditingProxy{
		logger: logger,
	}
}

func (a *AuditingProxy) RecordEncrypt(ctx context.Context, userID, tableName, columnName string, keyVersion int, duration time.Duration, success bool, errMsg string) {
	entry := &AuditLogEntry{
		Timestamp:   time.Now(),
		Operation:   OpEncrypt,
		UserID:      userID,
		TableName:   tableName,
		ColumnName:  columnName,
		KeyVersion:  keyVersion,
		Success:     success,
		ErrorMessage: errMsg,
		DurationMs:  duration.Milliseconds(),
	}
	a.logger.LogAsync(entry)
}

func (a *AuditingProxy) RecordDecrypt(ctx context.Context, userID, tableName, columnName string, keyVersion int, duration time.Duration, success bool, errMsg string) {
	entry := &AuditLogEntry{
		Timestamp:   time.Now(),
		Operation:   OpDecrypt,
		UserID:      userID,
		TableName:   tableName,
		ColumnName:  columnName,
		KeyVersion:  keyVersion,
		Success:     success,
		ErrorMessage: errMsg,
		DurationMs:  duration.Milliseconds(),
	}
	a.logger.LogAsync(entry)
}

func (a *AuditingProxy) RecordQuery(ctx context.Context, userID, tableName, ipAddress, clientApp string, duration time.Duration, success bool, errMsg string) {
	entry := &AuditLogEntry{
		Timestamp:   time.Now(),
		Operation:   OpQuery,
		UserID:      userID,
		TableName:   tableName,
		IPAddress:   ipAddress,
		ClientApp:   clientApp,
		Success:     success,
		ErrorMessage: errMsg,
		DurationMs:  duration.Milliseconds(),
	}
	a.logger.LogAsync(entry)
}

func (a *AuditingProxy) RecordKeyRotate(ctx context.Context, userID string, oldVersion, newVersion int, duration time.Duration, success bool, errMsg string) {
	entry := &AuditLogEntry{
		Timestamp:   time.Now(),
		Operation:   OpKeyRotate,
		UserID:      userID,
		KeyVersion:  newVersion,
		Success:     success,
		ErrorMessage: errMsg,
		DurationMs:  duration.Milliseconds(),
		Extra: map[string]string{
			"old_version": fmt.Sprintf("%d", oldVersion),
			"new_version": fmt.Sprintf("%d", newVersion),
		},
	}
	a.logger.LogAsync(entry)
}

func (a *AuditingProxy) Close() error {
	return a.logger.Close()
}

func (a *AuditingProxy) Flush() error {
	return a.logger.Flush()
}
