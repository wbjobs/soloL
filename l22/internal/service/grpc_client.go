package service

import (
	"context"
	"fmt"
	"time"

	"task-scheduler-gateway/internal/config"
	pb "task-scheduler-gateway/proto/taskexecutor"

	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

type ExecutorClient struct {
	conn   *grpc.ClientConn
	client pb.TaskExecutorClient
	logger *zap.Logger
}

func NewExecutorClient(cfg *config.GRPCConfig, logger *zap.Logger) (*ExecutorClient, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, err := grpc.DialContext(ctx, cfg.ExecutorAddr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithBlock(),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to task executor: %w", err)
	}

	return &ExecutorClient{
		conn:   conn,
		client: pb.NewTaskExecutorClient(conn),
		logger: logger,
	}, nil
}

func (c *ExecutorClient) SubmitTask(ctx context.Context, taskID int64, name, payload string, priority int32, userID int64) (*pb.SubmitTaskResponse, error) {
	c.logger.Info("submitting task to executor",
		zap.Int64("task_id", taskID),
		zap.String("name", name),
	)

	resp, err := c.client.SubmitTask(ctx, &pb.SubmitTaskRequest{
		TaskId:   taskID,
		Name:     name,
		Payload:  payload,
		Priority: priority,
		UserId:   userID,
	})
	if err != nil {
		c.logger.Error("failed to submit task", zap.Error(err))
		return nil, fmt.Errorf("executor submit failed: %w", err)
	}

	return resp, nil
}

func (c *ExecutorClient) QueryTask(ctx context.Context, taskID int64) (*pb.QueryTaskResponse, error) {
	c.logger.Info("querying task from executor", zap.Int64("task_id", taskID))

	resp, err := c.client.QueryTask(ctx, &pb.QueryTaskRequest{TaskId: taskID})
	if err != nil {
		c.logger.Error("failed to query task", zap.Error(err))
		return nil, fmt.Errorf("executor query failed: %w", err)
	}

	return resp, nil
}

func (c *ExecutorClient) CancelTask(ctx context.Context, taskID int64) (*pb.CancelTaskResponse, error) {
	c.logger.Info("canceling task at executor", zap.Int64("task_id", taskID))

	resp, err := c.client.CancelTask(ctx, &pb.CancelTaskRequest{TaskId: taskID})
	if err != nil {
		c.logger.Error("failed to cancel task", zap.Error(err))
		return nil, fmt.Errorf("executor cancel failed: %w", err)
	}

	return resp, nil
}

func (c *ExecutorClient) Close() error {
	if c.conn != nil {
		return c.conn.Close()
	}
	return nil
}
