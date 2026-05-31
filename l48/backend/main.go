package main

import (
	"log"
	"net/http"
	"vct-gi-system/config"
	"vct-gi-system/database"
	"vct-gi-system/handler"
	"vct-gi-system/middleware"
	"vct-gi-system/service"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func main() {
	if err := config.LoadConfig(); err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}
	log.Println("Config loaded successfully")

	if err := database.InitDB(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	log.Println("Database initialized successfully")

	r := gin.Default()

	corsConfig := cors.DefaultConfig()
	corsConfig.AllowAllOrigins = true
	corsConfig.AllowMethods = []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}
	corsConfig.AllowHeaders = []string{"Origin", "Content-Type", "Accept", "Authorization"}
	r.Use(cors.New(corsConfig))

	authHandler := handler.NewAuthHandler()
	sceneHandler := handler.NewSceneHandler()
	voxelHandler := handler.NewVoxelHandler()
	lightHandler := handler.NewLightHandler()
	wsHandler := handler.NewWebSocketHandler()

	bakeService := service.NewBakeService(wsHandler)
	lightService := service.NewLightService(wsHandler)
	dynamicObjectService := service.NewDynamicObjectService(wsHandler)

	bakeHandler := handler.NewBakeHandler(bakeService)
	dynamicObjectHandler := handler.NewDynamicObjectHandler(dynamicObjectService)

	api := r.Group("/api")
	{
		api.GET("/ping", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"message": "pong"})
		})

		auth := api.Group("/auth")
		{
			auth.POST("/register", authHandler.Register)
			auth.POST("/login", authHandler.Login)
			auth.POST("/logout", middleware.AuthMiddleware(), authHandler.Logout)
			auth.GET("/me", middleware.AuthMiddleware(), authHandler.Me)
		}

		scenes := api.Group("/scenes")
		scenes.Use(middleware.AuthMiddleware())
		{
			scenes.POST("", sceneHandler.Create)
			scenes.GET("", sceneHandler.List)
			scenes.GET("/:id", sceneHandler.GetByID)
			scenes.PUT("/:id", sceneHandler.Update)
			scenes.DELETE("/:id", sceneHandler.Delete)

			lights := scenes.Group("/:scene_id/lights")
			{
				lights.POST("", lightHandler.Create)
				lights.POST("/batch", lightHandler.BatchCreate)
				lights.GET("", lightHandler.List)
				lights.GET("/:id", lightHandler.GetByID)
				lights.PUT("/:id", lightHandler.Update)
				lights.PATCH("/:id/toggle", lightHandler.Toggle)
				lights.DELETE("/:id", lightHandler.Delete)

				lights.PATCH("/:id/parameters", func(c *gin.Context) {
					userID, _ := middleware.GetUserID(c)
					sceneID, _ := uuid.Parse(c.Param("scene_id"))
					lightID, _ := uuid.Parse(c.Param("id"))

					var params service.LightUpdateParams
					if err := c.ShouldBindJSON(&params); err != nil {
						c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
						return
					}

					light, err := lightService.UpdateLightParameters(sceneID, lightID, userID, params)
					if err != nil {
						c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
						return
					}

					c.JSON(http.StatusOK, light)
				})
			}

			voxel := scenes.Group("/:scene_id/voxel")
			{
				voxel.POST("/grids", voxelHandler.CreateGrid)
				voxel.GET("/grids", voxelHandler.ListGrids)
				voxel.GET("/grids/active", voxelHandler.GetActiveGrid)
				voxel.GET("/grids/:id", voxelHandler.GetGrid)
				voxel.DELETE("/grids/:id", voxelHandler.DeleteGrid)
				voxel.PATCH("/grids/:id/active", voxelHandler.SetActiveGrid)

				voxel.GET("/grids/:grid_id/data", voxelHandler.QueryVoxelData)
				voxel.POST("/grids/:grid_id/data", voxelHandler.BatchUpsertVoxelData)
				voxel.GET("/grids/:grid_id/count", voxelHandler.GetVoxelCount)
			}

			bake := scenes.Group("/:scene_id/bake")
			{
				bake.POST("", bakeHandler.StartBake)
				bake.GET("", bakeHandler.ListBakeTasks)
				bake.GET("/:task_id", bakeHandler.GetBakeTask)
				bake.GET("/:task_id/progress", bakeHandler.GetBakeProgress)
				bake.POST("/:task_id/cancel", bakeHandler.CancelBake)
				bake.GET("/:task_id/result", bakeHandler.GetBakeResult)
			}

			objects := scenes.Group("/:scene_id/objects")
			{
				objects.POST("", dynamicObjectHandler.Create)
				objects.GET("", dynamicObjectHandler.List)
				objects.GET("/:id", dynamicObjectHandler.GetByID)
				objects.PUT("/:id", dynamicObjectHandler.Update)
				objects.DELETE("/:id", dynamicObjectHandler.Delete)
				objects.PATCH("/positions/batch", dynamicObjectHandler.BatchUpdatePositions)
			}

			ws := scenes.Group("/:scene_id/ws")
			{
				ws.GET("", wsHandler.HandleConnection)
			}
		}
	}

	bakeService.EnqueuePendingTasks()

	log.Printf("Server starting on :%s", config.AppConfig.ServerPort)
	if err := r.Run(":" + config.AppConfig.ServerPort); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
