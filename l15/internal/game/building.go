package game

import (
	"citybuilder/internal/database"
	"citybuilder/internal/models"
	"errors"
	"sync"
)

type BuildingManager struct {
	gridMgr     *GridManager
	resourceMgr *ResourceManager
	mu          sync.Mutex
	listeners   []func(*models.Tile)
}

func NewBuildingManager(gridMgr *GridManager, resourceMgr *ResourceManager) *BuildingManager {
	return &BuildingManager{
		gridMgr:     gridMgr,
		resourceMgr: resourceMgr,
		listeners:   make([]func(*models.Tile), 0),
	}
}

func (bm *BuildingManager) InitBuildings() error {
	var count int64
	database.DB.Model(&models.Building{}).Count(&count)
	if count > 0 {
		return nil
	}

	buildings := []models.Building{
		{Type: models.BuildingRoad, Name: "道路", CostWood: 0, CostStone: 5, CostFood: 0, ProdWood: 0, ProdStone: 0, ProdFood: 0, Population: 0},
		{Type: models.BuildingHouse, Name: "房屋", CostWood: 20, CostStone: 10, CostFood: 0, ProdWood: 0, ProdStone: 0, ProdFood: 0, Population: 4},
		{Type: models.BuildingFarm, Name: "农场", CostWood: 10, CostStone: 5, CostFood: 0, ProdWood: 0, ProdStone: 0, ProdFood: 5, Population: 0},
		{Type: models.BuildingSawmill, Name: "锯木厂", CostWood: 30, CostStone: 20, CostFood: 0, ProdWood: 3, ProdStone: 0, ProdFood: 0, Population: 0},
		{Type: models.BuildingQuarry, Name: "采石场", CostWood: 20, CostStone: 30, CostFood: 0, ProdWood: 0, ProdStone: 3, ProdFood: 0, Population: 0},
		{Type: models.BuildingMarket, Name: "市场", CostWood: 50, CostStone: 50, CostFood: 10, ProdWood: 1, ProdStone: 1, ProdFood: 1, Population: 0},
		{Type: models.BuildingTradePost, Name: "贸易站", CostWood: 80, CostStone: 60, CostFood: 30, ProdWood: 0, ProdStone: 0, ProdFood: 0, Population: 0},
	}

	return database.DB.Create(&buildings).Error
}

func (bm *BuildingManager) PlaceBuilding(x, y int, buildingType models.BuildingType) (*models.Tile, error) {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	if !bm.gridMgr.IsValidPosition(x, y) {
		return nil, errors.New("invalid position")
	}

	tile, err := bm.gridMgr.GetTile(x, y)
	if err != nil {
		return nil, err
	}

	if tile.Terrain == models.TerrainWater || tile.Terrain == models.TerrainMountain {
		return nil, errors.New("cannot build on water or mountain")
	}

	if buildingType == models.BuildingRoad {
		if tile.HasRoad {
			return nil, errors.New("road already exists")
		}
		if tile.BuildingID != nil {
			return nil, errors.New("tile already has a building, demolish first")
		}
	} else {
		if tile.BuildingID != nil {
			return nil, errors.New("tile already has a building")
		}
		if tile.HasRoad {
			return nil, errors.New("tile already has a road, demolish first")
		}

		hasRoad, err := bm.gridMgr.HasAdjacentRoad(x, y)
		if err != nil {
			return nil, err
		}
		if !hasRoad {
			return nil, errors.New("building must be adjacent to a road")
		}
	}

	var building models.Building
	if err := database.DB.Where("type = ?", buildingType).First(&building).Error; err != nil {
		return nil, errors.New("building type not found")
	}

	if !bm.resourceMgr.SpendResources(building.CostWood, building.CostStone, building.CostFood) {
		return nil, errors.New("not enough resources")
	}

	if buildingType == models.BuildingRoad {
		tile.HasRoad = true
	} else {
		tile.BuildingID = &building.ID
	}

	if err := database.DB.Save(tile).Error; err != nil {
		return nil, err
	}

	bm.resourceMgr.CalculateProduction()
	bm.notifyListeners(tile)

	return tile, nil
}

func (bm *BuildingManager) DemolishBuilding(x, y int) (*models.Tile, error) {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	tile, err := bm.gridMgr.GetTile(x, y)
	if err != nil {
		return nil, err
	}

	if tile.BuildingID == nil && !tile.HasRoad {
		return nil, errors.New("no building to demolish")
	}

	if tile.HasRoad {
		tile.HasRoad = false
		tile.BuildingID = nil
		bm.resourceMgr.AddResources(0, 2, 0)
	} else {
		if tile.BuildingID == nil {
			return nil, errors.New("invalid building state")
		}

		var building models.Building
		if err := database.DB.First(&building, *tile.BuildingID).Error; err != nil {
			return nil, errors.New("building template not found")
		}

		refundWood := building.CostWood / 2
		refundStone := building.CostStone / 2
		refundFood := building.CostFood / 2
		bm.resourceMgr.AddResources(refundWood, refundStone, refundFood)

		tile.BuildingID = nil
		tile.HasRoad = false
	}

	if err := database.DB.Save(tile).Error; err != nil {
		return nil, err
	}

	var savedTile models.Tile
	if err := database.DB.Where("x = ? AND y = ?", x, y).First(&savedTile).Error; err != nil {
		return nil, err
	}

	bm.resourceMgr.CalculateProduction()
	bm.notifyListeners(&savedTile)

	return &savedTile, nil
}

func (bm *BuildingManager) GetAllBuildings() ([]models.Building, error) {
	var buildings []models.Building
	err := database.DB.Find(&buildings).Error
	return buildings, err
}

func (bm *BuildingManager) AddListener(fn func(*models.Tile)) {
	bm.mu.Lock()
	defer bm.mu.Unlock()
	bm.listeners = append(bm.listeners, fn)
}

func (bm *BuildingManager) notifyListeners(tile *models.Tile) {
	for _, listener := range bm.listeners {
		go listener(tile)
	}
}
