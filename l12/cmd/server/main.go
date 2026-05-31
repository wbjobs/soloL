package main

import (
	"log"
	"os"

	"canvas-signal/internal/api"
	"canvas-signal/internal/auth"
	"canvas-signal/internal/room"
	"canvas-signal/internal/store"
	"canvas-signal/internal/ws"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func main() {
	keyManager, err := auth.NewKeyManager()
	if err != nil {
		log.Fatalf("Failed to create key manager: %v", err)
	}

	log.Printf("Server public key: %s", keyManager.GetPublicKey())

	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "data/canvas-signal.db"
	}

	dataStore, err := store.NewStore(dbPath)
	if err != nil {
		log.Fatalf("Failed to create store: %v", err)
	}
	defer dataStore.Close()

	log.Printf("Database initialized at: %s", dbPath)

	roomManager := room.NewRoomManager()
	connectionManager := ws.NewConnectionManager(roomManager, keyManager, dataStore)
	handler := api.NewHandler(roomManager, keyManager, connectionManager, dataStore)

	r := gin.Default()

	r.Use(cors.New(cors.Config{
		AllowAllOrigins:  true,
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Accept", "Authorization", "Sec-WebSocket-Protocol"},
		ExposeHeaders:    []string{"Sec-WebSocket-Protocol"},
		AllowCredentials: true,
	}))

	apiV1 := r.Group("/api/v1")
	{
		apiV1.GET("/health", handler.Health)
		apiV1.GET("/public-key", handler.GetPublicKey)

		rooms := apiV1.Group("/rooms")
		{
			rooms.POST("", handler.CreateRoom)
			rooms.POST("/:room_id/join", handler.JoinRoom)
			rooms.GET("/:room_id", handler.GetRoomInfo)
			rooms.POST("/:room_id/kick", handler.KickUser)
			rooms.POST("/:room_id/signature", handler.GenerateKickSignature)

			canvas := rooms.Group("/:room_id/canvas")
			{
				canvas.GET("/state", handler.GetCurrentState)
				canvas.GET("/snapshot", handler.GetLatestSnapshot)
				canvas.GET("/snapshots", handler.GetSnapshotHistory)
				canvas.GET("/operations", handler.GetOperationHistory)
				canvas.POST("/rollback/time", handler.RollbackByTime)
				canvas.POST("/rollback/snapshot", handler.RollbackBySnapshot)
			}
		}
	}

	r.GET("/ws/:room_id", connectionManager.HandleWebSocket)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Server starting on port %s...", port)
	log.Printf("WebSocket endpoint: ws://localhost:%s/ws/:room_id", port)
	log.Printf("API endpoint: http://localhost:%s/api/v1", port)
	log.Printf("Canvas state retention: 5 minutes")
	log.Printf("Snapshot interval: 10 seconds")

	if err := r.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
