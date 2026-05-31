package service

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"task-scheduler-gateway/internal/config"

	"go.etcd.io/etcd/client/v3"
	"go.uber.org/zap"
)

const (
	strategyKey = "/task-scheduler/preemption/strategy"
)

type PreemptionStrategy string

const (
	StrategyFIFO      PreemptionStrategy = "fifo"
	StrategyPriority  PreemptionStrategy = "priority"
)

type StrategyConfig struct {
	Strategy        PreemptionStrategy `json:"strategy"`
	LoadThreshold   float64            `json:"load_threshold"`
	MaxPreemptCount int                `json:"max_preempt_count"`
}

type ConfigCenter struct {
	client   *clientv3.Client
	logger   *zap.Logger
	mu       sync.RWMutex
	current  StrategyConfig
	onChange []func(StrategyConfig)
}

func NewConfigCenter(cfg *config.EtcdConfig, initial StrategyConfig, logger *zap.Logger) (*ConfigCenter, error) {
	cli, err := clientv3.New(clientv3.Config{
		Endpoints:   cfg.Endpoints,
		DialTimeout: 5 * time.Second,
		Username:    cfg.Username,
		Password:    cfg.Password,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to connect to etcd: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	resp, err := cli.Get(ctx, strategyKey)
	if err != nil {
		logger.Warn("failed to read strategy from etcd, using default", zap.Error(err))
	} else if len(resp.Kvs) > 0 {
		var stored StrategyConfig
		if err := json.Unmarshal(resp.Kvs[0].Value, &stored); err == nil {
			initial = stored
			logger.Info("loaded strategy from etcd", zap.String("strategy", string(initial.Strategy)))
		}
	}

	if _, err := cli.Put(ctx, strategyKey, mustMarshal(initial)); err != nil {
		logger.Warn("failed to write initial strategy to etcd", zap.Error(err))
	}

	cc := &ConfigCenter{
		client:  cli,
		logger:  logger,
		current: initial,
	}

	go cc.watch()
	return cc, nil
}

func (cc *ConfigCenter) watch() {
	watchCh := cc.client.Watch(context.Background(), strategyKey)
	for resp := range watchCh {
		for _, ev := range resp.Events {
			if ev.Type == clientv3.EventTypePut {
				var cfg StrategyConfig
				if err := json.Unmarshal(ev.Kv.Value, &cfg); err != nil {
					cc.logger.Error("failed to unmarshal strategy update", zap.Error(err))
					continue
				}
				cc.mu.Lock()
				cc.current = cfg
				cc.mu.Unlock()
				cc.logger.Info("strategy updated from etcd", zap.String("strategy", string(cfg.Strategy)))

				for _, fn := range cc.onChange {
					fn(cfg)
				}
			}
		}
	}
}

func (cc *ConfigCenter) GetStrategy() StrategyConfig {
	cc.mu.RLock()
	defer cc.mu.RUnlock()
	return cc.current
}

func (cc *ConfigCenter) SetStrategy(ctx context.Context, cfg StrategyConfig) error {
	cc.mu.Lock()
	cc.current = cfg
	cc.mu.Unlock()

	_, err := cc.client.Put(ctx, strategyKey, mustMarshal(cfg))
	if err != nil {
		return fmt.Errorf("failed to write strategy to etcd: %w", err)
	}
	cc.logger.Info("strategy written to etcd", zap.String("strategy", string(cfg.Strategy)))
	return nil
}

func (cc *ConfigCenter) OnChange(fn func(StrategyConfig)) {
	cc.mu.Lock()
	defer cc.mu.Unlock()
	cc.onChange = append(cc.onChange, fn)
}

func (cc *ConfigCenter) Close() error {
	return cc.client.Close()
}

func mustMarshal(v StrategyConfig) string {
	data, _ := json.Marshal(v)
	return string(data)
}
