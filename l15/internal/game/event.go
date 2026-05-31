package game

import (
	"citybuilder/internal/database"
	"citybuilder/internal/models"
	"math/rand"
	"sync"
	"time"
)

type EventManager struct {
	gridMgr     *GridManager
	resourceMgr *ResourceManager
	mu          sync.Mutex
	listeners   []func(*models.GameEvent)
}

func NewEventManager(gridMgr *GridManager, resourceMgr *ResourceManager) *EventManager {
	return &EventManager{
		gridMgr:     gridMgr,
		resourceMgr: resourceMgr,
		listeners:   make([]func(*models.GameEvent), 0),
	}
}

func (em *EventManager) CheckRandomEvent() {
	em.mu.Lock()
	defer em.mu.Unlock()

	if rand.Float64() > 0.02 {
		return
	}

	eventType := rand.Intn(2)
	var event *models.GameEvent

	switch eventType {
	case 0:
		event = em.triggerFireEvent()
	case 1:
		event = em.triggerHarvestEvent()
	}

	if event != nil {
		em.notifyListeners(event)
	}
}

func (em *EventManager) triggerFireEvent() *models.GameEvent {
	var tiles []models.Tile
	database.DB.Where("building_id IS NOT NULL").Find(&tiles)

	if len(tiles) == 0 {
		return nil
	}

	tile := tiles[rand.Intn(len(tiles))]
	tile.IsOnFire = true
	database.DB.Save(&tile)

	event := &models.GameEvent{
		Type:     "fire",
		Message:  "火灾！一座建筑着火了！",
		Severity: "danger",
		TileX:    &tile.X,
		TileY:    &tile.Y,
		CreatedAt: time.Now(),
	}
	database.DB.Create(event)

	return event
}

func (em *EventManager) triggerHarvestEvent() *models.GameEvent {
	bonusWood := 50 + rand.Intn(100)
	bonusStone := 30 + rand.Intn(50)
	bonusFood := 100 + rand.Intn(150)

	em.resourceMgr.AddResources(bonusWood, bonusStone, bonusFood)

	event := &models.GameEvent{
		Type:      "harvest",
		Message:   "大丰收！获得了额外的资源！",
		Severity:  "success",
		CreatedAt: time.Now(),
	}
	database.DB.Create(event)

	return event
}

func (em *EventManager) GetRecentEvents(limit int) ([]models.GameEvent, error) {
	var events []models.GameEvent
	err := database.DB.Order("created_at DESC").Limit(limit).Find(&events).Error
	return events, err
}

func (em *EventManager) AddListener(fn func(*models.GameEvent)) {
	em.mu.Lock()
	defer em.mu.Unlock()
	em.listeners = append(em.listeners, fn)
}

func (em *EventManager) notifyListeners(event *models.GameEvent) {
	for _, listener := range em.listeners {
		go listener(event)
	}
}
