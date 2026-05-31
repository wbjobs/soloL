package game

import (
	"citybuilder/internal/database"
	"citybuilder/internal/models"
	"errors"
	"fmt"
	"sort"
	"sync"
	"time"
)

type TradeManager struct {
	resourceMgr  *ResourceManager
	mu           sync.Mutex
	listeners    []func(*models.TradeTransaction)
	hasTradePost bool
}

func NewTradeManager(resourceMgr *ResourceManager) *TradeManager {
	return &TradeManager{
		resourceMgr: resourceMgr,
		listeners:   make([]func(*models.TradeTransaction), 0),
	}
}

func (tm *TradeManager) Init() error {
	tm.initTimescaleDB()

	if err := database.DB.AutoMigrate(
		&models.TradeOrder{},
		&models.TradeTransaction{},
		&models.PriceHistory{},
	); err != nil {
		return fmt.Errorf("failed to migrate trade tables: %w", err)
	}

	return nil
}

func (tm *TradeManager) initTimescaleDB() {
	database.DB.Exec("CREATE EXTENSION IF NOT EXISTS timescaledb")
	database.DB.Exec(`
		SELECT create_hypertable(
			'price_history', 
			'time',
			if_not_exists => TRUE
		)
	`)
}

func (tm *TradeManager) CheckTradePost() bool {
	var count int64
	database.DB.Model(&models.Tile{}).
		Joins("JOIN buildings ON buildings.id = tiles.building_id").
		Where("buildings.type = ?", models.BuildingTradePost).
		Count(&count)
	tm.hasTradePost = count > 0
	return tm.hasTradePost
}

func (tm *TradeManager) CreateOrder(side models.OrderSide, resourceType models.ResourceType, quantity, unitPrice int) (*models.TradeOrder, error) {
	tm.mu.Lock()
	defer tm.mu.Unlock()

	if !tm.hasTradePost {
		if !tm.CheckTradePost() {
			return nil, errors.New("need trade post to trade")
		}
	}

	if quantity <= 0 || unitPrice <= 0 {
		return nil, errors.New("invalid quantity or price")
	}

	res := tm.resourceMgr.GetResources()

	if side == models.OrderSell {
		available := getResourceByType(res, resourceType)
		if available < quantity {
			return nil, errors.New("not enough resources to sell")
		}
		tm.spendResource(resourceType, quantity)
	} else if side == models.OrderBuy {
		totalCost := quantity * unitPrice
		if res.Stone < totalCost {
			return nil, errors.New("not enough stone to buy")
		}
		tm.resourceMgr.SpendResources(0, totalCost, 0)
	}

	order := &models.TradeOrder{
		Side:         side,
		ResourceType: resourceType,
		Quantity:     quantity,
		RemainingQty: quantity,
		UnitPrice:    unitPrice,
		Status:       models.OrderOpen,
		ExpiresAt:    time.Now().Add(48 * time.Hour),
		CreatedAt:    time.Now(),
	}

	if err := database.DB.Create(order).Error; err != nil {
		return nil, err
	}

	go tm.matchOrder(order)

	return order, nil
}

func (tm *TradeManager) matchOrder(newOrder *models.TradeOrder) {
	tm.mu.Lock()
	defer tm.mu.Unlock()

	var matchingOrders []models.TradeOrder
	query := database.DB.Where(
		"side != ? AND resource_type = ? AND status IN ?",
		newOrder.Side, newOrder.ResourceType, []models.OrderStatus{models.OrderOpen, models.OrderPartial},
	)

	if newOrder.Side == models.OrderBuy {
		query = query.Order("unit_price ASC, created_at ASC")
	} else {
		query = query.Order("unit_price DESC, created_at ASC")
	}

	query.Find(&matchingOrders)

	for i := range matchingOrders {
		matchOrder := &matchingOrders[i]
		if newOrder.RemainingQty <= 0 {
			break
		}

		var tradePrice int
		if newOrder.Side == models.OrderBuy {
			if matchOrder.UnitPrice > newOrder.UnitPrice {
				continue
			}
			tradePrice = matchOrder.UnitPrice
		} else {
			if matchOrder.UnitPrice < newOrder.UnitPrice {
				continue
			}
			tradePrice = newOrder.UnitPrice
		}

		tradeQty := min(newOrder.RemainingQty, matchOrder.RemainingQty)
		totalPrice := tradeQty * tradePrice

		buyOrderID := getBuyOrderID(newOrder, matchOrder)
		sellOrderID := getSellOrderID(newOrder, matchOrder)

		transaction := &models.TradeTransaction{
			BuyOrderID:   buyOrderID,
			SellOrderID:  sellOrderID,
			ResourceType: newOrder.ResourceType,
			Quantity:     tradeQty,
			UnitPrice:    tradePrice,
			TotalPrice:   totalPrice,
			CreatedAt:    time.Now(),
		}

		if err := database.DB.Create(transaction).Error; err != nil {
			continue
		}

		newOrder.RemainingQty -= tradeQty
		matchOrder.RemainingQty -= tradeQty

		if matchOrder.RemainingQty <= 0 {
			matchOrder.Status = models.OrderFilled
			now := time.Now()
			matchOrder.FilledAt = &now
		} else {
			matchOrder.Status = models.OrderPartial
		}
		database.DB.Save(matchOrder)

		tm.settleTrade(matchOrder.Side, newOrder.ResourceType, tradeQty, totalPrice)

		tm.notifyListeners(transaction)
	}

	if newOrder.RemainingQty <= 0 {
		newOrder.Status = models.OrderFilled
		now := time.Now()
		newOrder.FilledAt = &now
	} else if newOrder.RemainingQty < newOrder.Quantity {
		newOrder.Status = models.OrderPartial
	}
	database.DB.Save(newOrder)

	tm.recordPriceHistory(newOrder.ResourceType)
}

