package repository

import (
	"vct-gi-system/database"
	"vct-gi-system/models"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type SceneRepository struct {
	db *gorm.DB
}

func NewSceneRepository() *SceneRepository {
	return &SceneRepository{
		db: database.GetDB(),
	}
}

func (r *SceneRepository) Create(scene *models.Scene) error {
	return r.db.Create(scene).Error
}

func (r *SceneRepository) GetByID(id uuid.UUID) (*models.Scene, error) {
	var scene models.Scene
	err := r.db.Preload("Lights").Preload("VoxelGrids").Preload("DynamicObjects").First(&scene, "id = ?", id).Error
	if err != nil {
		return nil, err
	}
	return &scene, nil
}

func (r *SceneRepository) GetByIDWithLights(id uuid.UUID) (*models.Scene, error) {
	var scene models.Scene
	err := r.db.Preload("Lights", "enabled = ?", true).First(&scene, "id = ?", id).Error
	if err != nil {
		return nil, err
	}
	return &scene, nil
}

func (r *SceneRepository) GetByUserID(userID uuid.UUID) ([]models.Scene, error) {
	var scenes []models.Scene
	err := r.db.Where("user_id = ?", userID).Order("updated_at DESC").Find(&scenes).Error
	return scenes, err
}

func (r *SceneRepository) GetByUserIDWithPage(userID uuid.UUID, page, pageSize int) ([]models.Scene, int64, error) {
	var scenes []models.Scene
	var total int64

	query := r.db.Model(&models.Scene{}).Where("user_id = ?", userID)
	query.Count(&total)

	offset := (page - 1) * pageSize
	err := query.Order("updated_at DESC").Offset(offset).Limit(pageSize).Find(&scenes).Error
	return scenes, total, err
}

func (r *SceneRepository) Update(scene *models.Scene) error {
	return r.db.Save(scene).Error
}

func (r *SceneRepository) Delete(id uuid.UUID) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("scene_id = ?", id).Delete(&models.VoxelData{}).Error; err != nil {
			return err
		}
		if err := tx.Where("scene_id = ?", id).Delete(&models.VoxelGrid{}).Error; err != nil {
			return err
		}
		if err := tx.Where("scene_id = ?", id).Delete(&models.Light{}).Error; err != nil {
			return err
		}
		if err := tx.Where("scene_id = ?", id).Delete(&models.DynamicObject{}).Error; err != nil {
			return err
		}
		if err := tx.Where("scene_id = ?", id).Delete(&models.BakeTask{}).Error; err != nil {
			return err
		}
		if err := tx.Delete(&models.Scene{}, "id = ?", id).Error; err != nil {
			return err
		}
		return nil
	})
}

func (r *SceneRepository) Exists(id uuid.UUID) (bool, error) {
	var count int64
	err := r.db.Model(&models.Scene{}).Where("id = ?", id).Count(&count).Error
	return count > 0, err
}

func (r *SceneRepository) OwnedByUser(sceneID, userID uuid.UUID) (bool, error) {
	var count int64
	err := r.db.Model(&models.Scene{}).Where("id = ? AND user_id = ?", sceneID, userID).Count(&count).Error
	return count > 0, err
}
