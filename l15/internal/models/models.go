package models

import (
	"time"
)

type TerrainType string

const (
	TerrainGrass   TerrainType = "grass"
	TerrainForest  TerrainType = "forest"
	TerrainMountain TerrainType = "mountain"
	TerrainWater   TerrainType = "water"
)

type BuildingType string

const (
	BuildingRoad       BuildingType = "road"
	BuildingHouse      BuildingType = "house"
	BuildingFarm       BuildingType = "farm"
	BuildingSawmill    BuildingType = "sawmill"
	BuildingQuarry     BuildingType = "quarry"
	BuildingMarket     BuildingType = "market"
	BuildingTradePost  BuildingType = "trade_post"
)

type Building struct {
	ID         uint           `gorm:"primaryKey" json:"id"`
	Type       BuildingType   `json:"type"`
	Name       string         `json:"name"`
	CostWood   int            `json:"cost_wood"`
	CostStone  int            `json:"cost_stone"`
	CostFood   int            `json:"cost_food"`
	ProdWood   int            `json:"prod_wood"`
	ProdStone  int            `json:"prod_stone"`
	ProdFood   int            `json:"prod_food"`
	Population int           `json:"population"`
	CreatedAt  time.Time      `json:"created_at"`
}

type Tile struct {
	ID          uint        `gorm:"primaryKey" json:"id"`
	X           int         `gorm:"index:idx_xy,unique" json:"x"`
	Y           int         `gorm:"index:idx_xy,unique" json:"y"`
	Terrain     TerrainType `json:"terrain"`
	BuildingID  *uint       `json:"building_id,omitempty"`
	Building    *Building   `gorm:"foreignKey:BuildingID" json:"building,omitempty"`
	HasRoad     bool        `json:"has_road"`
	IsOnFire    bool        `json:"is_on_fire"`
}

type Resources struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Wood      int       `json:"wood"`
	Stone     int       `json:"stone"`
	Food      int       `json:"food"`
	UpdatedAt time.Time `json:"updated_at"`
}

type ResourceProduction struct {
	WoodPerMinute  int `json:"wood_per_minute"`
	StonePerMinute int `json:"stone_per_minute"`
	FoodPerMinute  int `json:"food_per_minute"`
}

type Citizen struct {
	ID         uint      `gorm:"primaryKey" json:"id"`
	Name       string    `json:"name"`
	X          int       `json:"x"`
	Y          int       `json:"y"`
	HomeTileID *uint     `json:"home_tile_id,omitempty"`
	HomeTile   *Tile     `gorm:"foreignKey:HomeTileID" json:"home_tile,omitempty"`
	WorkTileID *uint     `json:"work_tile_id,omitempty"`
	WorkTile   *Tile     `gorm:"foreignKey:WorkTileID" json:"work_tile,omitempty"`
	IsWorking  bool      `json:"is_working"`
	CreatedAt  time.Time `json:"created_at"`
}

type GameTime struct {
	ID            uint      `gorm:"primaryKey" json:"id"`
	Day           int       `json:"day"`
	Hour          int       `json:"hour"`
	Minute        int       `json:"minute"`
	TotalMinutes  int64     `json:"total_minutes"`
	LastTick      time.Time `json:"last_tick"`
}

type GameEvent struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Type      string    `json:"type"`
	Message   string    `json:"message"`
	Severity  string    `json:"severity"`
	TileX     *int      `json:"tile_x,omitempty"`
	TileY     *int      `json:"tile_y,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

func (bt BuildingType) GetCost() (wood, stone, food int) {
	switch bt {
	case BuildingRoad:
		return 0, 5, 0
	case BuildingHouse:
		return 20, 10, 0
	case BuildingFarm:
		return 10, 5, 0
	case BuildingSawmill:
		return 30, 20, 0
	case BuildingQuarry:
		return 20, 30, 0
	case BuildingMarket:
		return 50, 50, 10
	case BuildingTradePost:
		return 80, 60, 30
	}
	return 0, 0, 0
}

func (bt BuildingType) GetProduction() (wood, stone, food int) {
	switch bt {
	case BuildingFarm:
		return 0, 0, 5
	case BuildingSawmill:
		return 3, 0, 0
	case BuildingQuarry:
		return 0, 3, 0
	case BuildingMarket:
		return 1, 1, 1
	case BuildingTradePost:
		return 0, 0, 0
	}
	return 0, 0, 0
}

func (bt BuildingType) GetPopulation() int {
	switch bt {
	case BuildingHouse:
		return 4
	}
	return 0
}

func (bt BuildingType) IsRoad() bool {
	return bt == BuildingRoad
}
