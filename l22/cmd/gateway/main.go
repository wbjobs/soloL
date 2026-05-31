package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"task-scheduler-gateway/internal/config"
	"task-scheduler-gateway/internal/handler"
	"task-scheduler-gateway/internal/middleware"
	"task-scheduler-gateway/internal/router"
	"task-scheduler-gateway/internal/service"

	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func initLogger() *zap.Logger {
	encoderCfg := zap.NewProductionEncoderConfig()
	encoderCfg.TimeKey = "timestamp"
	encoderCfg.EncodeTime = zapcore.ISO8601TimeEncoder

	core := zapcore.NewCore(
		zapcore.NewJSONEncoder(encoderCfg),
		zapcore.AddSync(os.Stdout),
		zapcore.DebugLevel,
	)
	return zap.New(core, zap.AddCaller())
}

func initDB(cfg *config.MySQLConfig, zapLogger *zap.Logger) (*gorm.DB, error) {
	dsn := fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?charset=utf8mb4&parseTime=True&loc=Local",
		cfg.User, cfg.Password, cfg.Host, cfg.Port, cfg.DBName,
	)

	gormLogger := logger.New(
		log.New(os.Stdout, "\r\n", log.LstdFlags),
		logger.Config{
			SlowThreshold:             200 * time.Millisecond,
			LogLevel:                  logger.Warn,
			IgnoreRecordNotFoundError: true,
			Colorful:                  false,
		},
	)

	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{Logger: gormLogger})
	if err != nil {
		return nil, fmt.Errorf("failed to connect to MySQL: %w", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("failed to get underlying sql.DB: %w", err)
	}

	sqlDB.SetMaxOpenConns(cfg.MaxOpenConns)
	sqlDB.SetMaxIdleConns(cfg.MaxIdleConns)
	sqlDB.SetConnMaxLifetime(time.Hour)

	zapLogger.Info("MySQL connected", zap.String("host", cfg.Host), zap.Int("port", cfg.Port))
	return db, nil
}

func initRedis(cfg *config.RedisConfig, zapLogger *zap.Logger) (*redis.Client, error) {
	client := redis.NewClient(&redis.Options{
		Addr:     cfg.Addr,
		Password: cfg.Password,
		DB:       cfg.DB,
	})

	if err := client.Ping(context.Background()).Err(); err != nil {
		return nil, fmt.Errorf("failed to connect to Redis: %w", err)
	}

	zapLogger.Info("Redis connected", zap.String("addr", cfg.Addr))
	return client, nil
}

func buildInitialStrategy(cfg *config.PreemptionConfig) service.StrategyConfig {
	strategy := service.StrategyPriority
	if cfg.DefaultStrategy == "fifo" {
		strategy = service.StrategyFIFO
	}

	threshold := cfg.LoadThreshold
	if threshold <= 0 {
		threshold = 80.0
	}

	maxCount := cfg.MaxPreemptCount
	if maxCount <= 0 {
		maxCount = 5
	}

	return service.StrategyConfig{
		Strategy:        strategy,
		LoadThreshold:   threshold,
		MaxPreemptCount: maxCount,
	}
}

func main() {
	zapLogger := initLogger()
	defer zapLogger.Sync()

	configPath := "config.yaml"
	if envPath := os.Getenv("CONFIG_PATH"); envPath != "" {
		configPath = envPath
	}

	cfg, err := config.Load(configPath)
	if err != nil {
		zapLogger.Fatal("failed to load config", zap.Error(err))
	}

	db, err := initDB(&cfg.MySQL, zapLogger)
	if err != nil {
		zapLogger.Fatal("failed to init database", zap.Error(err))
	}

	redisClient, err := initRedis(&cfg.Redis, zapLogger)
	if err != nil {
		zapLogger.Fatal("failed to init redis", zap.Error(err))
	}

	depService := service.NewDependencyService(db, redisClient, zapLogger)
	if err := depService.AutoMigrate(); err != nil {
		zapLogger.Fatal("failed to auto-migrate database", zap.Error(err))
	}

	executorClient, err := service.NewExecutorClient(&cfg.GRPC, zapLogger)
	if err != nil {
		zapLogger.Fatal("failed to init gRPC executor client", zap.Error(err))
	}
	defer executorClient.Close()

	configCenter, err := service.NewConfigCenter(&cfg.Etcd, buildInitialStrategy(&cfg.Preemption), zapLogger)
	if err != nil {
		zapLogger.Fatal("failed to init config center", zap.Error(err))
	}
	defer configCenter.Close()

	preemptionService := service.NewPreemptionService(db, configCenter, executorClient, zapLogger)
	if err := preemptionService.AutoMigrate(); err != nil {
		zapLogger.Fatal("failed to auto-migrate preemption logs", zap.Error(err))
	}

	limiter := middleware.NewTokenBucketLimiter(redisClient, &cfg.RateLimit)
	jwtAuth := middleware.JWTAuth(&cfg.JWT)
	rateLimit := middleware.RateLimit(limiter)

	taskHandler := handler.NewTaskHandler(db, executorClient, depService, preemptionService, configCenter, zapLogger)

	r := router.SetupRouter(zapLogger, jwtAuth, rateLimit, taskHandler)

	addr := fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port)
	srv := &http.Server{
		Addr:         addr,
		Handler:      r,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		zapLogger.Info("API gateway starting", zap.String("addr", addr))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			zapLogger.Fatal("server failed", zap.Error(err))
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	zapLogger.Info("shutting down server...")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		zapLogger.Fatal("server forced to shutdown", zap.Error(err))
	}

	zapLogger.Info("server exited gracefully")
}
