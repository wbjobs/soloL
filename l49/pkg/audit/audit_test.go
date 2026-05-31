package audit

import (
	"context"
	"testing"
	"time"
)

func TestMockClickHouseLogger(t *testing.T) {
	logger := NewMockClickHouseLogger(10)
	defer logger.Close()

	if logger.GetLogCount() != 0 {
		t.Error("Initial log count should be 0")
	}

	entry := &AuditLogEntry{
		Operation: OpEncrypt,
		UserID:    "test-user",
		TableName: "users",
		ColumnName: "email",
		KeyVersion: 1,
		Success:    true,
		DurationMs: 5,
	}

	err := logger.Log(entry)
	if err != nil {
		t.Fatalf("Failed to log: %v", err)
	}

	time.Sleep(100 * time.Millisecond)

	if logger.GetLogCount() == 0 {
		t.Error("Log should be recorded")
	}
}

func TestAuditLogFiltering(t *testing.T) {
	logger := NewMockClickHouseLogger(100)
	defer logger.Close()

	entries := []*AuditLogEntry{
		{Operation: OpEncrypt, UserID: "user1", TableName: "users", ColumnName: "email"},
		{Operation: OpDecrypt, UserID: "user1", TableName: "users", ColumnName: "email"},
		{Operation: OpQuery, UserID: "user2", TableName: "orders"},
		{Operation: OpEncrypt, UserID: "user2", TableName: "orders", ColumnName: "amount"},
		{Operation: OpKeyRotate, UserID: "admin"},
	}

	for _, entry := range entries {
		logger.Log(entry)
	}

	time.Sleep(100 * time.Millisecond)

	encryptLogs := logger.FilterByOperation(OpEncrypt)
	if len(encryptLogs) != 2 {
		t.Errorf("Expected 2 ENCRYPT logs, got %d", len(encryptLogs))
	}

	user1Logs := logger.FilterByUser("user1")
	if len(user1Logs) != 2 {
		t.Errorf("Expected 2 logs for user1, got %d", len(user1Logs))
	}

	usersLogs := logger.FilterByTable("users")
	if len(usersLogs) != 2 {
		t.Errorf("Expected 2 logs for users table, got %d", len(usersLogs))
	}
}

func TestAuditingProxy(t *testing.T) {
	logger := NewMockClickHouseLogger(100)
	defer logger.Close()

	proxy := NewAuditingProxy(logger)
	defer proxy.Close()

	ctx := context.Background()

	start := time.Now()
	time.Sleep(1 * time.Millisecond)
	duration := time.Since(start)

	proxy.RecordEncrypt(ctx, "user1", "users", "email", 1, duration, true, "")
	proxy.RecordDecrypt(ctx, "user1", "users", "email", 1, duration, true, "")
	proxy.RecordQuery(ctx, "user2", "orders", "192.168.1.1", "web-app", duration, true, "")
	proxy.RecordKeyRotate(ctx, "admin", 1, 2, duration, true, "")

	time.Sleep(100 * time.Millisecond)

	logs := logger.GetLogs()
	if len(logs) != 4 {
		t.Errorf("Expected 4 logs, got %d", len(logs))
	}
}

func TestAuditLogClear(t *testing.T) {
	logger := NewMockClickHouseLogger(100)
	defer logger.Close()

	for i := 0; i < 10; i++ {
		logger.Log(&AuditLogEntry{Operation: OpEncrypt})
	}

	time.Sleep(100 * time.Millisecond)

	if logger.GetLogCount() != 10 {
		t.Errorf("Expected 10 logs, got %d", logger.GetLogCount())
	}

	logger.ClearLogs()
	if logger.GetLogCount() != 0 {
		t.Errorf("Expected 0 logs after clear, got %d", logger.GetLogCount())
	}
}

func TestAuditLogAsync(t *testing.T) {
	logger := NewMockClickHouseLogger(10)
	defer logger.Close()

	done := make(chan bool, 100)
	for i := 0; i < 100; i++ {
		go func() {
			logger.LogAsync(&AuditLogEntry{Operation: OpEncrypt})
			done <- true
		}()
	}

	for i := 0; i < 100; i++ {
		<-done
	}

	time.Sleep(100 * time.Millisecond)

	if logger.GetLogCount() != 100 {
		t.Errorf("Expected 100 logs, got %d", logger.GetLogCount())
	}
}

func TestAuditLogEntry(t *testing.T) {
	entry := &AuditLogEntry{
		Timestamp:   time.Now(),
		Operation:   OpEncrypt,
		UserID:      "test-user",
		TableName:   "users",
		ColumnName:  "phone",
		IPAddress:   "10.0.0.1",
		ClientApp:   "mobile",
		KeyVersion:  2,
		Success:     true,
		DurationMs:  10,
		Extra: map[string]string{
			"request_id": "abc123",
		},
	}

	if entry.Operation != OpEncrypt {
		t.Error("Operation mismatch")
	}
	if entry.UserID != "test-user" {
		t.Error("UserID mismatch")
	}
	if entry.Extra["request_id"] != "abc123" {
		t.Error("Extra field mismatch")
	}
}

func TestAuditLogFailure(t *testing.T) {
	logger := NewMockClickHouseLogger(100)
	defer logger.Close()

	entry := &AuditLogEntry{
		Operation:    OpDecrypt,
		UserID:       "user1",
		Success:      false,
		ErrorMessage: "key not found",
	}

	logger.Log(entry)

	time.Sleep(100 * time.Millisecond)

	logs := logger.GetLogs()
	if len(logs) != 1 {
		t.Fatalf("Expected 1 log, got %d", len(logs))
	}

	if logs[0].Success != false {
		t.Error("Success should be false")
	}
	if logs[0].ErrorMessage != "key not found" {
		t.Error("Error message mismatch")
	}
}
