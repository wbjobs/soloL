package router

import (
	"task-scheduler-gateway/internal/handler"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

func SetupRouter(
	logger *zap.Logger,
	jwtMiddleware gin.HandlerFunc,
	rateLimitMiddleware gin.HandlerFunc,
	taskHandler *handler.TaskHandler,
) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()

	r.Use(gin.Recovery())
	r.Use(func(c *gin.Context) {
		logger.Info("incoming request",
			zap.String("method", c.Request.Method),
			zap.String("path", c.Request.URL.Path),
			zap.String("ip", c.ClientIP()),
		)
		c.Next()
	})

	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	api := r.Group("/api/v1")
	api.Use(jwtMiddleware)
	api.Use(rateLimitMiddleware)
	{
		tasks := api.Group("/tasks")
		{
			tasks.POST("", taskHandler.SubmitTask)
			tasks.GET("/:task_id", taskHandler.QueryTask)
			tasks.DELETE("/:task_id", taskHandler.CancelTask)
		}

		scheduling := api.Group("/scheduling")
		{
			scheduling.GET("/strategy", taskHandler.GetStrategy)
			scheduling.PUT("/strategy", taskHandler.SetStrategy)
			scheduling.GET("/preemption-logs", taskHandler.GetPreemptionLogs)
		}
	}

	return r
}
