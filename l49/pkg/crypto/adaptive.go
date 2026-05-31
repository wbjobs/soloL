package crypto

import (
	"container/list"
	"crypto/sha256"
	"encoding/hex"
	"sync"
	"sync/atomic"
	"time"
)

type EncryptionLevel int

const (
	LevelFull EncryptionLevel = iota
	LevelMemoryCached
	LevelDisabled
)

type ColumnAccessStats struct {
	ColumnName     string
	AccessCount    int64
	LastAccessTime time.Time
	Level          EncryptionLevel
	CacheHits      int64
	CacheMisses    int64
}

type CachedEntry struct {
	Key        string
	Plaintext  []byte
	ExpireTime time.Time
}

type AdaptiveCryptoCache struct {
	mu         sync.RWMutex
	cache      map[string]*CachedEntry
	lruList    *list.List
	capacity   int
	ttl        time.Duration
	hits       int64
	misses     int64
	evictions  int64
}

func NewAdaptiveCryptoCache(capacity int, ttl time.Duration) *AdaptiveCryptoCache {
	if capacity <= 0 {
		capacity = 10000
	}
	if ttl <= 0 {
		ttl = 5 * time.Minute
	}
	return &AdaptiveCryptoCache{
		cache:    make(map[string]*CachedEntry),
		lruList:  list.New(),
		capacity: capacity,
		ttl:      ttl,
	}
}

func (c *AdaptiveCryptoCache) generateCacheKey(ciphertext []byte) string {
	hash := sha256.Sum256(ciphertext)
	return hex.EncodeToString(hash[:16])
}

func (c *AdaptiveCryptoCache) Get(ciphertext []byte) ([]byte, bool) {
	key := c.generateCacheKey(ciphertext)

	c.mu.RLock()
	entry, exists := c.cache[key]
	c.mu.RUnlock()

	if !exists {
		atomic.AddInt64(&c.misses, 1)
		return nil, false
	}

	if time.Now().After(entry.ExpireTime) {
		c.mu.Lock()
		delete(c.cache, key)
		c.mu.Unlock()
		atomic.AddInt64(&c.misses, 1)
		return nil, false
	}

	c.mu.Lock()
	if e, ok := c.cache[key]; ok {
		c.lruList.MoveToFront(&list.Element{Value: e})
	}
	c.mu.Unlock()

	atomic.AddInt64(&c.hits, 1)
	return entry.Plaintext, true
}

func (c *AdaptiveCryptoCache) Put(ciphertext []byte, plaintext []byte) {
	key := c.generateCacheKey(ciphertext)

	c.mu.Lock()
	defer c.mu.Unlock()

	if entry, exists := c.cache[key]; exists {
		entry.Plaintext = plaintext
		entry.ExpireTime = time.Now().Add(c.ttl)
		c.lruList.MoveToFront(&list.Element{Value: entry})
		return
	}

	if c.lruList.Len() >= c.capacity {
		c.evictOldestLocked()
	}

	entry := &CachedEntry{
		Key:        key,
		Plaintext:  plaintext,
		ExpireTime: time.Now().Add(c.ttl),
	}
	c.cache[key] = entry
	c.lruList.PushFront(entry)
}

func (c *AdaptiveCryptoCache) evictOldestLocked() {
	if e := c.lruList.Back(); e != nil {
		entry := e.Value.(*CachedEntry)
		delete(c.cache, entry.Key)
		c.lruList.Remove(e)
		atomic.AddInt64(&c.evictions, 1)
	}
}

func (c *AdaptiveCryptoCache) Hits() int64 {
	return atomic.LoadInt64(&c.hits)
}

func (c *AdaptiveCryptoCache) Misses() int64 {
	return atomic.LoadInt64(&c.misses)
}

func (c *AdaptiveCryptoCache) Evictions() int64 {
	return atomic.LoadInt64(&c.evictions)
}

func (c *AdaptiveCryptoCache) HitRate() float64 {
	hits := atomic.LoadInt64(&c.hits)
	misses := atomic.LoadInt64(&c.misses)
	total := hits + misses
	if total == 0 {
		return 0
	}
	return float64(hits) / float64(total)
}

func (c *AdaptiveCryptoCache) Size() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.lruList.Len()
}

func (c *AdaptiveCryptoCache) Clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.cache = make(map[string]*CachedEntry)
	c.lruList.Init()
	atomic.StoreInt64(&c.hits, 0)
	atomic.StoreInt64(&c.misses, 0)
	atomic.StoreInt64(&c.evictions, 0)
}

type AdaptiveCryptoPolicy struct {
	engine      *RC4Engine
	cache       *AdaptiveCryptoCache
	stats       map[string]*ColumnAccessStats
	statsMu     sync.RWMutex
	threshold   int64
	windowSize  time.Duration
	autoAdjust  bool
}

func NewAdaptiveCryptoPolicy(engine *RC4Engine, cacheCapacity int, cacheTTL time.Duration) *AdaptiveCryptoPolicy {
	return &AdaptiveCryptoPolicy{
		engine:     engine,
		cache:      NewAdaptiveCryptoCache(cacheCapacity, cacheTTL),
		stats:      make(map[string]*ColumnAccessStats),
		threshold:  1000,
		windowSize: 5 * time.Minute,
		autoAdjust: true,
	}
}

