package game

import (
	"citybuilder/internal/config"
	"citybuilder/internal/database"
	"citybuilder/internal/models"
	"fmt"
	"math/rand"
)

type GridManager struct {
	gridSize int
}

func NewGridManager(cfg *config.Config) *GridManager {
	return &GridManager{
		gridSize: cfg.GridSize,
	}
}

func (gm *GridManager) InitGrid() error {
	var count int64
	database.DB.Model(&models.Tile{}).Count(&count)
	if count > 0 {
		return nil
	}

	batchSize := 1000
	var tiles []models.Tile

	for y := 0; y < gm.gridSize; y++ {
		for x := 0; x < gm.gridSize; x++ {
			terrain := gm.generateTerrain(x, y)
			tiles = append(tiles, models.Tile{
				X:       x,
				Y:       y,
				Terrain: terrain,
				HasRoad: false,
				IsOnFire: false,
			})

			if len(tiles) >= batchSize {
				if err := database.DB.Create(&tiles).Error; err != nil {
					return fmt.Errorf("failed to create tiles batch: %w", err)
				}
				tiles = tiles[:0]
			}
		}
	}

	if len(tiles) > 0 {
		if err := database.DB.Create(&tiles).Error; err != nil {
			return fmt.Errorf("failed to create remaining tiles: %w", err)
		}
	}

	return nil
}

func (gm *GridManager) generateTerrain(x, y int) models.TerrainType {
	r := rand.Float64()
	distFromCenter := float64((x-gm.gridSize/2)*(x-gm.gridSize/2) + (y-gm.gridSize/2)*(y-gm.gridSize/2))
	centerFactor := distFromCenter / float64(gm.gridSize*gm.gridSize/4)

	if r < 0.05+centerFactor*0.1 {
		return models.TerrainWater
	} else if r < 0.2+centerFactor*0.1 {
		return models.TerrainMountain
	} else if r < 0.5 {
		return models.TerrainForest
	}
	return models.TerrainGrass
}

func (gm *GridManager) GetTile(x, y int) (*models.Tile, error) {
	var tile models.Tile
	err := database.DB.Where("x = ? AND y = ?", x, y).First(&tile).Error
	if err != nil {
		return nil, err
	}
	return &tile, nil
}

func (gm *GridManager) GetTilesInRange(startX, startY, endX, endY int) ([]models.Tile, error) {
	var tiles []models.Tile
	err := database.DB.Preload("Building").Where("x >= ? AND x <= ? AND y >= ? AND y <= ?", 
		startX, endX, startY, endY).Find(&tiles).Error
	return tiles, err
}

func (gm *GridManager) HasAdjacentRoad(x, y int) (bool, error) {
	directions := [][2]int{{-1, 0}, {1, 0}, {0, -1}, {0, 1}}
	
	for _, dir := range directions {
		nx, ny := x+dir[0], y+dir[1]
		if nx < 0 || nx >= gm.gridSize || ny < 0 || ny >= gm.gridSize {
			continue
		}
		
		var tile models.Tile
		err := database.DB.Where("x = ? AND y = ?", nx, ny).First(&tile).Error
		if err != nil {
			continue
		}
		
		if tile.HasRoad {
			return true, nil
		}
	}
	return false, nil
}

func (gm *GridManager) GetGridSize() int {
	return gm.gridSize
}

func (gm *GridManager) IsValidPosition(x, y int) bool {
	return x >= 0 && x < gm.gridSize && y >= 0 && y < gm.gridSize
}
