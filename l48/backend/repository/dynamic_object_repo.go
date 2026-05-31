package repository

import (
	"time"
	"vct-gi-system/database"
	"vct-gi-system/models"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

type DynamicObjectRepository struct {
	db *gorm.DB
}

func NewDynamicObjectRepository() *DynamicObjectRepository {
	return &DynamicObjectRepository{
		db: database.GetDB(),
	}
}

func (r *DynamicObjectRepository) Create(obj *models.DynamicObject) error {
	return r.db.Create(obj).Error
}

func (r *DynamicObjectRepository) BatchCreate(objs []models.DynamicObject) error {
	if len(objs) == 0 {
		return nil
	}
	return r.db.CreateInBatches(objs, 100).Error
}

func (r *DynamicObjectRepository) GetByID(id uuid.UUID) (*models.DynamicObject, error) {
	var obj models.DynamicObject
	err := r.db.First(&obj, "id = ?", id).Error
	if err != nil {
		return nil, err
	}
	return &obj, nil
}

func (r *DynamicObjectRepository) GetBySceneID(sceneID uuid.UUID) ([]models.DynamicObject, error) {
	var objs []models.DynamicObject
	err := r.db.Where("scene_id = ?", sceneID).Order("created_at ASC").Find(&objs).Error
	return objs, err
}

func (r *DynamicObjectRepository) GetBySceneIDWithType(sceneID uuid.UUID, objectType string) ([]models.DynamicObject, error) {
	var objs []models.DynamicObject
	err := r.db.Where("scene_id = ? AND object_type = ?", sceneID, objectType).Order("created_at ASC").Find(&objs).Error
	return objs, err
}

func (r *DynamicObjectRepository) GetStaticObjects(sceneID uuid.UUID) ([]models.DynamicObject, error) {
	var objs []models.DynamicObject
	err := r.db.Where("scene_id = ? AND is_static = ?", sceneID, true).Order("created_at ASC").Find(&objs).Error
	return objs, err
}

func (r *DynamicObjectRepository) GetDynamicObjects(sceneID uuid.UUID) ([]models.DynamicObject, error) {
	var objs []models.DynamicObject
	err := r.db.Where("scene_id = ? AND is_static = ?", sceneID, false).Order("created_at ASC").Find(&objs).Error
	return objs, err
}

func (r *DynamicObjectRepository) Update(obj *models.DynamicObject) error {
	obj.UpdatedAt = time.Now()
	return r.db.Save(obj).Error
}

type ObjectPositionUpdate struct {
	ID       uuid.UUID       `json:"id"`
	Position datatypes.JSON  `json:"position"`
	Rotation datatypes.JSON  `json:"rotation,omitempty"`
}

func (r *DynamicObjectRepository) BatchUpdatePositions(sceneID uuid.UUID, updates []ObjectPositionUpdate) error {
	if len(updates) == 0 {
		return nil
	}

	return r.db.Transaction(func(tx *gorm.DB) error {
		now := time.Now()
		for _, update := range updates {
			updatesMap := map[string]interface{}{
				"position":   update.Position,
				"updated_at": now,
			}
			if len(update.Rotation) > 0 {
				updatesMap["rotation"] = update.Rotation
			}
			if err := tx.Model(&models.DynamicObject{}).
				Where("id = ? AND scene_id = ?", update.ID, sceneID).
				Updates(updatesMap).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *DynamicObjectRepository) Delete(id uuid.UUID) error {
	return r.db.Delete(&models.DynamicObject{}, "id = ?", id).Error
}

func (r *DynamicObjectRepository) DeleteBySceneID(sceneID uuid.UUID) error {
	return r.db.Where("scene_id = ?", sceneID).Delete(&models.DynamicObject{}).Error
}

func (r *DynamicObjectRepository) OwnedByUser(objID, userID uuid.UUID) (bool, error) {
	var count int64
	err := r.db.Model(&models.DynamicObject{}).
		Joins("JOIN scenes ON scenes.id = dynamic_objects.scene_id").
		Where("dynamic_objects.id = ? AND scenes.user_id = ?", objID, userID).
		Count(&count).Error
	return count > 0, err
}

func (r *DynamicObjectRepository) BelongsToScene(objID, sceneID uuid.UUID) (bool, error) {
	var count int64
	err := r.db.Model(&models.DynamicObject{}).Where("id = ? AND scene_id = ?", objID, sceneID).Count(&count).Error
	return count > 0, err
}

func (r *DynamicObjectRepository) CountBySceneID(sceneID uuid.UUID) (int64, error) {
	var count int64
	err := r.db.Model(&models.DynamicObject{}).Where("scene_id = ?", sceneID).Count(&count).Error
	return count, err
}