func (tm *TradeManager) settleTrade(side models.OrderSide, resourceType models.ResourceType, quantity, totalPrice int) {
	if side == models.OrderBuy {
		tm.addResource(resourceType, quantity)
	} else if side == models.OrderSell {
		tm.resourceMgr.AddResources(0, totalPrice, 0)
	}
}

func (tm *TradeManager) CancelOrder(orderID uint) error {
	tm.mu.Lock()
	defer tm.mu.Unlock()

	var order models.TradeOrder
	if err := database.DB.First(&order, orderID).Error; err != nil {
		return err
	}

	if order.Status != models.OrderOpen && order.Status != models.OrderPartial {
		return errors.New("order cannot be cancelled")
	}

	order.Status = models.OrderCancelled
	database.DB.Save(&order)

	if order.Side == models.OrderSell && order.RemainingQty > 0 {
		tm.addResource(order.ResourceType, order.RemainingQty)
	} else if order.Side == models.OrderBuy && order.RemainingQty > 0 {
		refund := order.RemainingQty * order.UnitPrice
		tm.resourceMgr.AddResources(0, refund, 0)
	}

	return nil
}

func (tm *TradeManager) ExpireOrders() {
	tm.mu.Lock()
	defer tm.mu.Unlock()

	var expiredOrders []models.TradeOrder
	database.DB.Where("expires_at < ? AND status IN ?",
		time.Now(),
		[]models.OrderStatus{models.OrderOpen, models.OrderPartial},
	).Find(&expiredOrders)

	for _, order := range expiredOrders {
		order.Status = models.OrderExpired
		database.DB.Save(&order)

		if order.Side == models.OrderSell && order.RemainingQty > 0 {
			tm.addResource(order.ResourceType, order.RemainingQty)
		} else if order.Side == models.OrderBuy && order.RemainingQty > 0 {
			refund := order.RemainingQty * order.UnitPrice
			tm.resourceMgr.AddResources(0, refund, 0)
		}
	}
}

func (tm *TradeManager) GetOrderBook(resourceType models.ResourceType) (*models.OrderBook, error) {
	var sellOrders []models.TradeOrder
	database.DB.Where(
		"side = ? AND resource_type = ? AND status IN ?",
		models.OrderSell, resourceType, []models.OrderStatus{models.OrderOpen, models.OrderPartial},
	).Order("unit_price ASC, created_at ASC").Find(&sellOrders)

	var buyOrders []models.TradeOrder
	database.DB.Where(
		"side = ? AND resource_type = ? AND status IN ?",
		models.OrderBuy, resourceType, []models.OrderStatus{models.OrderOpen, models.OrderPartial},
	).Order("unit_price DESC, created_at ASC").Find(&buyOrders)

	asks := aggregateOrders(sellOrders)
	bids := aggregateOrders(buyOrders)

	sort.Slice(asks, func(i, j int) bool { return asks[i].UnitPrice < asks[j].UnitPrice })
	sort.Slice(bids, func(i, j int) bool { return bids[i].UnitPrice > bids[j].UnitPrice })

	return &models.OrderBook{
		ResourceType: resourceType,
		Bids:         bids,
		Asks:         asks,
	}, nil
}