func (p *AdaptiveCryptoPolicy) recordAccess(columnName string) {
	p.statsMu.Lock()
	defer p.statsMu.Unlock()

	stats, exists := p.stats[columnName]
	if !exists {
		stats = &ColumnAccessStats{
			ColumnName: columnName,
			Level:      LevelFull,
		}
		p.stats[columnName] = stats
	}

	stats.AccessCount++
	stats.LastAccessTime = time.Now()

	if p.autoAdjust && stats.AccessCount > p.threshold {
		stats.Level = LevelMemoryCached
	}
}

func (p *AdaptiveCryptoPolicy) GetEncryptionLevel(columnName string) EncryptionLevel {
	p.statsMu.RLock()
	defer p.statsMu.RUnlock()

	if stats, exists := p.stats[columnName]; exists {
		return stats.Level
	}
	return LevelFull
}

func (p *AdaptiveCryptoPolicy) Encrypt(columnName string, plaintext []byte, version int) ([]byte, error) {
	p.recordAccess(columnName)
	return p.engine.Encrypt(plaintext, version)
}

func (p *AdaptiveCryptoPolicy) Decrypt(columnName string, ciphertext []byte) ([]byte, error) {
	p.recordAccess(columnName)
	level := p.GetEncryptionLevel(columnName)

	if level == LevelMemoryCached {
		if plaintext, hit := p.cache.Get(ciphertext); hit {
			p.statsMu.Lock()
			if stats, exists := p.stats[columnName]; exists {
				stats.CacheHits++
			}
			p.statsMu.Unlock()
			return plaintext, nil
		}
		p.statsMu.Lock()
		if stats, exists := p.stats[columnName]; exists {
			stats.CacheMisses++
		}
		p.statsMu.Unlock()
	}

	plaintext, err := p.engine.Decrypt(ciphertext)
	if err != nil {
		return nil, err
	}

	if level == LevelMemoryCached {
		p.cache.Put(ciphertext, plaintext)
	}

	return plaintext, nil
}

func (p *AdaptiveCryptoPolicy) GetColumnStats(columnName string) *ColumnAccessStats {
	p.statsMu.RLock()
	defer p.statsMu.RUnlock()

	if stats, exists := p.stats[columnName]; exists {
		return &ColumnAccessStats{
			ColumnName:     stats.ColumnName,
			AccessCount:    stats.AccessCount,
			LastAccessTime: stats.LastAccessTime,
			Level:          stats.Level,
			CacheHits:      stats.CacheHits,
			CacheMisses:    stats.CacheMisses,
		}
	}
	return nil
}

func (p *AdaptiveCryptoPolicy) GetAllStats() map[string]*ColumnAccessStats {
	p.statsMu.RLock()
	defer p.statsMu.RUnlock()

	result := make(map[string]*ColumnAccessStats, len(p.stats))
	for k, v := range p.stats {
		result[k] = &ColumnAccessStats{
			ColumnName:     v.ColumnName,
			AccessCount:    v.AccessCount,
			LastAccessTime: v.LastAccessTime,
			Level:          v.Level,
			CacheHits:      v.CacheHits,
			CacheMisses:    v.CacheMisses,
		}
	}
	return result
}

func (p *AdaptiveCryptoPolicy) SetThreshold(threshold int64) {
	atomic.StoreInt64(&p.threshold, threshold)
}

func (p *AdaptiveCryptoPolicy) SetAutoAdjust(auto bool) {
	p.statsMu.Lock()
	defer p.statsMu.Unlock()
	p.autoAdjust = auto
}

func (p *AdaptiveCryptoPolicy) ForceLevel(columnName string, level EncryptionLevel) {
	p.statsMu.Lock()
	defer p.statsMu.Unlock()

	if stats, exists := p.stats[columnName]; exists {
		stats.Level = level
	} else {
		p.stats[columnName] = &ColumnAccessStats{
			ColumnName: columnName,
			Level:      level,
		}
	}
}

func (p *AdaptiveCryptoPolicy) ResetStats(columnName string) {
	p.statsMu.Lock()
	defer p.statsMu.Unlock()

	if stats, exists := p.stats[columnName]; exists {
		stats.AccessCount = 0
		stats.CacheHits = 0
		stats.CacheMisses = 0
		stats.Level = LevelFull
	}
}

func (p *AdaptiveCryptoPolicy) ResetAllStats() {
	p.statsMu.Lock()
	defer p.statsMu.Unlock()

	for _, stats := range p.stats {
		stats.AccessCount = 0
		stats.CacheHits = 0
		stats.CacheMisses = 0
		stats.Level = LevelFull
	}
}

func (p *AdaptiveCryptoPolicy) CacheHitRate() float64 {
	return p.cache.HitRate()
}

func (p *AdaptiveCryptoPolicy) CacheSize() int {
	return p.cache.Size()
}

func (p *AdaptiveCryptoPolicy) ClearCache() {
	p.cache.Clear()
}

func (p *AdaptiveCryptoPolicy) GetEngine() *RC4Engine {
	return p.engine
}
