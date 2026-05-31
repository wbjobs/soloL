package proxy

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"
)

func TestConnectionPool_GetAndPut(t *testing.T) {
	connCounter := 0
	pool, err := NewConnectionPool(
		5,
		2,
		30*time.Second,
		5*time.Minute,
		func() (DBConnection, error) {
			connCounter++
			return NewMockDBConnection(fmt.Sprintf("conn-%d", connCounter)), nil
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()

	stats := pool.Stats()
	if stats["total_connections"] != 2 {
		t.Errorf("Expected 2 initial connections, got %d", stats["total_connections"])
	}

	ctx := context.Background()
	conn, err := pool.Get(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Put(conn)

	if conn == nil {
		t.Fatal("Got nil connection")
	}

	if !conn.IsValid() {
		t.Error("Connection should be valid")
	}

	stats = pool.Stats()
	if stats["in_use"] != 1 {
		t.Errorf("Expected 1 in_use, got %d", stats["in_use"])
	}
}

func TestConnectionPool_MaxConnections(t *testing.T) {
	connCounter := 0
	pool, err := NewConnectionPool(
		3,
		0,
		30*time.Second,
		5*time.Minute,
		func() (DBConnection, error) {
			connCounter++
			return NewMockDBConnection(fmt.Sprintf("conn-%d", connCounter)), nil
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()

	ctx := context.Background()
	conns := make([]DBConnection, 0, 3)
	for i := 0; i < 3; i++ {
		conn, err := pool.Get(ctx)
		if err != nil {
			t.Fatal(err)
		}
		conns = append(conns, conn)
	}

	stats := pool.Stats()
	if stats["total_connections"] != 3 {
		t.Errorf("Expected 3 connections, got %d", stats["total_connections"])
	}

	shortCtx, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
	defer cancel()
	_, err = pool.Get(shortCtx)
	if err == nil {
		t.Error("Should fail to get connection when pool is exhausted")
	}

	for _, conn := range conns {
		pool.Put(conn)
	}

	stats = pool.Stats()
	if stats["in_use"] != 0 {
		t.Errorf("Expected 0 in_use after put, got %d", stats["in_use"])
	}
}

func TestConnectionPool_ConcurrentAccess(t *testing.T) {
	connCounter := 0
	var counterMu sync.Mutex
	pool, err := NewConnectionPool(
		10,
		5,
		30*time.Second,
		5*time.Minute,
		func() (DBConnection, error) {
			counterMu.Lock()
			connCounter++
			id := connCounter
			counterMu.Unlock()
			return NewMockDBConnection(fmt.Sprintf("conn-%d", id)), nil
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()

	var wg sync.WaitGroup
	concurrency := 50
	operations := 100
	errors := make(chan error, concurrency*operations)

	for g := 0; g < concurrency; g++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ctx := context.Background()
			for i := 0; i < operations; i++ {
				conn, err := pool.Get(ctx)
				if err != nil {
					errors <- err
					continue
				}
				time.Sleep(time.Millisecond)
				if err := pool.Put(conn); err != nil {
					errors <- err
				}
			}
		}()
	}

	wg.Wait()
	close(errors)

	errorCount := 0
	for err := range errors {
		if err != nil {
			errorCount++
			t.Logf("Error: %v", err)
		}
	}

	if errorCount > 0 {
		t.Errorf("Got %d errors during concurrent access", errorCount)
	}

	stats := pool.Stats()
	t.Logf("Pool stats after concurrent test: %+v", stats)

	if stats["in_use"] != 0 {
		t.Errorf("All connections should be returned, got %d in_use", stats["in_use"])
	}
}

func TestConnectionPool_ConnectionLeakPrevention(t *testing.T) {
	connCounter := 0
	pool, err := NewConnectionPool(
		10,
		2,
		30*time.Second,
		5*time.Minute,
		func() (DBConnection, error) {
			connCounter++
			return NewMockDBConnection(fmt.Sprintf("conn-%d", connCounter)), nil
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()

	ctx := context.Background()

	for i := 0; i < 20; i++ {
		qc, err := NewQueryContext(ctx, pool)
		if err != nil {
			t.Fatal(err)
		}
		qc.Close()
	}

	stats := pool.Stats()
	if stats["in_use"] != 0 {
		t.Errorf("All QueryContext should release connections, got %d in_use", stats["in_use"])
	}

	totalCreated := connCounter
	t.Logf("Total connections created: %d", totalCreated)

	if totalCreated > 10 {
		t.Errorf("Should not create more than max connections, created %d", totalCreated)
	}
}

func TestConnectionPool_InvalidConnection(t *testing.T) {
	connCounter := 0
	pool, err := NewConnectionPool(
		5,
		2,
		30*time.Second,
		5*time.Minute,
		func() (DBConnection, error) {
			connCounter++
			return NewMockDBConnection(fmt.Sprintf("conn-%d", connCounter)), nil
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()

	ctx := context.Background()
	conn, err := pool.Get(ctx)
	if err != nil {
		t.Fatal(err)
	}

	mockConn, ok := conn.(*MockDBConnection)
	if !ok {
		t.Fatal("Expected MockDBConnection")
	}

	mockConn.valid = false

	err = pool.Put(conn)
	if err != nil {
		t.Logf("Expected no error for invalid connection put, got: %v", err)
	}

	stats := pool.Stats()
	if stats["total_connections"] != 2 {
		t.Errorf("Invalid connection should be discarded, expected 2 connections, got %d", stats["total_connections"])
	}
}

func TestConnectionPool_Close(t *testing.T) {
	connCounter := 0
	pool, err := NewConnectionPool(
		5,
		3,
		30*time.Second,
		5*time.Minute,
		func() (DBConnection, error) {
			connCounter++
			return NewMockDBConnection(fmt.Sprintf("conn-%d", connCounter)), nil
		},
	)
	if err != nil {
		t.Fatal(err)
	}

	ctx := context.Background()
	conns := make([]DBConnection, 0, 2)
	for i := 0; i < 2; i++ {
		conn, err := pool.Get(ctx)
		if err != nil {
			t.Fatal(err)
		}
		conns = append(conns, conn)
	}

	err = pool.Close()
	if err != nil {
		t.Fatal(err)
	}

	stats := pool.Stats()
	if !stats["closed"].(bool) {
		t.Error("Pool should be closed")
	}

	if stats["total_connections"] != 0 {
		t.Errorf("All connections should be closed, got %d", stats["total_connections"])
	}

	for _, conn := range conns {
		if conn.IsValid() {
			t.Error("All connections should be invalid after pool close")
		}
	}

	_, err = pool.Get(ctx)
	if err == nil {
		t.Error("Should fail to get connection from closed pool")
	}
}

func TestConnectionPool_QueryContext(t *testing.T) {
	connCounter := 0
	pool, err := NewConnectionPool(
		5,
		2,
		30*time.Second,
		5*time.Minute,
		func() (DBConnection, error) {
			connCounter++
			return NewMockDBConnection(fmt.Sprintf("conn-%d", connCounter)), nil
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()

	ctx := context.Background()
	qc, err := NewQueryContext(ctx, pool)
	if err != nil {
		t.Fatal(err)
	}

	if qc.Connection() == nil {
		t.Error("QueryContext should have a connection")
	}

	if qc.Context() != ctx {
		t.Error("QueryContext should return the original context")
	}

	err = qc.Release()
	if err != nil {
		t.Fatal(err)
	}

	stats := pool.Stats()
	if stats["in_use"] != 0 {
		t.Errorf("Connection should be released, got %d in_use", stats["in_use"])
	}

	err = qc.Release()
	if err != nil {
		t.Error("Multiple release should be safe")
	}
}

func TestConnectionPool_MinConnections(t *testing.T) {
	connCounter := 0
	minConns := 5
	pool, err := NewConnectionPool(
		10,
		minConns,
		30*time.Second,
		5*time.Minute,
		func() (DBConnection, error) {
			connCounter++
			return NewMockDBConnection(fmt.Sprintf("conn-%d", connCounter)), nil
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()

	stats := pool.Stats()
	if stats["total_connections"] != minConns {
		t.Errorf("Expected %d initial connections, got %d", minConns, stats["total_connections"])
	}

	ctx := context.Background()
	conns := make([]DBConnection, 0, minConns)
	for i := 0; i < minConns; i++ {
		conn, err := pool.Get(ctx)
		if err != nil {
			t.Fatal(err)
		}
		conns = append(conns, conn)
	}

	for _, conn := range conns {
		mockConn := conn.(*MockDBConnection)
		mockConn.valid = false
		pool.Put(conn)
	}

	stats = pool.Stats()
	totalConns, _ := stats["total_connections"].(int)
	if totalConns < minConns {
		t.Errorf("Pool should maintain minimum connections, got %d", totalConns)
	}
}
