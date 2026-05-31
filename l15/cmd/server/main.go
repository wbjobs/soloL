package main

import (
	"citybuilder/internal/api"
	"citybuilder/internal/config"
	"citybuilder/internal/database"
	"citybuilder/internal/game"
	"citybuilder/internal/models"
	"citybuilder/internal/websocket"
	"log"
	"net/http"
)

func main() {
	cfg := config.Load()

	if err := database.InitPostgres(cfg); err != nil {
		log.Printf("Warning: PostgreSQL connection failed: %v", err)
		log.Println("Continuing without database persistence...")
	} else {
		database.DB.AutoMigrate(
		&models.Tile{},
		&models.Building{},
		&models.Resources{},
		&models.GameTime{},
		&models.GameEvent{},
		&models.Citizen{},
	)
	}

	if err := database.InitRedis(cfg); err != nil {
		log.Printf("Warning: Redis connection failed: %v", err)
		log.Println("Path caching will be disabled...")
	}

	gridMgr := game.NewGridManager(cfg)
	if err := gridMgr.InitGrid(); err != nil {
		log.Printf("Warning: Grid initialization failed: %v", err)
	}

	resourceMgr := game.NewResourceManager()
	if err := resourceMgr.Init(); err != nil {
		log.Fatalf("Resource manager init failed: %v", err)
	}

	tradeMgr := game.NewTradeManager(resourceMgr)
	if err := tradeMgr.Init(); err != nil {
		log.Printf("Warning: Trade manager init failed: %v", err)
	}

	buildingMgr := game.NewBuildingManager(gridMgr, resourceMgr)
	if err := buildingMgr.InitBuildings(); err != nil {
		log.Printf("Warning: Buildings init failed: %v", err)
	}

	eventMgr := game.NewEventManager(gridMgr, resourceMgr)
	pathfinder := game.NewPathfinder(gridMgr, 8)

	timeMgr := game.NewTimeManager(cfg)
	timeMgr.SetManagers(resourceMgr, buildingMgr, eventMgr, tradeMgr)
	if err := timeMgr.Init(); err != nil {
		log.Fatalf("Time manager init failed: %v", err)
	}
	timeMgr.Start()
	defer timeMgr.Stop()

	wsHub := websocket.NewHub()
	go wsHub.Run()

	handler := api.NewHandler(gridMgr, buildingMgr, resourceMgr, timeMgr, eventMgr, pathfinder, tradeMgr, wsHub)
	router := api.SetupRouter(handler, wsHub)

	log.Printf("Server starting on port " + cfg.ServerPort)
	log.Fatal(http.ListenAndServe(":"+cfg.ServerPort, router))
}
