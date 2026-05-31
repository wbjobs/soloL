package models

type WSMessage struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}

type ResourceUpdatePayload struct {
	Resources  Resources          `json:"resources"`
	Production ResourceProduction `json:"production"`
}

type EventPayload struct {
	Event GameEvent `json:"event"`
}

type TileUpdatePayload struct {
	Tile Tile `json:"tile"`
}

type TimeUpdatePayload struct {
	GameTime GameTime `json:"game_time"`
}

type PathResult struct {
	Path [][2]int `json:"path"`
	Cost int      `json:"cost"`
}

type TradeUpdatePayload struct {
	Transaction TradeTransaction `json:"transaction"`
}

type OrderBookUpdatePayload struct {
	OrderBook OrderBook `json:"order_book"`
}
