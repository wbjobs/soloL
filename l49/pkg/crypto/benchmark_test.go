package crypto

import (
	"crypto/rand"
	"fmt"
	"testing"
	"time"
)

func BenchmarkRC4Encrypt(b *testing.B) {
	engine := NewRC4Engine(3)
	keyBytes := make([]byte, 32)
	rand.Read(keyBytes)
	engine.AddKey("test-key", 1, keyBytes)

	plaintext := make([]byte, 100)
	rand.Read(plaintext)

	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		_, err := engine.Encrypt(plaintext, 1)
		if err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkRC4Decrypt(b *testing.B) {
	engine := NewRC4Engine(3)
	keyBytes := make([]byte, 32)
	rand.Read(keyBytes)
	engine.AddKey("test-key", 1, keyBytes)

	plaintext := make([]byte, 100)
	rand.Read(plaintext)
	ciphertext, _ := engine.Encrypt(plaintext, 1)

	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		_, err := engine.Decrypt(ciphertext)
		if err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkRC4Throughput(b *testing.B) {
	engine := NewRC4Engine(3)
	keyBytes := make([]byte, 32)
	rand.Read(keyBytes)
	engine.AddKey("test-key", 1, keyBytes)

	sizes := []int{64, 128, 256, 512, 1024}

	for _, size := range sizes {
		b.Run(fmt.Sprintf("size-%d", size), func(b *testing.B) {
			plaintext := make([]byte, size)
			rand.Read(plaintext)

			b.ResetTimer()
			b.SetBytes(int64(size))

			for i := 0; i < b.N; i++ {
				_, err := engine.Encrypt(plaintext, 1)
				if err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

func TestEncryptionLatency(t *testing.T) {
	engine := NewRC4Engine(3)
	keyBytes := make([]byte, 32)
	rand.Read(keyBytes)
	engine.AddKey("test-key", 1, keyBytes)

	plaintext := make([]byte, 100)
	rand.Read(plaintext)

	iterations := 10000
	totalTime := time.Duration(0)

	for i := 0; i < iterations; i++ {
		start := time.Now()
		_, err := engine.Encrypt(plaintext, 1)
		if err != nil {
			t.Fatal(err)
		}
		totalTime += time.Since(start)
	}

	avgLatency := totalTime / time.Duration(iterations)
	t.Logf("Average encryption latency: %v", avgLatency)

	if avgLatency > 5*time.Millisecond {
		t.Errorf("Latency too high: %v, expected < 5ms", avgLatency)
	}
}

func TestEncryptionThroughput(t *testing.T) {
	engine := NewRC4Engine(3)
	keyBytes := make([]byte, 32)
	rand.Read(keyBytes)
	engine.AddKey("test-key", 1, keyBytes)

	plaintext := make([]byte, 100)
	rand.Read(plaintext)

	duration := 1 * time.Second
	start := time.Now()
	count := 0

	for time.Since(start) < duration {
		_, err := engine.Encrypt(plaintext, 1)
		if err != nil {
			t.Fatal(err)
		}
		count++
	}

	elapsed := time.Since(start)
	tps := float64(count) / elapsed.Seconds()

	t.Logf("Throughput: %.2f TPS", tps)
	t.Logf("Total operations: %d in %v", count, elapsed)

	if tps < 10000 {
		t.Errorf("Throughput too low: %.2f TPS, expected > 10000 TPS", tps)
	}
}

func TestConcurrentEncryption(t *testing.T) {
	engine := NewRC4Engine(3)
	keyBytes := make([]byte, 32)
	rand.Read(keyBytes)
	engine.AddKey("test-key", 1, keyBytes)

	concurrency := 100
	operationsPerGoroutine := 1000
	done := make(chan bool, concurrency)

	start := time.Now()

	for g := 0; g < concurrency; g++ {
		go func() {
			plaintext := make([]byte, 100)
			rand.Read(plaintext)

			for i := 0; i < operationsPerGoroutine; i++ {
				_, err := engine.Encrypt(plaintext, 1)
				if err != nil {
					t.Error(err)
					done <- false
					return
				}
			}
			done <- true
		}()
	}

	successCount := 0
	for g := 0; g < concurrency; g++ {
		if <-done {
			successCount++
		}
	}

	elapsed := time.Since(start)
	totalOps := concurrency * operationsPerGoroutine
	tps := float64(totalOps) / elapsed.Seconds()

	t.Logf("Concurrent test: %d goroutines, %d ops each", concurrency, operationsPerGoroutine)
	t.Logf("Total time: %v", elapsed)
	t.Logf("Throughput: %.2f TPS", tps)
	t.Logf("Success: %d/%d", successCount, concurrency)

	if successCount != concurrency {
		t.Errorf("Some goroutines failed")
	}

	if tps < 10000 {
		t.Errorf("Concurrent throughput too low: %.2f TPS", tps)
	}
}
