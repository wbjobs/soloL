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

type VoxelHandler struct {
	voxelRepo *repository.VoxelRepository
	sceneRepo *repository.SceneRepository
}

func NewVoxelHandler() *VoxelHandler {
	return &VoxelHandler{
		voxelRepo: repository.NewVoxelRepository(),
		sceneRepo: repository.NewSceneRepository(),
	}
}

func (h *VoxelHandler) CreateGrid(c *gin.Context) {
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

	var grid models.VoxelGrid
	if err := c.ShouldBindJSON(&grid); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	grid.ID = uuid.Nil
	grid.SceneID = sceneID

	if err := h.voxelRepo.CreateGrid(&grid); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create voxel grid"})
		return
	}

	c.JSON(http.StatusCreated, grid)
}

func (h *VoxelHandler) GetGrid(c *gin.Context) {
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

	gridID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid grid ID"})
		return
	}

	grid, err := h.voxelRepo.GetGridByID(gridID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Voxel grid not found"})
		return
	}

	if grid.SceneID != sceneID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Grid does not belong to scene"})
		return
	}

	c.JSON(http.StatusOK, grid)
}

func (h *VoxelHandler) ListGrids(c *gin.Context) {
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

	grids, err := h.voxelRepo.GetGridsBySceneID(sceneID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch voxel grids"})
		return
	}

	c.JSON(http.StatusOK, grids)
}

func (h *VoxelHandler) GetActiveGrid(c *gin.Context) {
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

	grid, err := h.voxelRepo.GetActiveGridBySceneID(sceneID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "No active voxel grid found"})
		return
	}

	c.JSON(http.StatusOK, grid)
}

func (h *VoxelHandler) SetActiveGrid(c *gin.Context) {
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

	gridID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid grid ID"})
		return
	}

	if err := h.voxelRepo.SetActiveGrid(sceneID, gridID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to set active grid"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Active grid updated successfully"})
}

func (h *VoxelHandler) QueryVoxelData(c *gin.Context) {
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

	gridID, err := uuid.Parse(c.Param("grid_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid grid ID"})
		return
	}

	var query models.VoxelQuery
	if err := c.ShouldBindQuery(&query); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "1000"))

	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 10000 {
		pageSize = 1000
	}

	data, total, err := h.voxelRepo.GetVoxelDataByRangeWithPage(
		gridID,
		query.MinX, query.MaxX,
		query.MinY, query.MaxY,
		query.MinZ, query.MaxZ,
		page, pageSize,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to query voxel data"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data":       data,
		"total":      total,
		"page":       page,
		"page_size":  pageSize,
		"total_pages": (total + int64(pageSize) - 1) / int64(pageSize),
	})
}

func (h *VoxelHandler) BatchUpsertVoxelData(c *gin.Context) {
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

	gridID, err := uuid.Parse(c.Param("grid_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid grid ID"})
		return
	}

	var voxelData []models.VoxelData
	if err := c.ShouldBindJSON(&voxelData); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	for i := range voxelData {
		voxelData[i].VoxelGridID = gridID
	}

	if err := h.voxelRepo.BatchUpsertVoxelData(voxelData); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to upsert voxel data"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":     "Voxel data upserted successfully",
		"count":       len(voxelData),
	})
}

func (h *VoxelHandler) DeleteGrid(c *gin.Context) {
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

	gridID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid grid ID"})
		return
	}

	if err := h.voxelRepo.DeleteVoxelData(gridID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete voxel data"})
		return
	}

	if err := h.voxelRepo.DeleteGrid(gridID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete voxel grid"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Voxel grid deleted successfully"})
}

func (h *VoxelHandler) GetVoxelCount(c *gin.Context) {
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

	gridID, err := uuid.Parse(c.Param("grid_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid grid ID"})
		return
	}

	count, err := h.voxelRepo.GetVoxelDataCount(gridID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get voxel count"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"count": count})
}
