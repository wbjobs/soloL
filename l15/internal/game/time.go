package game

import (
	"citybuilder/internal/config"
	"citybuilder/internal/database"
	"citybuilder/internal/models"
	"log"
	"sync"
	"time"
)

type TimeManager struct {
	gameTime      *models.GameTime
	cfg           *config.Config
	ticker        *time.Ticker
	listeners     []func(*models.GameTime)
	mu            sync.RWMutex
	resourceMgr   *ResourceManager
	buildingMgr   *BuildingManager
	eventMgr      *EventManager
	tradeMgr      *TradeManager
}

func NewTimeManager(cfg *config.Config) *TimeManager {
	return &TimeManager{
		cfg:       cfg,
		listeners: make([]func(*models.GameTime), 0),
	}
}

func (tm *TimeManager) SetManagers(rm *ResourceManager, bm *BuildingManager, em *EventManager, tmgr *TradeManager) {
	tm.resourceMgr = rm
	tm.buildingMgr = bm
	tm.eventMgr = em
	tm.tradeMgr = tmgr
}

func (tm *TimeManager) Init() error {
	var gameTime models.GameTime
	err := database.DB.First(&gameTime).Error
	if err != nil {
		tm.gameTime = &models.GameTime{
			Day:          1,
			Hour:         6,
			Minute:       0,
			TotalMinutes: 6 * 60,
			LastTick:     time.Now(),
		}
		if err := database.DB.Create(tm.gameTime).Error; err != nil {
			return err
		}
	} else {
		tm.gameTime = &gameTime
	}
	return nil
}

func (tm *TimeManager) Start() {
	tm.ticker = time.NewTicker(tm.cfg.TickInterval)
	go func() {
		for range tm.ticker.C {
			tm.Tick()
		}
	}()
	log.Println("Time system started")
}

func (tm *TimeManager) Stop() {
	if tm.ticker != nil {
		tm.ticker.Stop()
	}
}

func (tm *TimeManager) Tick() {
	tm.mu.Lock()
	defer tm.mu.Unlock()

	tm.gameTime.TotalMinutes += int64(tm.cfg.GameMinutesPerTick)
	tm.gameTime.Minute += tm.cfg.GameMinutesPerTick

	for tm.gameTime.Minute >= 60 {
		tm.gameTime.Minute -= 60
		tm.gameTime.Hour++
	}

	for tm.gameTime.Hour >= 24 {
		tm.gameTime.Hour -= 24
		tm.gameTime.Day++
	}

	tm.gameTime.LastTick = time.Now()
	database.DB.Save(tm.gameTime)

	if tm.resourceMgr != nil {
		tm.resourceMgr.UpdateResources(tm.cfg.GameMinutesPerTick)
	}

	if tm.eventMgr != nil {
		tm.eventMgr.CheckRandomEvent()
	}

	if tm.tradeMgr != nil && tm.gameTime.Minute == 0 {
		go tm.tradeMgr.ExpireOrders()
	}

	tm.notifyListeners()
}

func (tm *TimeManager) GetGameTime() models.GameTime {
	tm.mu.RLock()
	defer tm.mu.RUnlock()
	return *tm.gameTime
}

func (tm *TimeManager) AddListener(fn func(*models.GameTime)) {
	tm.mu.Lock()
	defer tm.mu.Unlock()
	tm.listeners = append(tm.listeners, fn)
}

func (tm *TimeManager) notifyListeners() {
	for _, listener := range tm.listeners {
		go listener(tm.gameTime)
	}
}
