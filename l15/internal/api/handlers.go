package api

import (
	"citybuilder/internal/game"
	"citybuilder/internal/models"
	"citybuilder/internal/websocket"
	"encoding/json"
	"net/http"
	"strconv"
)

type Handler struct {
	gridMgr     *game.GridManager
	buildingMgr *game.BuildingManager
	resourceMgr *game.ResourceManager
	timeMgr     *game.TimeManager
	eventMgr    *game.EventManager
	pathfinder  *game.Pathfinder
	tradeMgr    *game.TradeManager
	wsHub       *websocket.Hub
}

func NewHandler(
	gridMgr *game.GridManager,
	buildingMgr *game.BuildingManager,
	resourceMgr *game.ResourceManager,
	timeMgr *game.TimeManager,
	eventMgr *game.EventManager,
	pathfinder *game.Pathfinder,
	tradeMgr *game.TradeManager,
	wsHub *websocket.Hub,
) *Handler {
	h := &Handler{
		gridMgr:     gridMgr,
		buildingMgr: buildingMgr,
		resourceMgr: resourceMgr,
		timeMgr:     timeMgr,
		eventMgr:    eventMgr,
		pathfinder:  pathfinder,
		tradeMgr:    tradeMgr,
		wsHub:       wsHub,
	}

	h.setupListeners()
	return h
}

func (h *Handler) setupListeners() {
	h.resourceMgr.AddListener(func(res *models.Resources, prod *models.ResourceProduction) {
		h.wsHub.Broadcast("resource_update", models.ResourceUpdatePayload{
			Resources:  *res,
			Production: *prod,
		})
	})

	h.timeMgr.AddListener(func(gt *models.GameTime) {
		h.wsHub.Broadcast("time_update", models.TimeUpdatePayload{
			GameTime: *gt,
		})
	})

	h.buildingMgr.AddListener(func(tile *models.Tile) {
		h.wsHub.Broadcast("tile_update", models.TileUpdatePayload{
			Tile: *tile,
		})
		h.pathfinder.InvalidatePathCache()
	})

	h.eventMgr.AddListener(func(event *models.GameEvent) {
		h.wsHub.Broadcast("event", models.EventPayload{
			Event: *event,
		})
	})

	h.tradeMgr.AddListener(func(tx *models.TradeTransaction) {
		h.wsHub.Broadcast("trade_update", models.TradeUpdatePayload{
			Transaction: *tx,
		})
	})
}

func (h *Handler) GetGrid(w http.ResponseWriter, r *http.Request) {
	startX, _ := strconv.Atoi(r.URL.Query().Get("startX"))
	startY, _ := strconv.Atoi(r.URL.Query().Get("startY"))
	endX, _ := strconv.Atoi(r.URL.Query().Get("endX"))
	endY, _ := strconv.Atoi(r.URL.Query().Get("endY"))

	if endX == 0 && endY == 0 {
		size := h.gridMgr.GetGridSize()
		endX, endY = size-1, size-1
	}

	tiles, err := h.gridMgr.GetTilesInRange(startX, startY, endX, endY)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(tiles)
}

func (h *Handler) GetTile(w http.ResponseWriter, r *http.Request) {
	x, _ := strconv.Atoi(r.URL.Query().Get("x"))
	y, _ := strconv.Atoi(r.URL.Query().Get("y"))

	tile, err := h.gridMgr.GetTile(x, y)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	json.NewEncoder(w).Encode(tile)
}

func (h *Handler) PlaceBuilding(w http.ResponseWriter, r *http.Request) {
	var req struct {
		X            int                  `json:"x"`
		Y            int                  `json:"y"`
		BuildingType models.BuildingType `json:"building_type"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	tile, err := h.buildingMgr.PlaceBuilding(req.X, req.Y, req.BuildingType)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	json.NewEncoder(w).Encode(tile)
}

func (h *Handler) DemolishBuilding(w http.ResponseWriter, r *http.Request) {
	var req struct {
		X int `json:"x"`
		Y int `json:"y"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	tile, err := h.buildingMgr.DemolishBuilding(req.X, req.Y)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	json.NewEncoder(w).Encode(tile)
}

func (h *Handler) GetResources(w http.ResponseWriter, r *http.Request) {
	resources := h.resourceMgr.GetResources()
	production := h.resourceMgr.GetProduction()

	json.NewEncoder(w).Encode(map[string]interface{}{
		"resources":  resources,
		"production": production,
	})
}

func (h *Handler) GetBuildings(w http.ResponseWriter, r *http.Request) {
	buildings, err := h.buildingMgr.GetAllBuildings()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(buildings)
}

func (h *Handler) GetTime(w http.ResponseWriter, r *http.Request) {
	gameTime := h.timeMgr.GetGameTime()
	json.NewEncoder(w).Encode(gameTime)
}

func (h *Handler) GetEvents(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit == 0 {
		limit = 20
	}

	events, err := h.eventMgr.GetRecentEvents(limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(events)
}

func (h *Handler) FindPath(w http.ResponseWriter, r *http.Request) {
	startX, _ := strconv.Atoi(r.URL.Query().Get("startX"))
	startY, _ := strconv.Atoi(r.URL.Query().Get("startY"))
	endX, _ := strconv.Atoi(r.URL.Query().Get("endX"))
	endY, _ := strconv.Atoi(r.URL.Query().Get("endY"))

	path, err := h.pathfinder.FindPath(startX, startY, endX, endY)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	json.NewEncoder(w).Encode(path)
}

func (h *Handler) GetGridSize(w http.ResponseWriter, r *http.Request) {
	size := h.gridMgr.GetGridSize()
	json.NewEncoder(w).Encode(map[string]int{"size": size})
}

func (h *Handler) CreateOrder(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Side         models.OrderSide    `json:"side"`
		ResourceType models.ResourceType `json:"resource_type"`
		Quantity     int               `json:"quantity"`
		UnitPrice    int               `json:"unit_price"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	order, err := h.tradeMgr.CreateOrder(req.Side, req.ResourceType, req.Quantity, req.UnitPrice)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	json.NewEncoder(w).Encode(order)
}

func (h *Handler) CancelOrder(w http.ResponseWriter, r *http.Request) {
	var req struct {
		OrderID uint `json:"order_id"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if err := h.tradeMgr.CancelOrder(req.OrderID); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	json.NewEncoder(w).Encode(map[string]string{"status": "cancelled"})
}

func (h *Handler) GetOrderBook(w http.ResponseWriter, r *http.Request) {
	resourceType := models.ResourceType(r.URL.Query().Get("resource_type"))
	if resourceType == "" {
		resourceType = models.ResourceWood
	}

	orderBook, err := h.tradeMgr.GetOrderBook(resourceType)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(orderBook)
}

func (h *Handler) GetPriceChart(w http.ResponseWriter, r *http.Request) {
	resourceType := models.ResourceType(r.URL.Query().Get("resource_type"))
	if resourceType == "" {
		resourceType = models.ResourceWood
	}

	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit == 0 {
		limit = 100
	}

	chart, err := h.tradeMgr.GetPriceChart(resourceType, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(chart)
}

func (h *Handler) GetMyOrders(w http.ResponseWriter, r *http.Request) {
	orders, err := h.tradeMgr.GetMyOrders()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(orders)
}
