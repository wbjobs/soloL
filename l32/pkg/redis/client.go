package redis

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
	"gene-alignment/pkg/models"
)

const (
	FileMD5Prefix     = "file:md5:"
	FileChunksPrefix  = "file:chunks:"
	FileTaskPrefix    = "file:task:"
	TaskCancelPrefix  = "task:cancel:"
	TaskProgressPrefix = "task:progress:"
	DefaultTTL        = 24 * time.Hour
)

type Client struct {
	rdb *redis.Client
	ctx context.Context
}

func NewClient(url string) (*Client, error) {
	opts, err := redis.ParseURL(url)
	if err != nil {
		return nil, fmt.Errorf("failed to parse Redis URL: %w", err)
	}

	rdb := redis.NewClient(opts)
	ctx := context.Background()

	if err := rdb.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("failed to connect to Redis: %w", err)
	}

	return &Client{
		rdb: rdb,
		ctx: ctx,
	}, nil
}

func (c *Client) Close() {
	c.rdb.Close()
}

func (c *Client) GetCachedTaskID(md5 string) (string, bool, error) {
	key := FileMD5Prefix + md5
	taskID, err := c.rdb.Get(c.ctx, key).Result()
	if err == redis.Nil {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return taskID, true, nil
}

func (c *Client) CacheFileMD5(md5, taskID string) error {
	key := FileMD5Prefix + md5
	return c.rdb.Set(c.ctx, key, taskID, DefaultTTL).Err()
}

func (c *Client) CacheFileChunks(md5 string, chunks []models.SequenceChunk) error {
	key := FileChunksPrefix + md5
	data, err := json.Marshal(chunks)
	if err != nil {
		return fmt.Errorf("failed to marshal chunks: %w", err)
	}
	return c.rdb.Set(c.ctx, key, data, DefaultTTL).Err()
}

func (c *Client) GetCachedChunks(md5 string) ([]models.SequenceChunk, bool, error) {
	key := FileChunksPrefix + md5
	data, err := c.rdb.Get(c.ctx, key).Bytes()
	if err == redis.Nil {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}

	var chunks []models.SequenceChunk
	if err := json.Unmarshal(data, &chunks); err != nil {
		return nil, false, fmt.Errorf("failed to unmarshal chunks: %w", err)
	}
	return chunks, true, nil
}

func (c *Client) SetFileProcessing(md5 string) (bool, error) {
	key := FileTaskPrefix + md5 + ":lock"
	ok, err := c.rdb.SetNX(c.ctx, key, "processing", 5*time.Minute).Result()
	if err != nil {
		return false, err
	}
	return ok, nil
}

func (c *Client) ReleaseFileLock(md5 string) error {
	key := FileTaskPrefix + md5 + ":lock"
	return c.rdb.Del(c.ctx, key).Err()
}

func (c *Client) GetQueueLength(queueName string) (int, error) {
	key := "rabbitmq:queue:" + queueName
	len, err := c.rdb.Get(c.ctx, key).Int()
	if err == redis.Nil {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	return len, nil
}

func (c *Client) UpdateQueueLength(queueName string, length int) error {
	key := "rabbitmq:queue:" + queueName
	return c.rdb.Set(c.ctx, key, length, 30*time.Second).Err()
}

func (c *Client) GetWorkerCount() (int, error) {
	workers, err := c.rdb.SMembers(c.ctx, "workers:active").Result()
	if err != nil {
		return 0, err
	}
	return len(workers), nil
}

func (c *Client) RegisterWorker(workerID string) error {
	return c.rdb.SAdd(c.ctx, "workers:active", workerID).Err()
}

func (c *Client) UnregisterWorker(workerID string) error {
	return c.rdb.SRem(c.ctx, "workers:active", workerID).Err()
}

func (c *Client) GetScalingDecision() (string, error) {
	return c.rdb.Get(c.ctx, "scaling:decision").Result()
}

func (c *Client) SetScalingDecision(decision string) error {
	return c.rdb.Set(c.ctx, "scaling:decision", decision, 10*time.Second).Err()
}

func (c *Client) CancelTask(taskID string) error {
	key := TaskCancelPrefix + taskID
	return c.rdb.Set(c.ctx, key, "true", 24*time.Hour).Err()
}

func (c *Client) IsTaskCancelled(taskID string) (bool, error) {
	key := TaskCancelPrefix + taskID
	exists, err := c.rdb.Exists(c.ctx, key).Result()
	if err != nil {
		return false, err
	}
	return exists > 0, nil
}

func (c *Client) UpdateChunkProgress(taskID string, chunkIndex int, progress float64) error {
	key := TaskProgressPrefix + taskID
	field := fmt.Sprintf("chunk:%d", chunkIndex)
	return c.rdb.HSet(c.ctx, key, field, progress).Err()
}

func (c *Client) GetTaskProgress(taskID string) (map[string]float64, error) {
	key := TaskProgressPrefix + taskID
	result, err := c.rdb.HGetAll(c.ctx, key).Result()
	if err != nil {
		return nil, err
	}

	progress := make(map[string]float64)
	for k, v := range result {
		if val, err := strconv.ParseFloat(v, 64); err == nil {
			progress[k] = val
		}
	}
	return progress, nil
}

func (c *Client) ClearTaskProgress(taskID string) error {
	key := TaskProgressPrefix + taskID
	return c.rdb.Del(c.ctx, key).Err()
}

func (c *Client) PublishProgress(taskID string, message string) error {
	channel := "progress:" + taskID
	return c.rdb.Publish(c.ctx, channel, message).Err()
}

func (c *Client) SubscribeProgress(taskID string) *redis.PubSub {
	channel := "progress:" + taskID
	return c.rdb.Subscribe(c.ctx, channel)
}
