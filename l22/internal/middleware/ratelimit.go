package middleware

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"task-scheduler-gateway/internal/config"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

type TokenBucketLimiter struct {
	client   *redis.Client
	capacity int
	rate     int
}

func NewTokenBucketLimiter(client *redis.Client, cfg *config.RateLimitConfig) *TokenBucketLimiter {
	return &TokenBucketLimiter{
		client:   client,
		capacity: cfg.Capacity,
		rate:     cfg.Rate,
	}
}

func (l *TokenBucketLimiter) Allow(ctx context.Context, key string) (bool, error) {
	now := time.Now().UnixMicro()
	bucketKey := fmt.Sprintf("ratelimit:%s", key)

	script := redis.NewScript(`
		local key = KEYS[1]
		local capacity = tonumber(ARGV[1])
		local rate = tonumber(ARGV[2])
		local now = tonumber(ARGV[3])

		local data = redis.call("HMGET", key, "tokens", "last_time")
		local tokens = tonumber(data[1])
		local last_time = tonumber(data[2])

		if tokens == nil then
			tokens = capacity
			last_time = now
		end

		local elapsed = now - last_time
		local refill = math.floor(elapsed * rate / 1000000)
		if refill > 0 then
			tokens = math.min(capacity, tokens + refill)
			last_time = now
		end

		if tokens >= 1 then
			tokens = tokens - 1
			redis.call("HMSET", key, "tokens", tokens, "last_time", last_time)
			redis.call("EXPIRE", key, math.ceil(capacity / rate) + 1)
			return 1
		else
			redis.call("HMSET", key, "tokens", tokens, "last_time", last_time)
			return 0
		end
	`)

	result, err := script.Run(ctx, l.client, []string{bucketKey}, l.capacity, l.rate, now).Int()
	if err != nil {
		return false, err
	}
	return result == 1, nil
}

func RateLimit(limiter *TokenBucketLimiter) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, exists := c.Get("user_id")
		if !exists {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			c.Abort()
			return
		}

		key := strconv.FormatInt(userID.(int64), 10)
		allowed, err := limiter.Allow(c.Request.Context(), key)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "rate limiter error"})
			c.Abort()
			return
		}

		if !allowed {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error": "rate limit exceeded",
				"limit": fmt.Sprintf("%d requests per second", limiter.rate),
			})
			c.Abort()
			return
		}

		c.Next()
	}
}
