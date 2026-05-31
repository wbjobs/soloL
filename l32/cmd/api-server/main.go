package main

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gene-alignment/pkg/config"
	"gene-alignment/pkg/database"
	"gene-alignment/pkg/elasticsearch"
	"gene-alignment/pkg/rabbitmq"
	redisclient "gene-alignment/pkg/redis"
)

type Server struct {
	db          *database.DB
	redisClient *redisclient.Client
	mqClient    *rabbitmq.Client
	esClient    *elasticsearch.Client
	cfg         *config.Config
}

func main() {
	cfg := config.Load()

	db, err := database.NewDB(cfg.PostgresURL)
	if err != nil {
		panic("Failed to connect to database: " + err.Error())
	}
	defer db.Close()

	redisClient, err := redisclient.NewClient(cfg.RedisURL)
	if err != nil {
		panic("Failed to connect to Redis: " + err.Error())
	}
	defer redisClient.Close()

	mqClient, err := rabbitmq.NewClient(cfg.RabbitMQURL, cfg.MessageTTL)
	if err != nil {
		panic("Failed to connect to RabbitMQ: " + err.Error())
	}
	defer mqClient.Close()

	esClient, err := elasticsearch.NewClient(cfg.ElasticsearchURL)
	if err != nil {
		panic("Failed to connect to Elasticsearch: " + err.Error())
	}
	defer esClient.Close()

	server := &Server{
		db:          db,
		redisClient: redisClient,
		mqClient:    mqClient,
		esClient:    esClient,
		cfg:         cfg,
	}

	r := gin.Default()

	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	})

	api := r.Group("/api")
	{
		api.GET("/tasks/:id/status", server.getTaskStatus)
		api.GET("/tasks/:id/progress", server.getTaskProgressSSE)
		api.GET("/tasks/:id/top", server.getTopKResults)
		api.POST("/tasks/:id/cancel", server.cancelTask)
		api.GET("/health", server.healthCheck)
		api.GET("/system/status", server.getSystemStatus)
	}

	r.Run(":" + cfg.APIPort)
}

func (s *Server) healthCheck(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status": "healthy",
	})
}

func (s *Server) getTaskStatus(c *gin.Context) {
	taskIDStr := c.Param("id")
	taskID, err := uuid.Parse(taskIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid task ID format",
		})
		return
	}

	status, err := s.db.GetTaskStatus(taskID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"error": "Task not found",
		})
		return
	}

	cancelled, _ := s.redisClient.IsTaskCancelled(taskIDStr)

	c.JSON(http.StatusOK, gin.H{
		"task_id":          status.TaskID,
		"status":           status.Status,
		"progress":         status.Progress,
		"total_chunks":     status.TotalChunks,
		"completed_chunks": status.CompletedChunks,
		"cancelled":        cancelled,
	})
}

func (s *Server) getTopKResults(c *gin.Context) {
	taskIDStr := c.Param("id")
	taskID, err := uuid.Parse(taskIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid task ID format",
		})
		return
	}

	kStr := c.DefaultQuery("k", "10")
	k, err := strconv.Atoi(kStr)
	if err != nil || k <= 0 {
		k = 10
	}

	results, err := s.db.GetTopKResults(taskID, k)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to get results",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"task_id": taskID,
		"count":   len(results),
		"results": results,
	})
}

func (s *Server) cancelTask(c *gin.Context) {
	taskIDStr := c.Param("id")
	_, err := uuid.Parse(taskIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid task ID format",
		})
		return
	}

	if err := s.redisClient.CancelTask(taskIDStr); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to cancel task",
		})
		return
	}

	s.mqClient.PurgeQueue()

	if err := s.db.UpdateTaskStatus(uuid.MustParse(taskIDStr), "cancelled"); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to update task status",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"task_id":  taskIDStr,
		"status":   "cancelled",
		"message":  "Task cancellation requested. Workers will stop processing new tasks.",
	})
}

func (s *Server) getTaskProgressSSE(c *gin.Context) {
	taskIDStr := c.Param("id")
	_, err := uuid.Parse(taskIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid task ID format",
		})
		return
	}

	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.Header().Set("Access-Control-Allow-Origin", "*")

	pubsub := s.redisClient.SubscribeProgress(taskIDStr)
	defer pubsub.Close()

	ch := pubsub.Channel()

	clientGone := c.Request.Context().Done()

	c.SSEvent("message", gin.H{
		"type": "connected",
		"task_id": taskIDStr,
		"timestamp": time.Now().Unix(),
	})
	c.Writer.Flush()

	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-clientGone:
			return
		case <-ticker.C:
			c.SSEvent("heartbeat", gin.H{
				"timestamp": time.Now().Unix(),
			})
			c.Writer.Flush()
		case msg, ok := <-ch:
			if !ok {
				return
			}
			c.SSEvent("progress", msg.Payload)
			c.Writer.Flush()
		}
	}
}

func (s *Server) getSystemStatus(c *gin.Context) {
	queueLen, err := s.mqClient.GetQueueLength()
	if err != nil {
		queueLen = -1
	}

	consumerCount, err := s.mqClient.GetConsumerCount()
	if err != nil {
		consumerCount = -1
	}

	workerCount, err := s.redisClient.GetWorkerCount()
	if err != nil {
		workerCount = -1
	}

	c.JSON(http.StatusOK, gin.H{
		"queue": gin.H{
			"length":         queueLen,
			"consumer_count": consumerCount,
			"high_threshold": s.cfg.QueueLengthHigh,
			"low_threshold":  s.cfg.QueueLengthLow,
		},
		"workers": gin.H{
			"active_count": workerCount,
			"min_workers":  s.cfg.MinWorkers,
			"max_workers":  s.cfg.MaxWorkers,
		},
		"config": gin.H{
			"chunk_size":       s.cfg.ChunkSize,
			"message_ttl_sec":  s.cfg.MessageTTL.Seconds(),
			"minhash_enabled":  s.esClient != nil,
			"minhash_threshold": s.cfg.MinHashThreshold,
		},
	})
}
