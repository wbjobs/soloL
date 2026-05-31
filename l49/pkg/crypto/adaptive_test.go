package crypto

import (
	"bytes"
	"testing"
	"time"
)

func TestAdaptiveCryptoCacheBasic(t *testing.T) {
	cache := NewAdaptiveCryptoCache(100, time.Minute)

	ciphertext := []byte("encrypted-data")
	plaintext := []byte("original-data")

	cache.Put(ciphertext, plaintext)

	retrieved, hit := cache.Get(ciphertext)
	if !hit {
		t.Error("Expected cache hit")
	}

	if !bytes.Equal(retrieved, plaintext) {
		t.Error("Retrieved data mismatch")
	}
}

func TestAdaptiveCryptoCacheMiss(t *testing.T) {
	cache := NewAdaptiveCryptoCache(100, time.Minute)

	_, hit := cache.Get([]byte("not-in-cache"))
	if hit {
		t.Error("Expected cache miss")
	}

	if cache.Hits() != 0 {
		t.Errorf("Expected 0 hits, got %d", cache.Hits())
	}

	if cache.Misses() != 1 {
		t.Errorf("Expected 1 miss, got %d", cache.Misses())
	}
}

func TestAdaptiveCryptoCacheTTL(t *testing.T) {
	cache := NewAdaptiveCryptoCache(100, 50*time.Millisecond)

	ciphertext := []byte("test-cipher")
	plaintext := []byte("test-plain")

	cache.Put(ciphertext, plaintext)

	time.Sleep(10 * time.Millisecond)
	_, hit := cache.Get(ciphertext)
	if !hit {
		t.Error("Expected cache hit before TTL expiry")
	}

	time.Sleep(60 * time.Millisecond)
	_, hit = cache.Get(ciphertext)
	if hit {
		t.Error("Expected cache miss after TTL expiry")
	}
}

func TestAdaptiveCryptoCacheLRU(t *testing.T) {
	cache := NewAdaptiveCryptoCache(3, time.Minute)

	for i := 0; i < 5; i++ {
		ciphertext := []byte{byte(i)}
		plaintext := []byte{byte(i + 100)}
		cache.Put(ciphertext, plaintext)
	}

	if cache.Size() != 3 {
		t.Errorf("Expected size 3, got %d", cache.Size())
	}

	if cache.Evictions() != 2 {
		t.Errorf("Expected 2 evictions, got %d", cache.Evictions())
	}
}

func TestAdaptiveCryptoCacheClear(t *testing.T) {
	cache := NewAdaptiveCryptoCache(100, time.Minute)

	for i := 0; i < 10; i++ {
		cache.Put([]byte{byte(i)}, []byte{byte(i)})
	}

	if cache.Size() != 10 {
		t.Errorf("Expected size 10, got %d", cache.Size())
	}

	cache.Clear()

	if cache.Size() != 0 {
		t.Errorf("Expected size 0 after clear, got %d", cache.Size())
	}

	if cache.Hits() != 0 {
		t.Errorf("Expected 0 hits after clear, got %d", cache.Hits())
	}
}

func TestAdaptiveCryptoCacheHitRate(t *testing.T) {
	cache := NewAdaptiveCryptoCache(100, time.Minute)

	cache.Put([]byte("key1"), []byte("val1"))
	cache.Put([]byte("key2"), []byte("val2"))

	cache.Get([]byte("key1"))
	cache.Get([]byte("key1"))
	cache.Get([]byte("key3"))

	hitRate := cache.HitRate()
	expectedRate := 2.0 / 3.0

	if hitRate < expectedRate-0.01 || hitRate > expectedRate+0.01 {
		t.Errorf("Expected hit rate %.2f, got %.2f", expectedRate, hitRate)
	}
}

func TestAdaptiveCryptoPolicyBasic(t *testing.T) {
	engine := NewRC4Engine(3)
	engine.AddKey("key1", 1, []byte("test-key-12345678"))

	policy := NewAdaptiveCryptoPolicy(engine, 100, time.Minute)

	plaintext := []byte("sensitive-data")
	ciphertext, err := policy.Encrypt("users.email", plaintext, 1)
	if err != nil {
		t.Fatalf("Encrypt failed: %v", err)
	}

	decrypted, err := policy.Decrypt("users.email", ciphertext)
	if err != nil {
		t.Fatalf("Decrypt failed: %v", err)
	}

	if !bytes.Equal(decrypted, plaintext) {
		t.Error("Decrypted data mismatch")
	}

	stats := policy.GetColumnStats("users.email")
	if stats == nil {
		t.Fatal("Expected column stats")
	}

	if stats.AccessCount != 2 {
		t.Errorf("Expected 2 accesses, got %d", stats.AccessCount)
	}
}

