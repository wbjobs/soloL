package database

import (
	"log"
	"vct-gi-system/config"
	"vct-gi-system/models"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var DB *gorm.DB

func InitDB() error {
	dsn := config.GetDSN()

	var err error
	DB, err = gorm.Open(postgres.Open(dsn), &gorm.Config{
		PrepareStmt: true,
	})
	if err != nil {
		return err
	}

	log.Println("Database connection established")

	err = autoMigrate()
	if err != nil {
		return err
	}

	log.Println("Database migration completed")

	return nil
}

func autoMigrate() error {
	err := DB.AutoMigrate(
		&models.User{},
		&models.Scene{},
		&models.Light{},
		&models.BakeTask{},
		&models.VoxelGrid{},
		&models.VoxelData{},
		&models.DynamicObject{},
	)
	if err != nil {
		return err
	}

	err = createIndexes()
	if err != nil {
		log.Printf("Warning: failed to create some indexes: %v", err)
	}

	return nil
}

func createIndexes() error {
	indexSQLs := []string{
		`CREATE INDEX IF NOT EXISTS idx_voxel_data_grid_coord ON voxel_data(voxel_grid_id, x, y, z)`,
		`CREATE INDEX IF NOT EXISTS idx_voxel_data_valid ON voxel_data(voxel_grid_id, valid)`,
		`CREATE INDEX IF NOT EXISTS idx_scene_user ON scenes(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_light_scene ON lights(scene_id)`,
		`CREATE INDEX IF NOT EXISTS idx_bake_task_scene ON bake_tasks(scene_id)`,
		`CREATE INDEX IF NOT EXISTS idx_bake_task_status ON bake_tasks(status)`,
		`CREATE INDEX IF NOT EXISTS idx_voxel_grid_scene ON voxel_grids(scene_id)`,
		`CREATE INDEX IF NOT EXISTS idx_dynamic_object_scene ON dynamic_objects(scene_id)`,
	}

	for _, sql := range indexSQLs {
		if err := DB.Exec(sql).Error; err != nil {
			log.Printf("Warning: failed to execute index SQL: %s, error: %v", sql, err)
		}
	}

	return nil
}

func GetDB() *gorm.DB {
	return DB
}
