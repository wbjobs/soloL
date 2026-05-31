package main

import (
	"encoding/json"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/google/uuid"
	"gene-alignment/pkg/config"
	"gene-alignment/pkg/database"
	"gene-alignment/pkg/elasticsearch"
	"gene-alignment/pkg/minhash"
	"gene-alignment/pkg/models"
	"gene-alignment/pkg/rabbitmq"
	redisclient "gene-alignment/pkg/redis"
	"gene-alignment/pkg/smithwaterman"
)

type Worker struct {
	cfg          *config.Config
	db           *database.DB
	mq           *rabbitmq.Client
	redisClient  *redisclient.Client
	esClient     *elasticsearch.Client
	minHasher    *minhash.MinHash
	workerID     string
	useMinHash   bool
}

func main() {
	cfg := config.Load()

	workerID := uuid.New().String()
	log.Printf("Worker %s starting...", workerID)

	db, err := database.NewDB(cfg.PostgresURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	mq, err := rabbitmq.NewClient(cfg.RabbitMQURL, cfg.MessageTTL)
	if err != nil {
		log.Fatalf("Failed to connect to RabbitMQ: %v", err)
	}
	defer mq.Close()

	redisClient, err := redisclient.NewClient(cfg.RedisURL)
	if err != nil {
		log.Printf("Warning: Redis connection failed, proceeding without registration: %v", err)
	} else {
		if err := redisClient.RegisterWorker(workerID); err != nil {
			log.Printf("Warning: Failed to register worker: %v", err)
		}
		defer redisClient.UnregisterWorker(workerID)
		defer redisClient.Close()
	}

	esClient, err := elasticsearch.NewClient(cfg.ElasticsearchURL)
	useMinHash := true
	if err != nil {
		log.Printf("Warning: Elasticsearch connection failed, proceeding without MinHash filtering: %v", err)
		useMinHash = false
	} else {
		defer esClient.Close()
		log.Println("MinHash filtering enabled")
	}

	minHasher := minhash.NewMinHash(cfg.MinHashPerm, cfg.MinHashSeed)

	worker := &Worker{
		cfg:         cfg,
		db:          db,
		mq:          mq,
		redisClient: redisClient,
		esClient:    esClient,
		minHasher:   minHasher,
		workerID:    workerID,
		useMinHash:  useMinHash,
	}

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigChan
		log.Printf("Worker %s received shutdown signal", workerID)
		if redisClient != nil {
			redisClient.UnregisterWorker(workerID)
		}
		os.Exit(0)
	}()

	if redisClient != nil {
		go worker.sendHeartbeat()
	}

	go worker.monitorQueue()

	log.Println("Worker started, waiting for tasks...")

	err = mq.ConsumeTasks(worker.handleTask)
	if err != nil {
		log.Fatalf("Error consuming tasks: %v", err)
	}
}

func (w *Worker) handleTask(msg models.AlignmentTaskMessage) error {
	taskIDStr := msg.TaskID.String()

	if w.redisClient != nil {
		cancelled, err := w.redisClient.IsTaskCancelled(taskIDStr)
		if err == nil && cancelled {
			log.Printf("[%s] Task %s cancelled, skipping", w.workerID, taskIDStr)
			return nil
		}
	}

	log.Printf("[%s] Processing task %s: %s vs %s",
		w.workerID,
		taskIDStr,
		msg.ChunkA.SequenceHeader,
		msg.ChunkB.SequenceHeader)

	w.publishProgress(taskIDStr, msg.ChunkA.ChunkIndex, msg.ChunkB.ChunkIndex, "started", 0)

	if w.useMinHash && w.esClient != nil {
		sigA := w.minHasher.ComputeSignature(msg.ChunkA.SequenceData)
		sigB := w.minHasher.ComputeSignature(msg.ChunkB.SequenceData)
		jaccard := w.minHasher.EstimateJaccard(sigA, sigB)

		w.publishProgress(taskIDStr, msg.ChunkA.ChunkIndex, msg.ChunkB.ChunkIndex, "minhash", 25)

		if jaccard < w.cfg.MinHashThreshold {
			log.Printf("[%s] Skipping low similarity pair (Jaccard: %.2f < %.2f)",
				w.workerID, jaccard, w.cfg.MinHashThreshold)
			w.publishProgress(taskIDStr, msg.ChunkA.ChunkIndex, msg.ChunkB.ChunkIndex, "skipped", 100)
			if err := w.db.IncrementCompletedChunks(msg.TaskID); err != nil {
				log.Printf("[%s] Failed to increment completed chunks: %v", w.workerID, err)
			}
			w.db.CheckAndFinalizeTask(msg.TaskID)
			return nil
		}

		log.Printf("[%s] MinHash passed (Jaccard: %.2f), proceeding with Smith-Waterman", w.workerID, jaccard)
	}

	w.publishProgress(taskIDStr, msg.ChunkA.ChunkIndex, msg.ChunkB.ChunkIndex, "aligning", 50)

	alignResult := smithwaterman.Align(
		msg.ChunkA.SequenceData,
		msg.ChunkB.SequenceData,
	)

	w.publishProgress(taskIDStr, msg.ChunkA.ChunkIndex, msg.ChunkB.ChunkIndex, "completed", 100)

	result := models.AlignmentResult{
		TaskID:             msg.TaskID,
		ChunkAHeader:       msg.ChunkA.SequenceHeader,
		ChunkBHeader:       msg.ChunkB.SequenceHeader,
		SimilarityScore:    float64(alignResult.Score),
		AlignmentLength:    alignResult.AlignmentLength,
		IdentityPercentage: alignResult.IdentityPercentage,
	}

	if err := w.db.InsertResult(result); err != nil {
		log.Printf("[%s] Failed to insert result: %v", w.workerID, err)
		return err
	}

	if err := w.db.IncrementCompletedChunks(msg.TaskID); err != nil {
		log.Printf("[%s] Failed to increment completed chunks: %v", w.workerID, err)
	}

	if err := w.db.CheckAndFinalizeTask(msg.TaskID); err != nil {
		log.Printf("[%s] Failed to check and finalize task: %v", w.workerID, err)
	}

	log.Printf("[%s] Completed alignment: score=%.2f, identity=%.2f%%",
		w.workerID, result.SimilarityScore, result.IdentityPercentage)

	return nil
}

func (w *Worker) publishProgress(taskID string, chunkAIdx, chunkBIdx int, status string, progress int) {
	if w.redisClient == nil {
		return
	}

	msg := map[string]interface{}{
		"worker_id":   w.workerID,
		"chunk_a_idx": chunkAIdx,
		"chunk_b_idx": chunkBIdx,
		"status":      status,
		"progress":    progress,
		"timestamp":   time.Now().Unix(),
	}

	msgBytes, err := json.Marshal(msg)
	if err != nil {
		return
	}

	w.redisClient.PublishProgress(taskID, string(msgBytes))
}

func (w *Worker) sendHeartbeat() {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		if w.redisClient != nil {
			if err := w.redisClient.RegisterWorker(w.workerID); err != nil {
				log.Printf("Warning: Failed to send heartbeat: %v", err)
			}
		}
	}
}

func (w *Worker) monitorQueue() {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		queueLen, err := w.mq.GetQueueLength()
		if err != nil {
			log.Printf("Warning: Failed to get queue length: %v", err)
			continue
		}

		if w.redisClient != nil {
			w.redisClient.UpdateQueueLength(rabbitmq.TaskQueueName, queueLen)
		}

		log.Printf("Queue status: %d messages pending", queueLen)
	}
}
