package handler

import (
	"encoding/json"
	"net/http"
	"vct-gi-system/middleware"
	"vct-gi-system/models"
	"vct-gi-system/repository"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/datatypes"
)

type LightHandler struct {
	lightRepo *repository.LightRepository
	sceneRepo *repository.SceneRepository
}

func NewLightHandler() *LightHandler {
	return &LightHandler{
		lightRepo: repository.NewLightRepository(),
		sceneRepo: repository.NewSceneRepository(),
	}
}

func toJSON(v interface{}) datatypes.JSON {
	data, _ := json.Marshal(v)
	return datatypes.JSON(data)
}

func (h *LightHandler) Create(c *gin.Context) {
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

	owned, err := h.sceneRepo.OwnedByUser(sceneID, userID)
	if err != nil || !owned {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	var light models.Light
	if err := c.ShouldBindJSON(&light); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	light.ID = uuid.Nil
	light.SceneID = sceneID

	if err := h.lightRepo.Create(&light); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create light"})
		return
	}

	c.JSON(http.StatusCreated, light)
}

func (h *LightHandler) GetByID(c *gin.Context) {
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

	owned, err := h.sceneRepo.OwnedByUser(sceneID, userID)
	if err != nil || !owned {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid light ID"})
		return
	}

	belongs, err := h.lightRepo.BelongsToScene(id, sceneID)
	if err != nil || !belongs {
		c.JSON(http.StatusForbidden, gin.H{"error": "Light does not belong to scene"})
		return
	}

	light, err := h.lightRepo.GetByID(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Light not found"})
		return
	}

	c.JSON(http.StatusOK, light)
}

func (h *LightHandler) List(c *gin.Context) {
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

	owned, err := h.sceneRepo.OwnedByUser(sceneID, userID)
	if err != nil || !owned {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	activeOnly := c.DefaultQuery("active_only", "false") == "true"

	var lights []models.Light
	if activeOnly {
		lights, err = h.lightRepo.GetActiveBySceneID(sceneID)
	} else {
		lights, err = h.lightRepo.GetBySceneID(sceneID)
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch lights"})
		return
	}

	c.JSON(http.StatusOK, lights)
}

func (h *LightHandler) Update(c *gin.Context) {
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

	owned, err := h.sceneRepo.OwnedByUser(sceneID, userID)
	if err != nil || !owned {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid light ID"})
		return
	}

	belongs, err := h.lightRepo.BelongsToScene(id, sceneID)
	if err != nil || !belongs {
		c.JSON(http.StatusForbidden, gin.H{"error": "Light does not belong to scene"})
		return
	}

	var updateData map[string]interface{}
	if err := c.ShouldBindJSON(&updateData); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	light, err := h.lightRepo.GetByID(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Light not found"})
		return
	}

	if name, ok := updateData["name"].(string); ok {
		light.Name = name
	}
	if lightType, ok := updateData["type"].(string); ok {
		light.Type = lightType
	}
	if position, ok := updateData["position"]; ok {
		light.Position = toJSON(position)
	}
	if direction, ok := updateData["direction"]; ok {
		light.Direction = toJSON(direction)
	}
	if color, ok := updateData["color"]; ok {
		light.Color = toJSON(color)
	}
	if intensity, ok := updateData["intensity"].(float64); ok {
		light.Intensity = intensity
	}
	if radius, ok := updateData["radius"].(float64); ok {
		light.Radius = radius
	}
	if spotAngle, ok := updateData["spot_angle"].(float64); ok {
		light.SpotAngle = spotAngle
	}
	if enabled, ok := updateData["enabled"].(bool); ok {
		light.Enabled = enabled
	}
	if castShadow, ok := updateData["cast_shadow"].(bool); ok {
		light.CastShadow = castShadow
	}

	if err := h.lightRepo.Update(light); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update light"})
		return
	}

	c.JSON(http.StatusOK, light)
}

func (h *LightHandler) Toggle(c *gin.Context) {
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

	owned, err := h.sceneRepo.OwnedByUser(sceneID, userID)
	if err != nil || !owned {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid light ID"})
		return
	}

	belongs, err := h.lightRepo.BelongsToScene(id, sceneID)
	if err != nil || !belongs {
		c.JSON(http.StatusForbidden, gin.H{"error": "Light does not belong to scene"})
		return
	}

	light, err := h.lightRepo.ToggleEnabled(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to toggle light"})
		return
	}

	c.JSON(http.StatusOK, light)
}

func (h *LightHandler) Delete(c *gin.Context) {
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

	owned, err := h.sceneRepo.OwnedByUser(sceneID, userID)
	if err != nil || !owned {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid light ID"})
		return
	}

	belongs, err := h.lightRepo.BelongsToScene(id, sceneID)
	if err != nil || !belongs {
		c.JSON(http.StatusForbidden, gin.H{"error": "Light does not belong to scene"})
		return
	}

	if err := h.lightRepo.Delete(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete light"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Light deleted successfully"})
}

func (h *LightHandler) BatchCreate(c *gin.Context) {
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

	owned, err := h.sceneRepo.OwnedByUser(sceneID, userID)
	if err != nil || !owned {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	var lights []models.Light
	if err := c.ShouldBindJSON(&lights); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	for i := range lights {
		lights[i].ID = uuid.Nil
		lights[i].SceneID = sceneID
	}

	if err := h.lightRepo.BatchCreate(lights); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create lights"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message": "Lights created successfully",
		"count":   len(lights),
	})
}
