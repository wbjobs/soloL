package handler

import (
	"net/http"
	"vct-gi-system/middleware"
	"vct-gi-system/service"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type BakeHandler struct {
	bakeService *service.BakeService
}

func NewBakeHandler(bakeService *service.BakeService) *BakeHandler {
	return &BakeHandler{
		bakeService: bakeService,
	}
}

type StartBakeRequest struct {
	GridSizeX    int     `json:"grid_size_x"`
	GridSizeY    int     `json:"grid_size_y"`
	GridSizeZ    int     `json:"grid_size_z"`
	Resolution   float64 `json:"resolution"`
	RayBounces   int     `json:"ray_bounces"`
	RaysPerVoxel int     `json:"rays_per_voxel"`
}

func (h *BakeHandler) StartBake(c *gin.Context) {
	userID, exists := middleware.GetUserID(c)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	sceneID, err := uuid.Parse(c.Param("scene_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid scene ID"})
		return
	}

	var req StartBakeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		params := make(map[string]interface{})
		task, err := h.bakeService.CreateTask(sceneID, userID, params)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusCreated, task)
		return
	}

	params := make(map[string]interface{})
	if req.GridSizeX > 0 {
		params["grid_size_x"] = float64(req.GridSizeX)
	}
	if req.GridSizeY > 0 {
		params["grid_size_y"] = float64(req.GridSizeY)
	}
	if req.GridSizeZ > 0 {
		params["grid_size_z"] = float64(req.GridSizeZ)
	}
	if req.Resolution > 0 {
		params["resolution"] = req.Resolution
	}
	if req.RayBounces > 0 {
		params["ray_bounces"] = float64(req.RayBounces)
	}
	if req.RaysPerVoxel > 0 {
		params["rays_per_voxel"] = float64(req.RaysPerVoxel)
	}

	task, err := h.bakeService.CreateTask(sceneID, userID, params)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, task)
}

func (h *BakeHandler) GetBakeTask(c *gin.Context) {
	userID, exists := middleware.GetUserID(c)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	sceneID, err := uuid.Parse(c.Param("scene_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid scene ID"})
		return
	}

	taskID, err := uuid.Parse(c.Param("task_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid task ID"})
		return
	}

	task, err := h.bakeService.GetTask(taskID, userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	if task.SceneID != sceneID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Task does not belong to scene"})
		return
	}

	c.JSON(http.StatusOK, task)
}

func (h *BakeHandler) ListBakeTasks(c *gin.Context) {
	userID, exists := middleware.GetUserID(c)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	sceneID, err := uuid.Parse(c.Param("scene_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid scene ID"})
		return
	}

	tasks, err := h.bakeService.ListTasks(sceneID, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, tasks)
}

func (h *BakeHandler) GetBakeProgress(c *gin.Context) {
	userID, exists := middleware.GetUserID(c)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	sceneID, err := uuid.Parse(c.Param("scene_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid scene ID"})
		return
	}

	taskID, err := uuid.Parse(c.Param("task_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid task ID"})
		return
	}

	progress, status, err := h.bakeService.GetTaskProgress(taskID, userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	task, _ := h.bakeService.GetTask(taskID, userID)
	if task != nil && task.SceneID != sceneID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Task does not belong to scene"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"progress": progress,
		"status":   status,
	})
}

func (h *BakeHandler) CancelBake(c *gin.Context) {
	userID, exists := middleware.GetUserID(c)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	sceneID, err := uuid.Parse(c.Param("scene_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid scene ID"})
		return
	}

	taskID, err := uuid.Parse(c.Param("task_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid task ID"})
		return
	}

	task, _ := h.bakeService.GetTask(taskID, userID)
	if task != nil && task.SceneID != sceneID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Task does not belong to scene"})
		return
	}

	if err := h.bakeService.CancelTask(taskID, userID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Bake task cancelled successfully"})
}

func (h *BakeHandler) GetBakeResult(c *gin.Context) {
	userID, exists := middleware.GetUserID(c)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	sceneID, err := uuid.Parse(c.Param("scene_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid scene ID"})
		return
	}

	taskID, err := uuid.Parse(c.Param("task_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid task ID"})
		return
	}

	task, _ := h.bakeService.GetTask(taskID, userID)
	if task != nil && task.SceneID != sceneID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Task does not belong to scene"})
		return
	}

	result, err := h.bakeService.GetTaskResult(taskID, userID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}
