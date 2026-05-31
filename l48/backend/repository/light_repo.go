package repository

import (
	"vct-gi-system/database"
	"vct-gi-system/models"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type LightRepository struct {
	db *gorm.DB
}

func NewLightRepository() *LightRepository {
	return &LightRepository{
		db: database.GetDB(),
	}
}

func (r *LightRepository) Create(light *models.Light) error {
	return r.db.Create(light).Error
}

func (r *LightRepository) GetByID(id uuid.UUID) (*models.Light, error) {
	var light models.Light
	err := r.db.First(&light, "id = ?", id).Error
	if err != nil {
		return nil, err
	}
	return &light, nil
}

func (r *LightRepository) GetBySceneID(sceneID uuid.UUID) ([]models.Light, error) {
	var lights []models.Light
	err := r.db.Where("scene_id = ?", sceneID).Order("created_at ASC").Find(&lights).Error
	return lights, err
}

func (r *LightRepository) GetActiveBySceneID(sceneID uuid.UUID) ([]models.Light, error) {
	var lights []models.Light
	err := r.db.Where("scene_id = ? AND enabled = ?", sceneID, true).Order("created_at ASC").Find(&lights).Error
	return lights, err
}

func (r *LightRepository) Update(light *models.Light) error {
	return r.db.Save(light).Error
}

func (r *LightRepository) Delete(id uuid.UUID) error {
	return r.db.Delete(&models.Light{}, "id = ?", id).Error
}

func (r *LightRepository) DeleteBySceneID(sceneID uuid.UUID) error {
	return r.db.Where("scene_id = ?", sceneID).Delete(&models.Light{}).Error
}

func (r *LightRepository) Exists(id uuid.UUID) (bool, error) {
	var count int64
	err := r.db.Model(&models.Light{}).Where("id = ?", id).Count(&count).Error
	return count > 0, err
}

func (r *LightRepository) BelongsToScene(lightID, sceneID uuid.UUID) (bool, error) {
	var count int64
	err := r.db.Model(&models.Light{}).Where("id = ? AND scene_id = ?", lightID, sceneID).Count(&count).Error
	return count > 0, err
}

func (r *LightRepository) ToggleEnabled(id uuid.UUID) (*models.Light, error) {
	var light models.Light
	if err := r.db.First(&light, "id = ?", id).Error; err != nil {
		return nil, err
	}

	light.Enabled = !light.Enabled
	if err := r.db.Save(&light).Error; err != nil {
		return nil, err
	}

	return &light, nil
}

func (r *LightRepository) CountBySceneID(sceneID uuid.UUID) (int64, error) {
	var count int64
	err := r.db.Model(&models.Light{}).Where("scene_id = ?", sceneID).Count(&count).Error
	return count, err
}

func (r *LightRepository) BatchCreate(lights []models.Light) error {
	if len(lights) == 0 {
		return nil
	}
	return r.db.CreateInBatches(lights, 100).Error
}
