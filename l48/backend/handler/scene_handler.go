package handler

import (
	"net/http"
	"strconv"
	"vct-gi-system/middleware"
	"vct-gi-system/models"
	"vct-gi-system/repository"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type SceneHandler struct {
	sceneRepo *repository.SceneRepository
}

func NewSceneHandler() *SceneHandler {
	return &SceneHandler{
		sceneRepo: repository.NewSceneRepository(),
	}
}

func (h *SceneHandler) Create(c *gin.Context) {
	userID, exists := middleware.GetUserID(c)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var scene models.Scene
	if err := c.ShouldBindJSON(&scene); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	scene.ID = uuid.Nil
	scene.UserID = userID

	if err := h.sceneRepo.Create(&scene); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create scene"})
		return
	}

	c.JSON(http.StatusCreated, scene)
}

func (h *SceneHandler) GetByID(c *gin.Context) {
	userID, exists := middleware.GetUserID(c)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid scene ID"})
		return
	}

	owned, err := h.sceneRepo.OwnedByUser(id, userID)
	if err != nil || !owned {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	scene, err := h.sceneRepo.GetByID(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Scene not found"})
		return
	}

	c.JSON(http.StatusOK, scene)
}

func (h *SceneHandler) List(c *gin.Context) {
	userID, exists := middleware.GetUserID(c)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "10"))

	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 10
	}

	scenes, total, err := h.sceneRepo.GetByUserIDWithPage(userID, page, pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch scenes"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data":       scenes,
		"total":      total,
		"page":       page,
		"page_size":  pageSize,
		"total_pages": (total + int64(pageSize) - 1) / int64(pageSize),
	})
}

func (h *SceneHandler) Update(c *gin.Context) {
	userID, exists := middleware.GetUserID(c)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid scene ID"})
		return
	}

	owned, err := h.sceneRepo.OwnedByUser(id, userID)
	if err != nil || !owned {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	var updateData map[string]interface{}
	if err := c.ShouldBindJSON(&updateData); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	scene, err := h.sceneRepo.GetByID(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Scene not found"})
		return
	}

	if name, ok := updateData["name"].(string); ok {
		scene.Name = name
	}
	if description, ok := updateData["description"].(string); ok {
		scene.Description = description
	}
	if boundsMin, ok := updateData["bounds_min"]; ok {
		scene.BoundsMin = toJSON(boundsMin)
	}
	if boundsMax, ok := updateData["bounds_max"]; ok {
		scene.BoundsMax = toJSON(boundsMax)
	}
	if voxelResolution, ok := updateData["voxel_resolution"].(float64); ok {
		scene.VoxelResolution = voxelResolution
	}

	if err := h.sceneRepo.Update(scene); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update scene"})
		return
	}

	c.JSON(http.StatusOK, scene)
}

func (h *SceneHandler) Delete(c *gin.Context) {
	userID, exists := middleware.GetUserID(c)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid scene ID"})
		return
	}

	owned, err := h.sceneRepo.OwnedByUser(id, userID)
	if err != nil || !owned {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	if err := h.sceneRepo.Delete(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete scene"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Scene deleted successfully"})
}
