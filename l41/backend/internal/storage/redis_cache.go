package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

const cacheKeyPrefix = "fp:"

type RedisCache struct {
	client *redis.Client
	ttl    time.Duration
}

func NewRedisCache(host, port, password string, ttlHours int) (*RedisCache, error) {
	addr := fmt.Sprintf("%s:%s", host, port)

	client := redis.NewClient(&redis.Options{
		Addr:         addr,
		Password:     password,
		DB:           0,
		MaxRetries:   3,
		DialTimeout:  5 * time.Second,
		ReadTimeout:  3 * time.Second,
		WriteTimeout: 3 * time.Second,
		PoolSize:     10,
		MinIdleConns: 3,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("failed to connect to redis: %w", err)
	}

	ttl := time.Duration(ttlHours) * time.Hour
	if ttl <= 0 {
		ttl = 24 * time.Hour
	}

	return &RedisCache{client: client, ttl: ttl}, nil
}

func (c *RedisCache) GetQueryResult(ctx context.Context, fingerprintHex string) ([]MatchResult, bool) {
	key := cacheKeyPrefix + "query:" + fingerprintHex

	val, err := c.client.Get(ctx, key).Result()
	if err != nil {
		return nil, false
	}

	var results []MatchResult
	if err := json.Unmarshal([]byte(val), &results); err != nil {
		return nil, false
	}

	return results, true
}

func (c *RedisCache) SetQueryResult(ctx context.Context, fingerprintHex string, results []MatchResult) error {
	key := cacheKeyPrefix + "query:" + fingerprintHex

	data, err := json.Marshal(results)
	if err != nil {
		return fmt.Errorf("failed to marshal cache data: %w", err)
	}

	return c.client.Set(ctx, key, data, c.ttl).Err()
}

func (c *RedisCache) GetFingerprint(ctx context.Context, id string) (*Fingerprint, bool) {
	key := cacheKeyPrefix + "fp:" + id

	val, err := c.client.Get(ctx, key).Result()
	if err != nil {
		return nil, false
	}

	var fp Fingerprint
	if err := json.Unmarshal([]byte(val), &fp); err != nil {
		return nil, false
	}

	return &fp, true
}

func (c *RedisCache) SetFingerprint(ctx context.Context, fp *Fingerprint) error {
	key := cacheKeyPrefix + "fp:" + fp.ID

	data, err := json.Marshal(fp)
	if err != nil {
		return fmt.Errorf("failed to marshal cache data: %w", err)
	}

	return c.client.Set(ctx, key, data, c.ttl).Err()
}

func (c *RedisCache) InvalidateFingerprint(ctx context.Context, id string) error {
	key := cacheKeyPrefix + "fp:" + id
	return c.client.Del(ctx, key).Err()
}

func (c *RedisCache) Close() error {
	return c.client.Close()
}

type CachedStorage struct {
	primary Storage
	cache   *RedisCache
}

func NewCachedStorage(primary Storage, cache *RedisCache) *CachedStorage {
	return &CachedStorage{primary: primary, cache: cache}
}

func (cs *CachedStorage) Store(ctx context.Context, fp *Fingerprint) (string, error) {
	id, err := cs.primary.Store(ctx, fp)
	if err != nil {
		return "", err
	}

	fp.ID = id
	_ = cs.cache.SetFingerprint(ctx, fp)

	return id, nil
}

func (cs *CachedStorage) Query(ctx context.Context, fingerprint []byte, maxResults int, threshold int) ([]MatchResult, error) {
	fingerprintHex := fmt.Sprintf("%x", fingerprint)
	if cached, ok := cs.cache.GetQueryResult(ctx, fingerprintHex); ok {
		return cs.filterByThreshold(cached, threshold), nil
	}

	results, err := cs.primary.Query(ctx, fingerprint, maxResults, threshold)
	if err != nil {
		return nil, err
	}

	_ = cs.cache.SetQueryResult(ctx, fingerprintHex, results)

	return results, nil
}

func (cs *CachedStorage) BatchQuery(ctx context.Context, fingerprints [][]byte, maxResults int, threshold int) ([][]MatchResult, error) {
	return cs.primary.BatchQuery(ctx, fingerprints, maxResults, threshold)
}

func (cs *CachedStorage) Get(ctx context.Context, id string) (*Fingerprint, error) {
	if cached, ok := cs.cache.GetFingerprint(ctx, id); ok {
		return cached, nil
	}

	fp, err := cs.primary.Get(ctx, id)
	if err != nil {
		return nil, err
	}

	_ = cs.cache.SetFingerprint(ctx, fp)

	return fp, nil
}

func (cs *CachedStorage) Delete(ctx context.Context, id string) error {
	err := cs.primary.Delete(ctx, id)
	if err != nil {
		return err
	}

	_ = cs.cache.InvalidateFingerprint(ctx, id)

	return nil
}

func (cs *CachedStorage) List(ctx context.Context, page, pageSize int) ([]Fingerprint, int, error) {
	return cs.primary.List(ctx, page, pageSize)
}

func (cs *CachedStorage) Close() error {
	cs.cache.Close()
	return cs.primary.Close()
}

func (cs *CachedStorage) filterByThreshold(results []MatchResult, threshold int) []MatchResult {
	filtered := make([]MatchResult, 0, len(results))
	for _, r := range results {
		if r.Distance <= threshold {
			filtered = append(filtered, r)
		}
	}
	return filtered
}
