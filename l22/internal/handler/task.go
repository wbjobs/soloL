package handler

import (
	"net/http"
	"strconv"

	"task-scheduler-gateway/internal/model"
	"task-scheduler-gateway/internal/service"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

type TaskHandler struct {
	db         *gorm.DB
	executor   *service.ExecutorClient
	deps       *service.DependencyService
	preemption *service.PreemptionService
	configCtl  *service.ConfigCenter
	logger     *zap.Logger
}

func NewTaskHandler(
	db *gorm.DB,
	executor *service.ExecutorClient,
	deps *service.DependencyService,
	preemption *service.PreemptionService,
	configCtl *service.ConfigCenter,
	logger *zap.Logger,
) *TaskHandler {
	return &TaskHandler{
		db:         db,
		executor:   executor,
		deps:       deps,
		preemption: preemption,
		configCtl:  configCtl,
		logger:     logger,
	}
}

func (h *TaskHandler) SubmitTask(c *gin.Context) {
	var req model.SubmitTaskRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.APIResponse{
			Code:    http.StatusBadRequest,
			Message: "invalid request: " + err.Error(),
		})
		return
	}

	userID, _ := c.Get("user_id")

	task := model.Task{
		Name:        req.Name,
		Description: req.Description,
		Payload:     req.Payload,
		Status:      "pending",
		Priority:    req.Priority,
		UserID:      userID.(int64),
	}

	if err := h.db.WithContext(c.Request.Context()).Create(&task).Error; err != nil {
		h.logger.Error("failed to create task", zap.Error(err))
		c.JSON(http.StatusInternalServerError, model.APIResponse{
			Code:    http.StatusInternalServerError,
			Message: "failed to create task",
		})
		return
	}

	if len(req.Dependencies) > 0 {
		if err := h.deps.ValidateDependencies(c.Request.Context(), task.ID, req.Dependencies); err != nil {
			h.db.Delete(&task)
			c.JSON(http.StatusBadRequest, model.APIResponse{
				Code:    http.StatusBadRequest,
				Message: "dependency validation failed: " + err.Error(),
			})
			return
		}

		if err := h.deps.AddDependencies(c.Request.Context(), task.ID, req.Dependencies); err != nil {
			h.db.Delete(&task)
			c.JSON(http.StatusBadRequest, model.APIResponse{
				Code:    http.StatusBadRequest,
				Message: "dependency check failed: " + err.Error(),
			})
			return
		}
	}

	var preemptionInfo interface{}
	if h.preemption != nil {
		result, err := h.preemption.TryPreempt(c.Request.Context(), task)
		if err != nil {
			h.logger.Warn("preemption check failed, continuing with submission", zap.Error(err))
		} else if result.DidPreempt {
			preemptionInfo = gin.H{
				"load_percent":    result.LoadPercent,
				"preempted_count": len(result.PreemptedTasks),
				"preempted_tasks": result.PreemptedTasks,
			}
		}
	}

	resp, err := h.executor.SubmitTask(c.Request.Context(), task.ID, task.Name, task.Payload, int32(task.Priority), task.UserID)
	if err != nil {
		h.logger.Error("failed to submit task to executor", zap.Error(err))
		h.db.Model(&task).Update("status", "submit_failed")
		c.JSON(http.StatusBadGateway, model.APIResponse{
			Code:    http.StatusBadGateway,
			Message: "failed to submit task to executor: " + err.Error(),
		})
		return
	}

	if resp.Success {
		h.db.Model(&task).Update("status", "submitted")
	}

	data := gin.H{
		"task_id":      task.ID,
		"execution_id": resp.ExecutionId,
		"executor_msg": resp.Message,
	}
	if preemptionInfo != nil {
		data["preemption"] = preemptionInfo
	}

	c.JSON(http.StatusOK, model.APIResponse{
		Code:    http.StatusOK,
		Message: "task submitted successfully",
		Data:    data,
	})
}

func (h *TaskHandler) QueryTask(c *gin.Context) {
	taskIDStr := c.Param("task_id")
	taskID, err := strconv.ParseInt(taskIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.APIResponse{
			Code:    http.StatusBadRequest,
			Message: "invalid task_id",
		})
		return
	}

	userID, _ := c.Get("user_id")

	var task model.Task
	if err := h.db.WithContext(c.Request.Context()).Where("id = ? AND user_id = ?", taskID, userID).First(&task).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, model.APIResponse{
				Code:    http.StatusNotFound,
				Message: "task not found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, model.APIResponse{
			Code:    http.StatusInternalServerError,
			Message: "database error",
		})
		return
	}

	execResp, err := h.executor.QueryTask(c.Request.Context(), taskID)
	executorStatus := ""
	executorResult := ""
	if err != nil {
		h.logger.Warn("failed to query executor, returning DB status", zap.Error(err))
	} else {
		executorStatus = execResp.Status
		executorResult = execResp.Result
	}

	taskResp := model.TaskResponse{
		ID:          task.ID,
		Name:        task.Name,
		Description: task.Description,
		Payload:     task.Payload,
		Status:      task.Status,
		Priority:    task.Priority,
		UserID:      task.UserID,
		CreatedAt:   task.CreatedAt.Format("2006-01-02T15:04:05Z"),
		UpdatedAt:   task.UpdatedAt.Format("2006-01-02T15:04:05Z"),
	}

	data := gin.H{
		"task":    taskResp,
		"runtime": gin.H{},
	}

	if executorStatus != "" {
		data["runtime"] = gin.H{
			"status": executorStatus,
			"result": executorResult,
		}
	}

	c.JSON(http.StatusOK, model.APIResponse{
		Code:    http.StatusOK,
		Message: "task queried successfully",
		Data:    data,
	})
}

