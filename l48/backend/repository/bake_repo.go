package repository

import (
	"time"
	"vct-gi-system/database"
	"vct-gi-system/models"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type BakeRepository struct {
	db *gorm.DB
}

func NewBakeRepository() *BakeRepository {
	return &BakeRepository{
		db: database.GetDB(),
	}
}

func (r *BakeRepository) Create(task *models.BakeTask) error {
	return r.db.Create(task).Error
}

func (r *BakeRepository) GetByID(id uuid.UUID) (*models.BakeTask, error) {
	var task models.BakeTask
	err := r.db.Preload("VoxelGrid").First(&task, "id = ?", id).Error
	if err != nil {
		return nil, err
	}
	return &task, nil
}

func (r *BakeRepository) GetBySceneID(sceneID uuid.UUID) ([]models.BakeTask, error) {
	var tasks []models.BakeTask
	err := r.db.Where("scene_id = ?", sceneID).Order("created_at DESC").Find(&tasks).Error
	return tasks, err
}

func (r *BakeRepository) GetByUserID(userID uuid.UUID) ([]models.BakeTask, error) {
	var tasks []models.BakeTask
	err := r.db.Where("user_id = ?", userID).Order("created_at DESC").Find(&tasks).Error
	return tasks, err
}

func (r *BakeRepository) GetByStatus(status string) ([]models.BakeTask, error) {
	var tasks []models.BakeTask
	err := r.db.Where("status = ?", status).Order("created_at ASC").Find(&tasks).Error
	return tasks, err
}

func (r *BakeRepository) GetPendingTasks(limit int) ([]models.BakeTask, error) {
	var tasks []models.BakeTask
	err := r.db.Where("status = ?", "pending").Order("created_at ASC").Limit(limit).Find(&tasks).Error
	return tasks, err
}

func (r *BakeRepository) GetActiveTaskCount() (int64, error) {
	var count int64
	err := r.db.Model(&models.BakeTask{}).Where("status IN ?", []string{"pending", "running"}).Count(&count).Error
	return count, err
}

func (r *BakeRepository) Update(task *models.BakeTask) error {
	task.UpdatedAt = time.Now()
	return r.db.Save(task).Error
}

func (r *BakeRepository) UpdateProgress(id uuid.UUID, progress int, status string) error {
	updates := map[string]interface{}{
		"progress":   progress,
		"status":     status,
		"updated_at": time.Now(),
	}
	if status == "running" {
		updates["started_at"] = time.Now()
	}
	if status == "completed" || status == "failed" {
		updates["completed_at"] = time.Now()
	}
	return r.db.Model(&models.BakeTask{}).Where("id = ?", id).Updates(updates).Error
}

func (r *BakeRepository) SetError(id uuid.UUID, errorMsg string) error {
	return r.db.Model(&models.BakeTask{}).Where("id = ?", id).Updates(map[string]interface{}{
		"status":      "failed",
		"error_msg":   errorMsg,
		"completed_at": time.Now(),
		"updated_at":  time.Now(),
	}).Error
}

func (r *BakeRepository) Cancel(id uuid.UUID) error {
	return r.db.Model(&models.BakeTask{}).Where("id = ?", id).Updates(map[string]interface{}{
		"status":      "cancelled",
		"completed_at": time.Now(),
		"updated_at":  time.Now(),
	}).Error
}

func (r *BakeRepository) Delete(id uuid.UUID) error {
	return r.db.Delete(&models.BakeTask{}, "id = ?", id).Error
}

func (r *BakeRepository) OwnedByUser(taskID, userID uuid.UUID) (bool, error) {
	var count int64
	err := r.db.Model(&models.BakeTask{}).Where("id = ? AND user_id = ?", taskID, userID).Count(&count).Error
	return count > 0, err
}

func (r *BakeRepository) BelongsToScene(taskID, sceneID uuid.UUID) (bool, error) {
	var count int64
	err := r.db.Model(&models.BakeTask{}).Where("id = ? AND scene_id = ?", taskID, sceneID).Count(&count).Error
	return count > 0, err
}
