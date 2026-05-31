package service

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"task-scheduler-gateway/internal/model"

	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

const (
	dagCacheKey = "dag:adj:v1"
	dagCacheTTL = 5 * time.Minute
)

type DependencyService struct {
	db         *gorm.DB
	redis      *redis.Client
	logger     *zap.Logger
}

func NewDependencyService(db *gorm.DB, redis *redis.Client, logger *zap.Logger) *DependencyService {
	return &DependencyService{
		db:     db,
		redis:  redis,
		logger: logger,
	}
}

func (s *DependencyService) AutoMigrate() error {
	return s.db.AutoMigrate(&model.TaskDependency{}, &model.Task{})
}

func (s *DependencyService) AddDependencies(ctx context.Context, taskID int64, dependsOnIDs []int64) error {
	if len(dependsOnIDs) == 0 {
		return nil
	}

	if err := s.CheckCycleIncremental(ctx, taskID, dependsOnIDs); err != nil {
		return err
	}

	deps := make([]model.TaskDependency, 0, len(dependsOnIDs))
	for _, depID := range dependsOnIDs {
		deps = append(deps, model.TaskDependency{
			TaskID:      taskID,
			DependsOnID: depID,
		})
	}

	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&deps).Error; err != nil {
			return fmt.Errorf("failed to insert dependencies: %w", err)
		}
		if err := s.invalidateCache(ctx); err != nil {
			s.logger.Warn("failed to invalidate dag cache after insert", zap.Error(err))
		}
		return nil
	})
}

func (s *DependencyService) CheckCycleIncremental(ctx context.Context, taskID int64, newDependsOn []int64) error {
	adj, err := s.getAdjacencyMap(ctx)
	if err != nil {
		return fmt.Errorf("failed to load adjacency map: %w", err)
	}

	for _, depID := range newDependsOn {
		if depID == taskID {
			return fmt.Errorf("task %d cannot depend on itself", taskID)
		}
		if s.hasPathBFS(adj, depID, taskID) {
			return fmt.Errorf("circular dependency detected: adding edge %d->%d creates cycle (path exists from %d to %d)",
				taskID, depID, depID, taskID)
		}
		adj[taskID] = append(adj[taskID], depID)
	}

	return nil
}

func (s *DependencyService) hasPathBFS(adj map[int64][]int64, start, target int64) bool {
	if start == target {
		return true
	}

	visited := make(map[int64]bool)
	queue := make([]int64, 0, 32)
	queue = append(queue, start)
	visited[start] = true

	for len(queue) > 0 {
		node := queue[0]
		queue = queue[1:]

		for _, neighbor := range adj[node] {
			if neighbor == target {
				return true
			}
			if !visited[neighbor] {
				visited[neighbor] = true
				queue = append(queue, neighbor)
			}
		}
	}

	return false
}

func (s *DependencyService) getAdjacencyMap(ctx context.Context) (map[int64][]int64, error) {
	adj, err := s.loadAdjFromCache(ctx)
	if err == nil {
		return adj, nil
	}
	s.logger.Debug("dag cache miss, loading from db", zap.Error(err))

	adj, err = s.loadAdjFromDB(ctx)
	if err != nil {
		return nil, err
	}

	if err := s.saveAdjToCache(ctx, adj); err != nil {
		s.logger.Warn("failed to save adjacency map to cache", zap.Error(err))
	}

	return adj, nil
}

func (s *DependencyService) loadAdjFromDB(ctx context.Context) (map[int64][]int64, error) {
	var deps []model.TaskDependency
	if err := s.db.WithContext(ctx).Find(&deps).Error; err != nil {
		return nil, fmt.Errorf("failed to load dependencies from db: %w", err)
	}

	adj := make(map[int64][]int64, len(deps))
	for _, d := range deps {
		adj[d.TaskID] = append(adj[d.TaskID], d.DependsOnID)
	}

	s.logger.Info("loaded adjacency map from db", zap.Int("nodes", len(adj)), zap.Int("edges", len(deps)))
	return adj, nil
}

func (s *DependencyService) loadAdjFromCache(ctx context.Context) (map[int64][]int64, error) {
	data, err := s.redis.HGetAll(ctx, dagCacheKey).Result()
	if err != nil {
		return nil, err
	}
	if len(data) == 0 {
		return nil, fmt.Errorf("cache empty")
	}

	adj := make(map[int64][]int64, len(data))
	for taskIDStr, depsJSON := range data {
		var taskID int64
		if _, err := fmt.Sscan(taskIDStr, &taskID); err != nil {
			continue
		}
		var deps []int64
		if err := json.Unmarshal([]byte(depsJSON), &deps); err != nil {
			continue
		}
		adj[taskID] = deps
	}

	_ = s.redis.Expire(ctx, dagCacheKey, dagCacheTTL)
	return adj, nil
}

func (s *DependencyService) saveAdjToCache(ctx context.Context, adj map[int64][]int64) error {
	if len(adj) == 0 {
		return nil
	}

	pipe := s.redis.Pipeline()
	for taskID, deps := range adj {
		data, err := json.Marshal(deps)
		if err != nil {
			continue
		}
		pipe.HSet(ctx, dagCacheKey, fmt.Sprintf("%d", taskID), data)
	}
	pipe.Expire(ctx, dagCacheKey, dagCacheTTL)
	_, err := pipe.Exec(ctx)
	return err
}

func (s *DependencyService) invalidateCache(ctx context.Context) error {
	s.logger.Debug("invalidating dag cache")
	return s.redis.Del(ctx, dagCacheKey).Err()
}

func (s *DependencyService) GetDependencies(ctx context.Context, taskID int64) ([]int64, error) {
	var deps []model.TaskDependency
	if err := s.db.WithContext(ctx).Where("task_id = ?", taskID).Find(&deps).Error; err != nil {
		return nil, err
	}
	result := make([]int64, 0, len(deps))
	for _, d := range deps {
		result = append(result, d.DependsOnID)
	}
	return result, nil
}

func (s *DependencyService) ValidateDependencies(ctx context.Context, taskID int64, dependsOnIDs []int64) error {
	if len(dependsOnIDs) == 0 {
		return nil
	}

	for _, depID := range dependsOnIDs {
		if depID == taskID {
			return fmt.Errorf("task %d cannot depend on itself", taskID)
		}
	}

	var count int64
	s.db.WithContext(ctx).Model(&model.Task{}).Where("id IN ?", dependsOnIDs).Count(&count)
	if count != int64(len(dependsOnIDs)) {
		return fmt.Errorf("one or more dependency tasks do not exist")
	}

	return nil
}
