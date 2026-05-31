package service

import (
	"context"
	"fmt"

	"task-scheduler-gateway/internal/model"

	"go.uber.org/zap"
	"gorm.io/gorm"
)

type PreemptionService struct {
	db          *gorm.DB
	configCenter *ConfigCenter
	executor    *ExecutorClient
	logger      *zap.Logger
}

func NewPreemptionService(
	db *gorm.DB,
	configCenter *ConfigCenter,
	executor *ExecutorClient,
	logger *zap.Logger,
) *PreemptionService {
	return &PreemptionService{
		db:          db,
		configCenter: configCenter,
		executor:    executor,
		logger:      logger,
	}
}

func (s *PreemptionService) AutoMigrate() error {
	return s.db.AutoMigrate(&model.PreemptionLog{})
}

func (s *PreemptionService) GetSystemLoad(ctx context.Context) (float64, error) {
	var total int64
	var queued int64

	if err := s.db.WithContext(ctx).Model(&model.Task{}).
		Where("status IN ?", []string{"pending", "submitted", "running"}).Count(&total).Error; err != nil {
		return 0, fmt.Errorf("failed to count total active tasks: %w", err)
	}

	if err := s.db.WithContext(ctx).Model(&model.Task{}).
		Where("status = ?", "pending").Count(&queued).Error; err != nil {
		return 0, fmt.Errorf("failed to count queued tasks: %w", err)
	}

	var running int64
	if err := s.db.WithContext(ctx).Model(&model.Task{}).
		Where("status = ?", "running").Count(&running).Error; err != nil {
		return 0, fmt.Errorf("failed to count running tasks: %w", err)
	}

	if total == 0 {
		return 0, nil
	}

	load := float64(running+queued) / float64(total) * 100
	if load > 100 {
		load = 100
	}
	return load, nil
}

type PreemptionResult struct {
	PreemptedTasks []model.PreemptionLog
	LoadPercent    float64
	DidPreempt     bool
}

func (s *PreemptionService) TryPreempt(ctx context.Context, newTask model.Task) (*PreemptionResult, error) {
	strategyCfg := s.configCenter.GetStrategy()

	load, err := s.GetSystemLoad(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get system load: %w", err)
	}

	result := &PreemptionResult{
		LoadPercent: load,
	}

	if load < strategyCfg.LoadThreshold {
		s.logger.Debug("load below threshold, no preemption needed",
			zap.Float64("load", load),
			zap.Float64("threshold", strategyCfg.LoadThreshold),
		)
		return result, nil
	}

	s.logger.Info("load exceeds threshold, evaluating preemption",
		zap.Float64("load", load),
		zap.String("strategy", string(strategyCfg.Strategy)),
		zap.Int64("new_task_id", newTask.ID),
		zap.Int("new_task_priority", newTask.Priority),
	)

	var candidates []model.Task
	switch strategyCfg.Strategy {
	case StrategyPriority:
		candidates = s.findPriorityCandidates(ctx, newTask.Priority, strategyCfg.MaxPreemptCount)
	case StrategyFIFO:
		candidates = s.findFIFOCandidates(ctx, strategyCfg.MaxPreemptCount)
	default:
		candidates = s.findPriorityCandidates(ctx, newTask.Priority, strategyCfg.MaxPreemptCount)
	}

	if len(candidates) == 0 {
		s.logger.Info("no preemption candidates found")
		return result, nil
	}

	result.DidPreempt = true
	for _, victim := range candidates {
		logEntry := s.preemptTask(ctx, victim, newTask, strategyCfg.Strategy, load)
		if logEntry != nil {
			result.PreemptedTasks = append(result.PreemptedTasks, *logEntry)
		}
	}

	return result, nil
}

func (s *PreemptionService) findPriorityCandidates(ctx context.Context, newPriority int, maxCount int) []model.Task {
	var candidates []model.Task
	s.db.WithContext(ctx).
		Where("status = ? AND priority < ?", "pending", newPriority).
		Order("priority ASC, created_at ASC").
		Limit(maxCount).
		Find(&candidates)
	return candidates
}

func (s *PreemptionService) findFIFOCandidates(ctx context.Context, maxCount int) []model.Task {
	var candidates []model.Task
	s.db.WithContext(ctx).
		Where("status = ?", "pending").
		Order("created_at ASC").
		Limit(maxCount).
		Find(&candidates)
	return candidates
}

func (s *PreemptionService) preemptTask(ctx context.Context, victim model.Task, newTask model.Task, strategy PreemptionStrategy, load float64) *model.PreemptionLog {
	s.logger.Info("preempting task",
		zap.Int64("victim_task_id", victim.ID),
		zap.Int("victim_priority", victim.Priority),
		zap.Int64("new_task_id", newTask.ID),
		zap.Int("new_priority", newTask.Priority),
		zap.String("strategy", string(strategy)),
	)

	if err := s.db.WithContext(ctx).Model(&victim).Update("status", "preempted").Error; err != nil {
		s.logger.Error("failed to update preempted task status", zap.Error(err))
		return nil
	}

	_, err := s.executor.CancelTask(ctx, victim.ID)
	if err != nil {
		s.logger.Warn("failed to notify executor about preemption", zap.Error(err))
	}

	reason := fmt.Sprintf("preempted by task %d (priority=%d) under %s strategy, system load %.1f%%",
		newTask.ID, newTask.Priority, strategy, load)

	logEntry := model.PreemptionLog{
		PreemptedTaskID: victim.ID,
		NewTaskID:       newTask.ID,
		Strategy:        string(strategy),
		Reason:          reason,
		LoadPercent:     load,
	}

	if err := s.db.WithContext(ctx).Create(&logEntry).Error; err != nil {
		s.logger.Error("failed to record preemption log", zap.Error(err))
		return nil
	}

	return &logEntry
}

func (s *PreemptionService) GetPreemptionLogs(ctx context.Context, taskID int64, limit int) ([]model.PreemptionLog, error) {
	var logs []model.PreemptionLog
	query := s.db.WithContext(ctx).Order("created_at DESC")
	if taskID > 0 {
		query = query.Where("preempted_task_id = ? OR new_task_id = ?", taskID, taskID)
	}
	if limit > 0 {
		query = query.Limit(limit)
	}
	if err := query.Find(&logs).Error; err != nil {
		return nil, err
	}
	return logs, nil
}