func TestAdaptiveCryptoPolicyAutoLevel(t *testing.T) {
	engine := NewRC4Engine(3)
	engine.AddKey("key1", 1, []byte("test-key-12345678"))

	policy := NewAdaptiveCryptoPolicy(engine, 100, time.Minute)
	policy.SetThreshold(5)

	plaintext := []byte("test-data")
	ciphertext, _ := policy.Encrypt("users.phone", plaintext, 1)

	for i := 0; i < 10; i++ {
		policy.Decrypt("users.phone", ciphertext)
	}

	stats := policy.GetColumnStats("users.phone")
	if stats.Level != LevelMemoryCached {
		t.Errorf("Expected LevelMemoryCached after 10 accesses, got %v", stats.Level)
	}

	decrypted, _ := policy.Decrypt("users.phone", ciphertext)
	if !bytes.Equal(decrypted, plaintext) {
		t.Error("Decryption after level change failed")
	}

	if policy.CacheHitRate() == 0 {
		t.Error("Expected some cache hits")
	}
}

func TestAdaptiveCryptoPolicyForceLevel(t *testing.T) {
	engine := NewRC4Engine(3)
	engine.AddKey("key1", 1, []byte("test-key-12345678"))

	policy := NewAdaptiveCryptoPolicy(engine, 100, time.Minute)

	policy.ForceLevel("users.email", LevelMemoryCached)

	stats := policy.GetColumnStats("users.email")
	if stats == nil {
		t.Fatal("Expected stats")
	}
	if stats.Level != LevelMemoryCached {
		t.Error("Expected forced level to be applied")
	}
}

func TestAdaptiveCryptoPolicyResetStats(t *testing.T) {
	engine := NewRC4Engine(3)
	engine.AddKey("key1", 1, []byte("test-key-12345678"))

	policy := NewAdaptiveCryptoPolicy(engine, 100, time.Minute)

	plaintext := []byte("data")
	ciphertext, _ := policy.Encrypt("col1", plaintext, 1)
	policy.Decrypt("col1", ciphertext)

	policy.ResetStats("col1")

	stats := policy.GetColumnStats("col1")
	if stats.AccessCount != 0 {
		t.Errorf("Expected access count 0 after reset, got %d", stats.AccessCount)
	}
	if stats.Level != LevelFull {
		t.Error("Expected LevelFull after reset")
	}
}

func TestAdaptiveCryptoPolicyAllStats(t *testing.T) {
	engine := NewRC4Engine(3)
	engine.AddKey("key1", 1, []byte("test-key-12345678"))

	policy := NewAdaptiveCryptoPolicy(engine, 100, time.Minute)

	cols := []string{"col1", "col2", "col3"}
	for _, col := range cols {
		policy.Encrypt(col, []byte("data"), 1)
	}

	allStats := policy.GetAllStats()
	if len(allStats) != 3 {
		t.Errorf("Expected stats for 3 columns, got %d", len(allStats))
	}

	for _, col := range cols {
		if _, exists := allStats[col]; !exists {
			t.Errorf("Missing stats for %s", col)
		}
	}
}

func TestAdaptiveCryptoPolicyCache(t *testing.T) {
	engine := NewRC4Engine(3)
	engine.AddKey("key1", 1, []byte("test-key-12345678"))

	policy := NewAdaptiveCryptoPolicy(engine, 100, time.Minute)
	policy.SetThreshold(1)

	plaintext := []byte("cached-data")
	ciphertext, _ := policy.Encrypt("users.name", plaintext, 1)

	policy.ForceLevel("users.name", LevelMemoryCached)

	policy.Decrypt("users.name", ciphertext)
	policy.Decrypt("users.name", ciphertext)

	if policy.CacheSize() != 1 {
		t.Errorf("Expected cache size 1, got %d", policy.CacheSize())
	}

	policy.ClearCache()

	if policy.CacheSize() != 0 {
		t.Errorf("Expected cache size 0 after clear, got %d", policy.CacheSize())
	}
}
