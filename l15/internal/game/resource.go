package game

import (
	"citybuilder/internal/database"
	"citybuilder/internal/models"
	"sync"
	"time"
)

type ResourceManager struct {
	resources  *models.Resources
	production *models.ResourceProduction
	mu         sync.RWMutex
	listeners  []func(*models.Resources, *models.ResourceProduction)
}

func NewResourceManager() *ResourceManager {
	return &ResourceManager{
		production: &models.ResourceProduction{},
		listeners:  make([]func(*models.Resources, *models.ResourceProduction), 0),
	}
}

func (rm *ResourceManager) Init() error {
	var resources models.Resources
	err := database.DB.First(&resources).Error
	if err != nil {
		rm.resources = &models.Resources{
			Wood:     500,
			Stone:    300,
			Food:     200,
			UpdatedAt: time.Now(),
		}
		if err := database.DB.Create(rm.resources).Error; err != nil {
			return err
		}
	} else {
		rm.resources = &resources
	}

	rm.CalculateProduction()
	return nil
}

func (rm *ResourceManager) CalculateProduction() {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	var tiles []models.Tile
	database.DB.Preload("Building").Where("building_id IS NOT NULL").Find(&tiles)

	woodProd := 0
	stoneProd := 0
	foodProd := 0

	for _, tile := range tiles {
		if tile.Building != nil {
			woodProd += tile.Building.ProdWood
			stoneProd += tile.Building.ProdStone
			foodProd += tile.Building.ProdFood
		}
	}

	rm.production.WoodPerMinute = woodProd
	rm.production.StonePerMinute = stoneProd
	rm.production.FoodPerMinute = foodProd
}

func (rm *ResourceManager) UpdateResources(minutes int) {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	rm.resources.Wood += rm.production.WoodPerMinute * minutes
	rm.resources.Stone += rm.production.StonePerMinute * minutes
	rm.resources.Food += rm.production.FoodPerMinute * minutes

	if rm.resources.Wood < 0 {
		rm.resources.Wood = 0
	}
	if rm.resources.Stone < 0 {
		rm.resources.Stone = 0
	}
	if rm.resources.Food < 0 {
		rm.resources.Food = 0
	}

	rm.resources.UpdatedAt = time.Now()
	database.DB.Save(rm.resources)

	rm.notifyListeners()
}

func (rm *ResourceManager) CanAfford(wood, stone, food int) bool {
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	return rm.resources.Wood >= wood && rm.resources.Stone >= stone && rm.resources.Food >= food
}

func (rm *ResourceManager) SpendResources(wood, stone, food int) bool {
	if !rm.CanAfford(wood, stone, food) {
		return false
	}

	rm.mu.Lock()
	defer rm.mu.Unlock()

	rm.resources.Wood -= wood
	rm.resources.Stone -= stone
	rm.resources.Food -= food
	rm.resources.UpdatedAt = time.Now()
	database.DB.Save(rm.resources)

	rm.notifyListeners()
	return true
}

func (rm *ResourceManager) AddResources(wood, stone, food int) {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	rm.resources.Wood += wood
	rm.resources.Stone += stone
	rm.resources.Food += food
	rm.resources.UpdatedAt = time.Now()
	database.DB.Save(rm.resources)

	rm.notifyListeners()
}

func (rm *ResourceManager) GetResources() models.Resources {
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	return *rm.resources
}

func (rm *ResourceManager) GetProduction() models.ResourceProduction {
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	return *rm.production
}

func (rm *ResourceManager) AddListener(fn func(*models.Resources, *models.ResourceProduction)) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	rm.listeners = append(rm.listeners, fn)
}

func (rm *ResourceManager) notifyListeners() {
	for _, listener := range rm.listeners {
		go listener(rm.resources, rm.production)
	}
}
