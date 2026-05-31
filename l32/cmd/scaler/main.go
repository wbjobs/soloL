package main

import (
	"log"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"gene-alignment/pkg/config"
	"gene-alignment/pkg/rabbitmq"
	redisclient "gene-alignment/pkg/redis"
)

type Scaler struct {
	cfg         *config.Config
	redisClient *redisclient.Client
	mqClient    *rabbitmq.Client
	useDocker   bool
}

func main() {
	cfg := config.Load()

	log.Println("Auto-scaler starting...")

	useDocker := checkDockerAvailable()
	if !useDocker {
		log.Println("Docker not available, running in advisory mode only")
	}

	redisClient, err := redisclient.NewClient(cfg.RedisURL)
	if err != nil {
		log.Fatalf("Failed to connect to Redis: %v", err)
	}
	defer redisClient.Close()

	mqClient, err := rabbitmq.NewClient(cfg.RabbitMQURL, cfg.MessageTTL)
	if err != nil {
		log.Fatalf("Failed to connect to RabbitMQ: %v", err)
	}
	defer mqClient.Close()

	scaler := &Scaler{
		cfg:         cfg,
		redisClient: redisClient,
		mqClient:    mqClient,
		useDocker:   useDocker,
	}

	scaler.run()
}

func checkDockerAvailable() bool {
	if runtime.GOOS == "windows" {
		return false
	}

	cmd := exec.Command("docker", "info")
	if err := cmd.Run(); err != nil {
		return false
	}
	return true
}

func (s *Scaler) run() {
	ticker := time.NewTicker(s.cfg.ScalingInterval)
	defer ticker.Stop()

	log.Printf("Auto-scaler started. Min workers: %d, Max workers: %d", s.cfg.MinWorkers, s.cfg.MaxWorkers)
	log.Printf("Scaling thresholds - High: %d, Low: %d", s.cfg.QueueLengthHigh, s.cfg.QueueLengthLow)
	log.Printf("Docker integration: %v", s.useDocker)

	for range ticker.C {
		s.scale()
	}
}

func (s *Scaler) scale() {
	queueLen, err := s.mqClient.GetQueueLength()
	if err != nil {
		log.Printf("Failed to get queue length: %v", err)
		return
	}

	workerCount, err := s.redisClient.GetWorkerCount()
	if err != nil {
		log.Printf("Failed to get worker count: %v", err)
		return
	}

	log.Printf("Queue length: %d, Active workers: %d", queueLen, workerCount)

	desiredWorkers := workerCount

	if queueLen > s.cfg.QueueLengthHigh && workerCount < s.cfg.MaxWorkers {
		desiredWorkers = min(workerCount+2, s.cfg.MaxWorkers)
		log.Printf("Queue length high (%d > %d), scaling up to %d workers",
			queueLen, s.cfg.QueueLengthHigh, desiredWorkers)
		s.scaleUp(desiredWorkers - workerCount)
	} else if queueLen < s.cfg.QueueLengthLow && workerCount > s.cfg.MinWorkers {
		desiredWorkers = max(workerCount-1, s.cfg.MinWorkers)
		log.Printf("Queue length low (%d < %d), scaling down to %d workers",
			queueLen, s.cfg.QueueLengthLow, desiredWorkers)
		s.scaleDown(workerCount - desiredWorkers)
	}

	s.redisClient.UpdateQueueLength(rabbitmq.TaskQueueName, queueLen)
}

func (s *Scaler) scaleUp(count int) {
	decision := "scale_up:" + string(rune(count+'0'))
	s.redisClient.SetScalingDecision(decision)

	if !s.useDocker {
		log.Printf("ADVISORY: Need to scale up %d workers. Manual action required or use Docker Compose.", count)
		log.Printf("  Run: docker-compose up -d --scale worker=%d", getCurrentWorkerCount()+count)
		return
	}

	for i := 0; i < count; i++ {
		go s.startWorker()
	}
}

func (s *Scaler) scaleDown(count int) {
	decision := "scale_down:" + string(rune(count+'0'))
	s.redisClient.SetScalingDecision(decision)

	if !s.useDocker {
		log.Printf("ADVISORY: Need to scale down %d workers. Manual action required or use Docker Compose.", count)
		log.Printf("  Run: docker-compose up -d --scale worker=%d", max(getCurrentWorkerCount()-count, s.cfg.MinWorkers))
		return
	}

	containers := s.listWorkerContainers()
	stopped := 0
	for _, c := range containers {
		if stopped >= count {
			break
		}
		go s.stopWorker(c)
		stopped++
	}
}

func (s *Scaler) startWorker() {
	cmd := exec.Command("docker-compose", "up", "-d", "--no-recreate", "worker")
	cmd.Dir = "."
	if err := cmd.Run(); err != nil {
		log.Printf("Failed to start worker: %v", err)
	} else {
		log.Println("Started new worker instance")
	}
}

func (s *Scaler) stopWorker(containerID string) {
	cmd := exec.Command("docker", "stop", "-t", "10", containerID)
	if err := cmd.Run(); err != nil {
		log.Printf("Failed to stop worker %s: %v", containerID, err)
	} else {
		log.Printf("Stopped worker: %s", containerID[:12])
	}
}

func (s *Scaler) listWorkerContainers() []string {
	cmd := exec.Command("docker", "ps", "--filter", "name=worker", "--format", "{{.ID}}")
	output, err := cmd.Output()
	if err != nil {
		return nil
	}

	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	var containers []string
	for _, line := range lines {
		if line != "" {
			containers = append(containers, line)
		}
	}
	return containers
}

func getCurrentWorkerCount() int {
	cmd := exec.Command("docker", "ps", "--filter", "name=worker", "-q")
	output, err := cmd.Output()
	if err != nil {
		return 0
	}
	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	count := 0
	for _, line := range lines {
		if line != "" {
			count++
		}
	}
	return count
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
