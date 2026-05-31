package config

import (
	"log"
	"os"
	"strconv"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	ServerPort          string
	PostgresHost        string
	PostgresPort        string
	PostgresUser        string
	PostgresPassword    string
	PostgresDB          string
	RedisHost           string
	RedisPort           string
	RedisPassword       string
	RedisDB             int
	GridSize            int
	TickInterval        time.Duration
	GameMinutesPerTick  int
}

func Load() *Config {
	err := godotenv.Load()
	if err != nil {
		log.Println("Warning: .env file not found, using default values")
	}

	gridSize, _ := strconv.Atoi(getEnv("GRID_SIZE", "200"))
	redisDB, _ := strconv.Atoi(getEnv("REDIS_DB", "0"))
	gameMinutesPerTick, _ := strconv.Atoi(getEnv("GAME_MINUTES_PER_TICK", "1"))
	tickInterval, _ := time.ParseDuration(getEnv("TICK_INTERVAL", "1s"))

	return &Config{
		ServerPort:         getEnv("SERVER_PORT", "8080"),
		PostgresHost:       getEnv("POSTGRES_HOST", "localhost"),
		PostgresPort:       getEnv("POSTGRES_PORT", "5432"),
		PostgresUser:       getEnv("POSTGRES_USER", "citybuilder"),
		PostgresPassword:   getEnv("POSTGRES_PASSWORD", "citybuilder123"),
		PostgresDB:         getEnv("POSTGRES_DB", "citybuilder"),
		RedisHost:          getEnv("REDIS_HOST", "localhost"),
		RedisPort:          getEnv("REDIS_PORT", "6379"),
		RedisPassword:      getEnv("REDIS_PASSWORD", ""),
		RedisDB:            redisDB,
		GridSize:           gridSize,
		TickInterval:       tickInterval,
		GameMinutesPerTick: gameMinutesPerTick,
	}
}

func getEnv(key, defaultValue string) string {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	return value
}
