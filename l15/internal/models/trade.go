package models

import "time"

type ResourceType string

const (
	ResourceWood  ResourceType = "wood"
	ResourceStone ResourceType = "stone"
	ResourceFood  ResourceType = "food"
)

type OrderSide string

const (
	OrderSell OrderSide = "sell"
	OrderBuy  OrderSide = "buy"
)

type OrderStatus string

const (
	OrderOpen      OrderStatus = "open"
	OrderFilled    OrderStatus = "filled"
	OrderPartial   OrderStatus = "partial"
	OrderCancelled OrderStatus = "cancelled"
	OrderExpired   OrderStatus = "expired"
)

type TradeOrder struct {
	ID             uint        `gorm:"primaryKey" json:"id"`
	Side           OrderSide   `gorm:"index:idx_side_resource_status" json:"side"`
	ResourceType   ResourceType `gorm:"index:idx_side_resource_status" json:"resource_type"`
	Quantity       int         `json:"quantity"`
	RemainingQty   int         `json:"remaining_qty"`
	UnitPrice      int         `json:"unit_price"`
	Status         OrderStatus `gorm:"index:idx_side_resource_status" json:"status"`
	ExpiresAt      time.Time   `json:"expires_at"`
	FilledAt       *time.Time  `json:"filled_at,omitempty"`
	CreatedAt      time.Time   `gorm:"index:idx_created" json:"created_at"`
}

func (TradeOrder) TableName() string {
	return "trade_orders"
}

type TradeTransaction struct {
	ID           uint        `gorm:"primaryKey" json:"id"`
	BuyOrderID   uint        `json:"buy_order_id"`
	SellOrderID  uint        `json:"sell_order_id"`
	ResourceType ResourceType `json:"resource_type"`
	Quantity     int         `json:"quantity"`
	UnitPrice    int         `json:"unit_price"`
	TotalPrice   int         `json:"total_price"`
	CreatedAt    time.Time   `json:"created_at"`
}

func (TradeTransaction) TableName() string {
	return "trade_transactions"
}

type PriceHistory struct {
	Time         time.Time   `gorm:"primaryKey;index:idx_time_resource" json:"time"`
	ResourceType ResourceType `gorm:"primaryKey;index:idx_time_resource" json:"resource_type"`
	AvgPrice     float64     `json:"avg_price"`
	MinPrice     int         `json:"min_price"`
	MaxPrice     int         `json:"max_price"`
	Volume       int         `json:"volume"`
	TradeCount   int         `json:"trade_count"`
}

func (PriceHistory) TableName() string {
	return "price_history"
}

type OrderBookEntry struct {
	UnitPrice int `json:"unit_price"`
	Quantity  int `json:"quantity"`
	OrderCount int `json:"order_count"`
}

type OrderBook struct {
	ResourceType ResourceType      `json:"resource_type"`
	Bids         []OrderBookEntry  `json:"bids"`
	Asks         []OrderBookEntry  `json:"asks"`
}

type PricePoint struct {
	Time     string  `json:"time"`
	AvgPrice float64 `json:"avg_price"`
	Volume   int     `json:"volume"`
}

type PriceChart struct {
	ResourceType ResourceType  `json:"resource_type"`
	Points       []PricePoint  `json:"points"`
	CurrentAvg   float64      `json:"current_avg"`
}
