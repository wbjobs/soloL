package proxy

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"time"
)

type DBConnection interface {
	ID() string
	IsValid() bool
	Close() error
	Query(ctx context.Context, sql string) ([][]interface{}, error)
	Exec(ctx context.Context, sql string) (int64, error)
}

type MockDBConnection struct {
	id     string
	valid  bool
	closed bool
	mu     sync.Mutex
}

func NewMockDBConnection(id string) *MockDBConnection {
	return &MockDBConnection{
		id:     id,
		valid:  true,
		closed: false,
	}
}

func (c *MockDBConnection) ID() string {
	return c.id
}

func (c *MockDBConnection) IsValid() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.valid && !c.closed
}

func (c *MockDBConnection) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return errors.New("connection already closed")
	}
	c.closed = true
	c.valid = false
	return nil
}

func (c *MockDBConnection) Query(ctx context.Context, sql string) ([][]interface{}, error) {
	if !c.IsValid() {
		return nil, errors.New("invalid connection")
	}
	return nil, nil
}

func (c *MockDBConnection) Exec(ctx context.Context, sql string) (int64, error) {
	if !c.IsValid() {
		return 0, errors.New("invalid connection")
	}
	return 0, nil
}

type trackedConn struct {
	conn      DBConnection
	createdAt time.Time
	lastUsed  time.Time
}

type ConnectionPool struct {
	conns        chan trackedConn
	maxConns     int32
	minConns     int32
	idleTimeout  time.Duration
	maxLifetime  time.Duration
	connFactory  func() (DBConnection, error)
	connCount    int32
	closed       int32
	closeOnce    sync.Once
	closeChan    chan struct{}
	allConns     sync.Map
}

func NewConnectionPool(
	maxConns int,
	minConns int,
	idleTimeout time.Duration,
	maxLifetime time.Duration,
	connFactory func() (DBConnection, error),
) (*ConnectionPool, error) {
	if maxConns <= 0 {
		maxConns = 10
	}
	if minConns < 0 {
		minConns = 0
	}
	if minConns > maxConns {
		minConns = maxConns
	}
	if idleTimeout <= 0 {
		idleTimeout = 5 * time.Minute
	}
	if maxLifetime <= 0 {
		maxLifetime = 30 * time.Minute
	}

	pool := &ConnectionPool{
		conns:       make(chan trackedConn, maxConns),
		maxConns:    int32(maxConns),
		minConns:    int32(minConns),
		idleTimeout: idleTimeout,
		maxLifetime: maxLifetime,
		connFactory: connFactory,
		closeChan:   make(chan struct{}),
	}

	for i := 0; i < minConns; i++ {
		conn, err := connFactory()
		if err != nil {
			pool.Close()
			return nil, err
		}
		atomic.AddInt32(&pool.connCount, 1)
		pool.allConns.Store(conn.ID(), conn)
		pool.conns <- trackedConn{
			conn:      conn,
			createdAt: time.Now(),
			lastUsed:  time.Now(),
		}
	}

	go pool.cleanupLoop()

	return pool, nil
}

