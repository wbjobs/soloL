package repository

import (
	"time"
	"vct-gi-system/database"
	"vct-gi-system/models"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type VoxelRepository struct {
	db *gorm.DB
}

func NewVoxelRepository() *VoxelRepository {
	return &VoxelRepository{
		db: database.GetDB(),
	}
}

func (r *VoxelRepository) CreateGrid(grid *models.VoxelGrid) error {
	return r.db.Create(grid).Error
}

func (r *VoxelRepository) GetGridByID(id uuid.UUID) (*models.VoxelGrid, error) {
	var grid models.VoxelGrid
	err := r.db.Preload("VoxelData", func(db *gorm.DB) *gorm.DB {
		return db.Limit(1000)
	}).First(&grid, "id = ?", id).Error
	if err != nil {
		return nil, err
	}
	return &grid, nil
}

func (r *VoxelRepository) GetGridsBySceneID(sceneID uuid.UUID) ([]models.VoxelGrid, error) {
	var grids []models.VoxelGrid
	err := r.db.Where("scene_id = ?", sceneID).Order("created_at DESC").Find(&grids).Error
	return grids, err
}

func (r *VoxelRepository) UpdateGrid(grid *models.VoxelGrid) error {
	return r.db.Save(grid).Error
}

func (r *VoxelRepository) DeleteGrid(id uuid.UUID) error {
	return r.db.Delete(&models.VoxelGrid{}, "id = ?", id).Error
}

func (r *VoxelRepository) CreateVoxelData(data *models.VoxelData) error {
	data.UpdatedAt = time.Now()
	return r.db.Create(data).Error
}

func (r *VoxelRepository) BatchCreateVoxelData(data []models.VoxelData) error {
	if len(data) == 0 {
		return nil
	}
	now := time.Now()
	for i := range data {
		data[i].UpdatedAt = now
	}
	return r.db.CreateInBatches(data, 1000).Error
}

func (r *VoxelRepository) GetVoxelDataByRange(gridID uuid.UUID, minX, maxX, minY, maxY, minZ, maxZ int) ([]models.VoxelData, error) {
	var voxelData []models.VoxelData
	err := r.db.Where(`
		voxel_grid_id = ? 
		AND x >= ? AND x <= ? 
		AND y >= ? AND y <= ? 
		AND z >= ? AND z <= ?
		AND valid = true`,
		gridID, minX, maxX, minY, maxY, minZ, maxZ,
	).Order("x, y, z").Find(&voxelData).Error
	return voxelData, err
}

func (r *VoxelRepository) GetVoxelDataByRangeWithPage(gridID uuid.UUID, minX, maxX, minY, maxY, minZ, maxZ int, page, pageSize int) ([]models.VoxelData, int64, error) {
	var voxelData []models.VoxelData
	var total int64

	query := r.db.Model(&models.VoxelData{}).Where(`
		voxel_grid_id = ? 
		AND x >= ? AND x <= ? 
		AND y >= ? AND y <= ? 
		AND z >= ? AND z <= ?
		AND valid = true`,
		gridID, minX, maxX, minY, maxY, minZ, maxZ,
	)

	query.Count(&total)

	offset := (page - 1) * pageSize
	err := query.Order("x, y, z").Offset(offset).Limit(pageSize).Find(&voxelData).Error
	return voxelData, total, err
}

func (r *VoxelRepository) UpdateVoxelData(data *models.VoxelData) error {
	data.UpdatedAt = time.Now()
	return r.db.Save(data).Error
}

func (r *VoxelRepository) UpsertVoxelData(data *models.VoxelData) error {
	data.UpdatedAt = time.Now()
	return r.db.Clauses(
		clause.OnConflict{
			Columns: []clause.Column{
				{Name: "voxel_grid_id"},
				{Name: "x"},
				{Name: "y"},
				{Name: "z"},
			},
			DoUpdates: clause.Assignments(map[string]interface{}{
				"irradiance": data.Irradiance,
				"direction":  data.Direction,
				"opacity":    data.Opacity,
				"valid":      data.Valid,
				"updated_at": data.UpdatedAt,
			}),
		},
	).Create(data).Error
}

func (r *VoxelRepository) BatchUpsertVoxelData(data []models.VoxelData) error {
	if len(data) == 0 {
		return nil
	}
	now := time.Now()
	for i := range data {
		data[i].UpdatedAt = now
	}

	return r.db.Transaction(func(tx *gorm.DB) error {
		for _, v := range data {
			voxel := v
			if err := tx.Clauses(
				clause.OnConflict{
					Columns: []clause.Column{
						{Name: "voxel_grid_id"},
						{Name: "x"},
						{Name: "y"},
						{Name: "z"},
					},
					DoUpdates: clause.Assignments(map[string]interface{}{
						"irradiance": voxel.Irradiance,
						"direction":  voxel.Direction,
						"opacity":    voxel.Opacity,
						"valid":      voxel.Valid,
						"updated_at": voxel.UpdatedAt,
					}),
				},
			).Create(&voxel).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *VoxelRepository) DeleteVoxelData(gridID uuid.UUID) error {
	return r.db.Where("voxel_grid_id = ?", gridID).Delete(&models.VoxelData{}).Error
}

func (r *VoxelRepository) GetVoxelDataCount(gridID uuid.UUID) (int64, error) {
	var count int64
	err := r.db.Model(&models.VoxelData{}).Where("voxel_grid_id = ? AND valid = true", gridID).Count(&count).Error
	return count, err
}

func (r *VoxelRepository) GetActiveGridBySceneID(sceneID uuid.UUID) (*models.VoxelGrid, error) {
	var grid models.VoxelGrid
	err := r.db.Where("scene_id = ? AND is_active = true", sceneID).Order("created_at DESC").First(&grid).Error
	if err != nil {
		return nil, err
	}
	return &grid, nil
}

func (r *VoxelRepository) SetActiveGrid(sceneID, gridID uuid.UUID) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&models.VoxelGrid{}).Where("scene_id = ?", sceneID).Update("is_active", false).Error; err != nil {
			return err
		}
		if err := tx.Model(&models.VoxelGrid{}).Where("id = ?", gridID).Update("is_active", true).Error; err != nil {
			return err
		}
		return nil
	})
}