func (tm *TradeManager) GetPriceChart(resourceType models.ResourceType, limit int) (*models.PriceChart, error) {
	if limit <= 0 {
		limit = 100
	}

	var transactions []models.TradeTransaction
	database.DB.Where("resource_type = ?", resourceType).
		Order("created_at DESC").
		Limit(limit).
		Find(&transactions)

	if len(transactions) == 0 {
		return &models.PriceChart{
			ResourceType: resourceType,
			Points:       []models.PricePoint{},
			CurrentAvg:   0,
		}, nil
	}

	points := make([]models.PricePoint, 0, len(transactions))
	var totalPrice float64
	var totalVolume int

	for i := len(transactions) - 1; i >= 0; i-- {
		tx := transactions[i]
		points = append(points, models.PricePoint{
			Time:     tx.CreatedAt.Format("2006-01-02 15:04:05"),
			AvgPrice: float64(tx.UnitPrice),
			Volume:   tx.Quantity,
		})
		totalPrice += float64(tx.UnitPrice) * float64(tx.Quantity)
		totalVolume += tx.Quantity
	}

	currentAvg := 0.0
	if totalVolume > 0 {
		currentAvg = totalPrice / float64(totalVolume)
	}

	return &models.PriceChart{
		ResourceType: resourceType,
		Points:       points,
		CurrentAvg:   currentAvg,
	}, nil
}

func (tm *TradeManager) GetMyOrders() ([]models.TradeOrder, error) {
	var orders []models.TradeOrder
	err := database.DB.Order("created_at DESC").Limit(50).Find(&orders).Error
	return orders, err
}

func (tm *TradeManager) recordPriceHistory(resourceType models.ResourceType) {
	hour := time.Now().Truncate(time.Hour)

	var txs []models.TradeTransaction
	database.DB.Where(
		"resource_type = ? AND created_at >= ? AND created_at < ?",
		resourceType, hour, hour.Add(time.Hour),
	).Find(&txs)

	if len(txs) == 0 {
		return
	}

	var totalPrice, minPrice, maxPrice, volume int
	minPrice = txs[0].UnitPrice
	maxPrice = txs[0].UnitPrice

	for _, tx := range txs {
		totalPrice += tx.UnitPrice * tx.Quantity
		volume += tx.Quantity
		if tx.UnitPrice < minPrice {
			minPrice = tx.UnitPrice
		}
		if tx.UnitPrice > maxPrice {
			maxPrice = tx.UnitPrice
		}
	}

	avgPrice := float64(totalPrice) / float64(volume)

	history := models.PriceHistory{
		Time:         hour,
		ResourceType: resourceType,
		AvgPrice:     avgPrice,
		MinPrice:     minPrice,
		MaxPrice:     maxPrice,
		Volume:       volume,
		TradeCount:   len(txs),
	}

	database.DB.Where("time = ? AND resource_type = ?", hour, resourceType).
		Assign(history).
		FirstOrCreate(&models.PriceHistory{})
}

func (tm *TradeManager) AddListener(fn func(*models.TradeTransaction)) {
	tm.mu.Lock()
	defer tm.mu.Unlock()
	tm.listeners = append(tm.listeners, fn)
}

func (tm *TradeManager) notifyListeners(tx *models.TradeTransaction) {
	for _, listener := range tm.listeners {
		go listener(tx)
	}
}

func (tm *TradeManager) spendResource(resourceType models.ResourceType, quantity int) {
	switch resourceType {
	case models.ResourceWood:
		tm.resourceMgr.SpendResources(quantity, 0, 0)
	case models.ResourceStone:
		tm.resourceMgr.SpendResources(0, quantity, 0)
	case models.ResourceFood:
		tm.resourceMgr.SpendResources(0, 0, quantity)
	}
}

func (tm *TradeManager) addResource(resourceType models.ResourceType, quantity int) {
	switch resourceType {
	case models.ResourceWood:
		tm.resourceMgr.AddResources(quantity, 0, 0)
	case models.ResourceStone:
		tm.resourceMgr.AddResources(0, quantity, 0)
	case models.ResourceFood:
		tm.resourceMgr.AddResources(0, 0, quantity)
	}
}

func getResourceByType(res models.Resources, resourceType models.ResourceType) int {
	switch resourceType {
	case models.ResourceWood:
		return res.Wood
	case models.ResourceStone:
		return res.Stone
	case models.ResourceFood:
		return res.Food
	}
	return 0
}

func aggregateOrders(orders []models.TradeOrder) []models.OrderBookEntry {
	priceMap := make(map[int]*models.OrderBookEntry)

	for _, order := range orders {
		entry, exists := priceMap[order.UnitPrice]
		if !exists {
			entry = &models.OrderBookEntry{
				UnitPrice: order.UnitPrice,
			}
			priceMap[order.UnitPrice] = entry
		}
		entry.Quantity += order.RemainingQty
		entry.OrderCount++
	}

	entries := make([]models.OrderBookEntry, 0, len(priceMap))
	for _, entry := range priceMap {
		entries = append(entries, *entry)
	}
	return entries
}

func getBuyOrderID(a, b *models.TradeOrder) uint {
	if a.Side == models.OrderBuy {
		return a.ID
	}
	return b.ID
}

func getSellOrderID(a, b *models.TradeOrder) uint {
	if a.Side == models.OrderSell {
		return a.ID
	}
	return b.ID
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