func (p *ConnectionPool) Get(ctx context.Context) (DBConnection, error) {
	if atomic.LoadInt32(&p.closed) == 1 {
		return nil, errors.New("pool is closed")
	}

	for {
		select {
		case tc, ok := <-p.conns:
			if !ok {
				return nil, errors.New("pool is closed")
			}

			now := time.Now()
			if now.Sub(tc.createdAt) > p.maxLifetime ||
				now.Sub(tc.lastUsed) > p.idleTimeout ||
				!tc.conn.IsValid() {
				tc.conn.Close()
				atomic.AddInt32(&p.connCount, -1)
				p.allConns.Delete(tc.conn.ID())
				continue
			}

			return tc.conn, nil

		case <-ctx.Done():
			return nil, ctx.Err()

		default:
			count := atomic.LoadInt32(&p.connCount)
			if count < atomic.LoadInt32(&p.maxConns) {
				if atomic.CompareAndSwapInt32(&p.connCount, count, count+1) {
					conn, err := p.connFactory()
					if err != nil {
						atomic.AddInt32(&p.connCount, -1)
						return nil, err
					}
					p.allConns.Store(conn.ID(), conn)
					return conn, nil
				}
				continue
			}

			select {
			case tc, ok := <-p.conns:
				if !ok {
					return nil, errors.New("pool is closed")
				}

				now := time.Now()
				if now.Sub(tc.createdAt) > p.maxLifetime ||
					now.Sub(tc.lastUsed) > p.idleTimeout ||
					!tc.conn.IsValid() {
					tc.conn.Close()
					atomic.AddInt32(&p.connCount, -1)
					p.allConns.Delete(tc.conn.ID())
					continue
				}

				return tc.conn, nil

			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
	}
}

func (p *ConnectionPool) Put(conn DBConnection) error {
	if conn == nil {
		return errors.New("nil connection")
	}

	if atomic.LoadInt32(&p.closed) == 1 {
		conn.Close()
		atomic.AddInt32(&p.connCount, -1)
		p.allConns.Delete(conn.ID())
		return nil
	}

	if !conn.IsValid() {
		conn.Close()
		atomic.AddInt32(&p.connCount, -1)
		p.allConns.Delete(conn.ID())
		p.tryMaintainMinConns()
		return nil
	}

	tc := trackedConn{
		conn:      conn,
		lastUsed:  time.Now(),
		createdAt: time.Now(),
	}

	select {
	case p.conns <- tc:
		return nil
	default:
		conn.Close()
		atomic.AddInt32(&p.connCount, -1)
		p.allConns.Delete(conn.ID())
		return nil
	}
}

func (p *ConnectionPool) tryMaintainMinConns() {
	if atomic.LoadInt32(&p.closed) == 1 {
		return
	}

	for {
		count := atomic.LoadInt32(&p.connCount)
		minConns := atomic.LoadInt32(&p.minConns)
		maxConns := atomic.LoadInt32(&p.maxConns)

		if count >= minConns || count >= maxConns {
			break
		}

		if atomic.CompareAndSwapInt32(&p.connCount, count, count+1) {
			conn, err := p.connFactory()
			if err != nil {
				atomic.AddInt32(&p.connCount, -1)
				break
			}
			p.allConns.Store(conn.ID(), conn)
			tc := trackedConn{
				conn:      conn,
				createdAt: time.Now(),
				lastUsed:  time.Now(),
			}
			select {
			case p.conns <- tc:
			default:
				conn.Close()
				atomic.AddInt32(&p.connCount, -1)
				p.allConns.Delete(conn.ID())
			}
		}
	}
}

func (p *ConnectionPool) cleanupLoop() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			if atomic.LoadInt32(&p.closed) == 1 {
				return
			}

			needCreate := int(atomic.LoadInt32(&p.minConns)) - int(atomic.LoadInt32(&p.connCount))
			for i := 0; i < needCreate; i++ {
				count := atomic.LoadInt32(&p.connCount)
				if count >= atomic.LoadInt32(&p.maxConns) {
					break
				}
				if atomic.CompareAndSwapInt32(&p.connCount, count, count+1) {
					conn, err := p.connFactory()
					if err != nil {
						atomic.AddInt32(&p.connCount, -1)
						continue
					}
					p.allConns.Store(conn.ID(), conn)
					tc := trackedConn{
						conn:      conn,
						createdAt: time.Now(),
						lastUsed:  time.Now(),
					}
					select {
					case p.conns <- tc:
					default:
						conn.Close()
						atomic.AddInt32(&p.connCount, -1)
						p.allConns.Delete(conn.ID())
					}
				}
			}

		case <-p.closeChan:
			return
		}
	}
}

func (p *ConnectionPool) Stats() map[string]interface{} {
	count := atomic.LoadInt32(&p.connCount)
	idle := len(p.conns)
	inUse := int(count) - idle

	return map[string]interface{}{
		"total_connections": int(count),
		"in_use":            inUse,
		"idle":              idle,
		"max_connections":   int(atomic.LoadInt32(&p.maxConns)),
		"min_connections":   int(atomic.LoadInt32(&p.minConns)),
		"closed":            atomic.LoadInt32(&p.closed) == 1,
	}
}

func (p *ConnectionPool) Close() error {
	p.closeOnce.Do(func() {
		atomic.StoreInt32(&p.closed, 1)
		close(p.closeChan)
		close(p.conns)

		p.allConns.Range(func(key, value interface{}) bool {
			if conn, ok := value.(DBConnection); ok {
				conn.Close()
			}
			return true
		})
		atomic.StoreInt32(&p.connCount, 0)
	})
	return nil
}

type QueryContext struct {
	ctx      context.Context
	conn     DBConnection
	pool     *ConnectionPool
	released bool
}

func NewQueryContext(ctx context.Context, pool *ConnectionPool) (*QueryContext, error) {
	conn, err := pool.Get(ctx)
	if err != nil {
		return nil, err
	}

	return &QueryContext{
		ctx:      ctx,
		conn:     conn,
		pool:     pool,
		released: false,
	}, nil
}

func (qc *QueryContext) Connection() DBConnection {
	return qc.conn
}

func (qc *QueryContext) Context() context.Context {
	return qc.ctx
}

func (qc *QueryContext) Release() error {
	if qc.released {
		return nil
	}
	qc.released = true
	return qc.pool.Put(qc.conn)
}

func (qc *QueryContext) Close() error {
	return qc.Release()
}

type ProxyBackend struct {
	pool *ConnectionPool
}

func NewProxyBackend(pool *ConnectionPool) *ProxyBackend {
	return &ProxyBackend{
		pool: pool,
	}
}

func (b *ProxyBackend) ExecuteQuery(ctx context.Context, sql string) ([][]interface{}, error) {
	qc, err := NewQueryContext(ctx, b.pool)
	if err != nil {
		return nil, err
	}
	defer qc.Release()

	return qc.conn.Query(ctx, sql)
}

func (b *ProxyBackend) ExecuteExec(ctx context.Context, sql string) (int64, error) {
	qc, err := NewQueryContext(ctx, b.pool)
	if err != nil {
		return 0, err
	}
	defer qc.Release()

	return qc.conn.Exec(ctx, sql)
}

func (b *ProxyBackend) Close() error {
	return b.pool.Close()
}