func (h *TaskHandler) CancelTask(c *gin.Context) {
	taskIDStr := c.Param("task_id")
	taskID, err := strconv.ParseInt(taskIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.APIResponse{
			Code:    http.StatusBadRequest,
			Message: "invalid task_id",
		})
		return
	}

	userID, _ := c.Get("user_id")

	var task model.Task
	if err := h.db.WithContext(c.Request.Context()).Where("id = ? AND user_id = ?", taskID, userID).First(&task).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, model.APIResponse{
				Code:    http.StatusNotFound,
				Message: "task not found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, model.APIResponse{
			Code:    http.StatusInternalServerError,
			Message: "database error",
		})
		return
	}

	if task.Status == "completed" || task.Status == "failed" || task.Status == "canceled" || task.Status == "preempted" {
		c.JSON(http.StatusConflict, model.APIResponse{
			Code:    http.StatusConflict,
			Message: "task is already in terminal state: " + task.Status,
		})
		return
	}

	resp, err := h.executor.CancelTask(c.Request.Context(), taskID)
	if err != nil {
		h.logger.Error("failed to cancel task at executor", zap.Error(err))
		c.JSON(http.StatusBadGateway, model.APIResponse{
			Code:    http.StatusBadGateway,
			Message: "failed to cancel task at executor: " + err.Error(),
		})
		return
	}

	if resp.Success {
		h.db.Model(&task).Update("status", "canceled")
	}

	c.JSON(http.StatusOK, model.APIResponse{
		Code:    http.StatusOK,
		Message: "task cancel request processed",
		Data: gin.H{
			"task_id":      taskID,
			"canceled":     resp.Success,
			"executor_msg": resp.Message,
		},
	})
}

func (h *TaskHandler) GetStrategy(c *gin.Context) {
	cfg := h.configCtl.GetStrategy()
	c.JSON(http.StatusOK, model.APIResponse{
		Code:    http.StatusOK,
		Message: "current preemption strategy",
		Data:    cfg,
	})
}

func (h *TaskHandler) SetStrategy(c *gin.Context) {
	var req service.StrategyConfig
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.APIResponse{
			Code:    http.StatusBadRequest,
			Message: "invalid request: " + err.Error(),
		})
		return
	}

	if req.Strategy != service.StrategyFIFO && req.Strategy != service.StrategyPriority {
		c.JSON(http.StatusBadRequest, model.APIResponse{
			Code:    http.StatusBadRequest,
			Message: "invalid strategy, must be 'fifo' or 'priority'",
		})
		return
	}

	if req.LoadThreshold <= 0 || req.LoadThreshold > 100 {
		c.JSON(http.StatusBadRequest, model.APIResponse{
			Code:    http.StatusBadRequest,
			Message: "load_threshold must be between 0 and 100",
		})
		return
	}

	if req.MaxPreemptCount <= 0 {
		req.MaxPreemptCount = 1
	}

	if err := h.configCtl.SetStrategy(c.Request.Context(), req); err != nil {
		c.JSON(http.StatusInternalServerError, model.APIResponse{
			Code:    http.StatusInternalServerError,
			Message: "failed to update strategy: " + err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, model.APIResponse{
		Code:    http.StatusOK,
		Message: "strategy updated",
		Data:    req,
	})
}

func (h *TaskHandler) GetPreemptionLogs(c *gin.Context) {
	taskIDStr := c.Query("task_id")
	var taskID int64
	if taskIDStr != "" {
		var err error
		taskID, err = strconv.ParseInt(taskIDStr, 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, model.APIResponse{
				Code:    http.StatusBadRequest,
				Message: "invalid task_id",
			})
			return
		}
	}

	limitStr := c.DefaultQuery("limit", "50")
	limit, _ := strconv.Atoi(limitStr)
	if limit <= 0 || limit > 200 {
		limit = 50
	}

	logs, err := h.preemption.GetPreemptionLogs(c.Request.Context(), taskID, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.APIResponse{
			Code:    http.StatusInternalServerError,
			Message: "failed to get preemption logs",
		})
		return
	}

	c.JSON(http.StatusOK, model.APIResponse{
		Code:    http.StatusOK,
		Message: "preemption logs",
		Data:    logs,
	})
}
