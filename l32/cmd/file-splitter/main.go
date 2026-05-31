package main

import (
	"flag"
	"fmt"
	"log"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	"gene-alignment/pkg/config"
	"gene-alignment/pkg/database"
	"gene-alignment/pkg/elasticsearch"
	"gene-alignment/pkg/fasta"
	"gene-alignment/pkg/minhash"
	"gene-alignment/pkg/models"
	"gene-alignment/pkg/rabbitmq"
	redisclient "gene-alignment/pkg/redis"
	"gene-alignment/pkg/utils"
)

func main() {
	filePath := flag.String("file", "", "Path to FASTA file")
	flag.Parse()

	if *filePath == "" {
		log.Fatal("Please provide a FASTA file path using -file flag")
	}

	cfg := config.Load()

	log.Printf("Processing file: %s", *filePath)

	md5, err := utils.CalculateMD5(*filePath)
	if err != nil {
		log.Fatalf("Failed to calculate MD5: %v", err)
	}
	log.Printf("File MD5: %s", md5)

	redisClient, err := redisclient.NewClient(cfg.RedisURL)
	if err != nil {
		log.Printf("Warning: Redis connection failed, proceeding without cache: %v", err)
		processWithoutCache(*filePath, md5, cfg)
		return
	}
	defer redisClient.Close()

	if cachedTaskID, exists, err := redisClient.GetCachedTaskID(md5); err == nil && exists {
		log.Printf("File already processed! Found cached Task ID: %s", cachedTaskID)
		fmt.Printf("\nTask ID (from cache): %s\n", cachedTaskID)
		fmt.Println("\nUse the following API endpoints:")
		fmt.Printf("  GET  /api/tasks/%s/status    - Check task status\n", cachedTaskID)
		fmt.Printf("  GET  /api/tasks/%s/progress  - SSE progress stream\n", cachedTaskID)
		fmt.Printf("  GET  /api/tasks/%s/top?k=10  - Get top 10 similar sequences\n", cachedTaskID)
		fmt.Printf("  POST /api/tasks/%s/cancel    - Cancel the task\n", cachedTaskID)
		return
	}

	acquired, err := redisClient.SetFileProcessing(md5)
	if err != nil {
		log.Printf("Warning: Failed to acquire lock, proceeding without deduplication: %v", err)
		processWithoutCache(*filePath, md5, cfg)
		return
	}
	if !acquired {
		log.Printf("File is currently being processed by another instance, waiting...")
		for i := 0; i < 30; i++ {
			time.Sleep(2 * time.Second)
			if cachedTaskID, exists, _ := redisClient.GetCachedTaskID(md5); exists {
				log.Printf("File processing completed! Task ID: %s", cachedTaskID)
				fmt.Printf("\nTask ID (from cache): %s\n", cachedTaskID)
				fmt.Println("\nUse the following API endpoints:")
				fmt.Printf("  GET  /api/tasks/%s/status    - Check task status\n", cachedTaskID)
				fmt.Printf("  GET  /api/tasks/%s/progress  - SSE progress stream\n", cachedTaskID)
				fmt.Printf("  GET  /api/tasks/%s/top?k=10  - Get top 10 similar sequences\n", cachedTaskID)
				fmt.Printf("  POST /api/tasks/%s/cancel    - Cancel the task\n", cachedTaskID)
				return
			}
		}
		log.Printf("Timeout waiting for other instance, proceeding with processing")
		processWithoutCache(*filePath, md5, cfg)
		return
	}
	defer redisClient.ReleaseFileLock(md5)

	taskID := uuid.New()
	filename := filepath.Base(*filePath)
	log.Printf("New Task ID: %s", taskID)

	minHasher := minhash.NewMinHash(cfg.MinHashPerm, cfg.MinHashSeed)

	var chunks []models.SequenceChunk
	var esDocs []elasticsearch.SequenceDocument

	if cachedChunks, exists, err := redisClient.GetCachedChunks(md5); err == nil && exists {
		log.Printf("Found cached chunks (%d chunks), reusing...", len(cachedChunks))
		for i := range cachedChunks {
			cachedChunks[i].TaskID = taskID
			cachedChunks[i].ChunkID = uuid.New()
		}
		chunks = cachedChunks
	} else {
		chunks, err = fasta.ProcessFile(*filePath, cfg.ChunkSize, taskID)
		if err != nil {
			log.Fatalf("Failed to process FASTA file: %v", err)
		}
		if err := redisClient.CacheFileChunks(md5, chunks); err != nil {
			log.Printf("Warning: Failed to cache chunks: %v", err)
		}
	}

	log.Printf("Created %d chunks", len(chunks))

	for _, chunk := range chunks {
		signature := minHasher.ComputeSignature(chunk.SequenceData)
		esDocs = append(esDocs, elasticsearch.SequenceDocument{
			ChunkID:     chunk.ChunkID.String(),
			TaskID:      taskID.String(),
			Header:      chunk.SequenceHeader,
			Signature:   signature,
			SequenceLen: len(chunk.SequenceData),
		})
	}

	esClient, err := elasticsearch.NewClient(cfg.ElasticsearchURL)
	if err != nil {
		log.Printf("Warning: Elasticsearch connection failed, proceeding without MinHash filtering: %v", err)
	} else {
		defer esClient.Close()
		log.Printf("Indexing %d MinHash signatures to Elasticsearch...", len(esDocs))
		if err := esClient.BulkIndex(esDocs); err != nil {
			log.Printf("Warning: Failed to index to Elasticsearch: %v", err)
		} else {
			log.Printf("Successfully indexed MinHash signatures")
		}
	}

	db, err := database.NewDB(cfg.PostgresURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	totalPairs := len(chunks) * (len(chunks) - 1) / 2
	if err := db.CreateTask(taskID, filename, totalPairs); err != nil {
		log.Fatalf("Failed to create task: %v", err)
	}

	for _, chunk := range chunks {
		if err := db.InsertChunk(chunk); err != nil {
			log.Fatalf("Failed to insert chunk: %v", err)
		}
	}

	redisClient.ClearTaskProgress(taskID.String())

	mq, err := rabbitmq.NewClient(cfg.RabbitMQURL, cfg.MessageTTL)
	if err != nil {
		log.Fatalf("Failed to connect to RabbitMQ: %v", err)
	}
	defer mq.Close()

	published := 0
	batchSize := 100
	for i := 0; i < len(chunks); i++ {
		for j := i + 1; j < len(chunks); j++ {
			msg := models.AlignmentTaskMessage{
				TaskID:   taskID,
				ChunkA:   chunks[i],
				ChunkB:   chunks[j],
			}
			if err := mq.PublishTask(msg); err != nil {
				log.Printf("Failed to publish task: %v", err)
				continue
			}
			published++

			if published%batchSize == 0 {
				queueLen, _ := mq.GetQueueLength()
				log.Printf("Published %d tasks, queue length: %d", published, queueLen)
				if queueLen > 5000 {
					log.Printf("Queue length high (%d), slowing down publishing...", queueLen)
					time.Sleep(1 * time.Second)
				}
			}
		}
	}

	if err := redisClient.CacheFileMD5(md5, taskID.String()); err != nil {
		log.Printf("Warning: Failed to cache file MD5: %v", err)
	}

	log.Printf("Published %d alignment tasks to queue", published)
	fmt.Printf("\nTask ID: %s\n", taskID)
	fmt.Printf("Total chunks: %d\n", len(chunks))
	fmt.Printf("Total alignment pairs: %d\n", published)
	fmt.Println("\nUse the following API endpoints:")
	fmt.Printf("  GET  /api/tasks/%s/status    - Check task status\n", taskID)
	fmt.Printf("  GET  /api/tasks/%s/progress  - SSE progress stream\n", taskID)
	fmt.Printf("  GET  /api/tasks/%s/top?k=10  - Get top 10 similar sequences\n", taskID)
	fmt.Printf("  POST /api/tasks/%s/cancel    - Cancel the task\n", taskID)
}

func processWithoutCache(filePath, md5 string, cfg *config.Config) {
	taskID := uuid.New()
	filename := filepath.Base(filePath)
	log.Printf("Task ID: %s", taskID)

	minHasher := minhash.NewMinHash(cfg.MinHashPerm, cfg.MinHashSeed)

	chunks, err := fasta.ProcessFile(filePath, cfg.ChunkSize, taskID)
	if err != nil {
		log.Fatalf("Failed to process FASTA file: %v", err)
	}

	log.Printf("Created %d chunks", len(chunks))

	var esDocs []elasticsearch.SequenceDocument
	for _, chunk := range chunks {
		signature := minHasher.ComputeSignature(chunk.SequenceData)
		esDocs = append(esDocs, elasticsearch.SequenceDocument{
			ChunkID:     chunk.ChunkID.String(),
			TaskID:      taskID.String(),
			Header:      chunk.SequenceHeader,
			Signature:   signature,
			SequenceLen: len(chunk.SequenceData),
		})
	}

	esClient, err := elasticsearch.NewClient(cfg.ElasticsearchURL)
	if err == nil {
		defer esClient.Close()
		esClient.BulkIndex(esDocs)
	}

	db, err := database.NewDB(cfg.PostgresURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	totalPairs := len(chunks) * (len(chunks) - 1) / 2
	if err := db.CreateTask(taskID, filename, totalPairs); err != nil {
		log.Fatalf("Failed to create task: %v", err)
	}

	for _, chunk := range chunks {
		if err := db.InsertChunk(chunk); err != nil {
			log.Fatalf("Failed to insert chunk: %v", err)
		}
	}

	mq, err := rabbitmq.NewClient(cfg.RabbitMQURL, cfg.MessageTTL)
	if err != nil {
		log.Fatalf("Failed to connect to RabbitMQ: %v", err)
	}
	defer mq.Close()

	published := 0
	for i := 0; i < len(chunks); i++ {
		for j := i + 1; j < len(chunks); j++ {
			msg := models.AlignmentTaskMessage{
				TaskID:   taskID,
				ChunkA:   chunks[i],
				ChunkB:   chunks[j],
			}
			if err := mq.PublishTask(msg); err != nil {
				log.Printf("Failed to publish task: %v", err)
				continue
			}
			published++
		}
	}

	log.Printf("Published %d alignment tasks to queue", published)
	fmt.Printf("\nTask ID: %s\n", taskID)
	fmt.Printf("Total chunks: %d\n", len(chunks))
	fmt.Printf("Total alignment pairs: %d\n", published)
	fmt.Println("\nUse the following API endpoints:")
	fmt.Printf("  GET  /api/tasks/%s/status    - Check task status\n", taskID)
	fmt.Printf("  GET  /api/tasks/%s/progress  - SSE progress stream\n", taskID)
	fmt.Printf("  GET  /api/tasks/%s/top?k=10  - Get top 10 similar sequences\n", taskID)
	fmt.Printf("  POST /api/tasks/%s/cancel    - Cancel the task\n", taskID)
}
