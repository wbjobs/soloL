package config

import (
	"os"
	"strconv"
	"time"
)

type Config struct {
	RabbitMQURL      string
	PostgresURL      string
	RedisURL         string
	ElasticsearchURL string
	APIPort          string
	ChunkSize        int
	MessageTTL       time.Duration
	MaxWorkers       int
	MinWorkers       int
	QueueLengthHigh  int
	QueueLengthLow   int
	ScalingInterval  time.Duration
	MinHashSeed      int64
	MinHashPerm      int
	MinHashThreshold float64
}

func Load() *Config {
	chunkSize := 1000
	if cs := os.Getenv("CHUNK_SIZE"); cs != "" {
		if val, err := strconv.Atoi(cs); err == nil && val > 0 {
			chunkSize = val
		}
	}

	messageTTL := 30 * time.Minute
	if ttl := os.Getenv("MESSAGE_TTL"); ttl != "" {
		if val, err := strconv.Atoi(ttl); err == nil && val > 0 {
			messageTTL = time.Duration(val) * time.Second
		}
	}

	maxWorkers := 10
	if mw := os.Getenv("MAX_WORKERS"); mw != "" {
		if val, err := strconv.Atoi(mw); err == nil && val > 0 {
			maxWorkers = val
		}
	}

	minWorkers := 2
	if miw := os.Getenv("MIN_WORKERS"); miw != "" {
		if val, err := strconv.Atoi(miw); err == nil && val > 0 {
			minWorkers = val
		}
	}

	queueLengthHigh := 1000
	if qlh := os.Getenv("QUEUE_LENGTH_HIGH"); qlh != "" {
		if val, err := strconv.Atoi(qlh); err == nil && val > 0 {
			queueLengthHigh = val
		}
	}

	queueLengthLow := 100
	if qll := os.Getenv("QUEUE_LENGTH_LOW"); qll != "" {
		if val, err := strconv.Atoi(qll); err == nil && val > 0 {
			queueLengthLow = val
		}
	}

	scalingInterval := 10 * time.Second
	if si := os.Getenv("SCALING_INTERVAL"); si != "" {
		if val, err := strconv.Atoi(si); err == nil && val > 0 {
			scalingInterval = time.Duration(val) * time.Second
		}
	}

	minHashSeed := int64(42)
	if seed := os.Getenv("MINHASH_SEED"); seed != "" {
		if val, err := strconv.ParseInt(seed, 10, 64); err == nil {
			minHashSeed = val
		}
	}

	minHashPerm := 128
	if perm := os.Getenv("MINHASH_PERM"); perm != "" {
		if val, err := strconv.Atoi(perm); err == nil && val > 0 {
			minHashPerm = val
		}
	}

	minHashThreshold := 0.3
	if th := os.Getenv("MINHASH_THRESHOLD"); th != "" {
		if val, err := strconv.ParseFloat(th, 64); err == nil && val > 0 && val <= 1 {
			minHashThreshold = val
		}
	}

	return &Config{
		RabbitMQURL:      getEnv("RABBITMQ_URL", "amqp://guest:guest@localhost:5672/"),
		PostgresURL:      getEnv("POSTGRES_URL", "postgres://gene_user:gene_password@localhost:5432/gene_db?sslmode=disable"),
		RedisURL:         getEnv("REDIS_URL", "redis://localhost:6379/0"),
		ElasticsearchURL: getEnv("ELASTICSEARCH_URL", "http://localhost:9200"),
		APIPort:          getEnv("API_PORT", "8080"),
		ChunkSize:        chunkSize,
		MessageTTL:       messageTTL,
		MaxWorkers:       maxWorkers,
		MinWorkers:       minWorkers,
		QueueLengthHigh:  queueLengthHigh,
		QueueLengthLow:   queueLengthLow,
		ScalingInterval:  scalingInterval,
		MinHashSeed:      minHashSeed,
		MinHashPerm:      minHashPerm,
		MinHashThreshold: minHashThreshold,
	}
}

func getEnv(key, defaultValue string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return defaultValue
}
