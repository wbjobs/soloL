package redis

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/vmihailenco/msgpack/v5"
)

var (
	ErrRoomNotFound   = errors.New("room not found")
	ErrPlayerNotFound = errors.New("player not found")
	ErrStateNotFound  = errors.New("game state not found")
)

type Client struct {
	rdb *redis.Client
}

type Room struct {
	ID        string    `msgpack:"id"`
	Name      string    `msgpack:"name"`
	OwnerID   string    `msgpack:"owner_id"`
	MaxPlayers int      `msgpack:"max_players"`
	CreatedAt time.Time `msgpack:"created_at"`
	Status    string    `msgpack:"status"`
}

type Player struct {
	ID       string    `msgpack:"id"`
	Name     string    `msgpack:"name"`
	RoomID   string    `msgpack:"room_id"`
	JoinedAt time.Time `msgpack:"joined_at"`
	IsOnline bool      `msgpack:"is_online"`
}

type GameState struct {
	RoomID    string                 `msgpack:"room_id"`
	Phase     string                 `msgpack:"phase"`
	Turn      int                    `msgpack:"turn"`
	Data      map[string]interface{} `msgpack:"data"`
	UpdatedAt time.Time              `msgpack:"updated_at"`
}

type Snapshot struct {
	ID        string                 `msgpack:"id"`
	RoomID    string                 `msgpack:"room_id"`
	Turn      int                    `msgpack:"turn"`
	State     map[string]interface{} `msgpack:"state"`
	CreatedAt time.Time              `msgpack:"created_at"`
}

type TimelineEvent struct {
	ID        string                 `msgpack:"id"`
	RoomID    string                 `msgpack:"room_id"`
	Turn      int                    `msgpack:"turn"`
	PlayerID  string                 `msgpack:"player_id"`
	Action    string                 `msgpack:"action"`
	Data      map[string]interface{} `msgpack:"data"`
	Timestamp time.Time              `msgpack:"timestamp"`
}

type Config struct {
	Addr     string
	Password string
	DB       int
}

func NewClient(cfg Config) (*Client, error) {
	rdb := redis.NewClient(&redis.Options{
		Addr:     cfg.Addr,
		Password: cfg.Password,
		DB:       cfg.DB,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := rdb.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("failed to connect to redis: %w", err)
	}

	return &Client{rdb: rdb}, nil
}

func (c *Client) Close() error {
	return c.rdb.Close()
}

func (c *Client) SaveRoom(ctx context.Context, room *Room, expiration time.Duration) error {
	data, err := msgpack.Marshal(room)
	if err != nil {
		return fmt.Errorf("failed to marshal room: %w", err)
	}

	key := RoomKey(room.ID)
	if err := c.rdb.Set(ctx, key, data, expiration).Err(); err != nil {
		return fmt.Errorf("failed to save room: %w", err)
	}

	return nil
}

func (c *Client) GetRoom(ctx context.Context, roomID string) (*Room, error) {
	key := RoomKey(roomID)
	data, err := c.rdb.Get(ctx, key).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, ErrRoomNotFound
		}
		return nil, fmt.Errorf("failed to get room: %w", err)
	}

	var room Room
	if err := msgpack.Unmarshal(data, &room); err != nil {
		return nil, fmt.Errorf("failed to unmarshal room: %w", err)
	}

	return &room, nil
}

func (c *Client) DeleteRoom(ctx context.Context, roomID string) error {
	pipe := c.rdb.Pipeline()

	pipe.Del(ctx, RoomKey(roomID))
	pipe.Del(ctx, RoomPlayersKey(roomID))
	pipe.Del(ctx, RoomStateKey(roomID))
	pipe.Del(ctx, SnapshotsKey(roomID))
	pipe.Del(ctx, TimelinesKey(roomID))

	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("failed to delete room: %w", err)
	}

	return nil
}

func (c *Client) AddPlayerToRoom(ctx context.Context, roomID, playerID string) error {
	key := RoomPlayersKey(roomID)
	score := float64(time.Now().Unix())

	if err := c.rdb.ZAdd(ctx, key, redis.Z{Score: score, Member: playerID}).Err(); err != nil {
		return fmt.Errorf("failed to add player to room: %w", err)
	}

	return nil
}

func (c *Client) RemovePlayerFromRoom(ctx context.Context, roomID, playerID string) error {
	key := RoomPlayersKey(roomID)
	if err := c.rdb.ZRem(ctx, key, playerID).Err(); err != nil {
		return fmt.Errorf("failed to remove player from room: %w", err)
	}

	return nil
}

func (c *Client) GetRoomPlayers(ctx context.Context, roomID string) ([]string, error) {
	key := RoomPlayersKey(roomID)
	players, err := c.rdb.ZRange(ctx, key, 0, -1).Result()
	if err != nil {
		return nil, fmt.Errorf("failed to get room players: %w", err)
	}

	return players, nil
}

func (c *Client) SavePlayer(ctx context.Context, player *Player, expiration time.Duration) error {
	data, err := msgpack.Marshal(player)
	if err != nil {
		return fmt.Errorf("failed to marshal player: %w", err)
	}

	key := PlayerKey(player.ID)
	if err := c.rdb.Set(ctx, key, data, expiration).Err(); err != nil {
		return fmt.Errorf("failed to save player: %w", err)
	}

	if player.RoomID != "" {
		if err := c.rdb.Set(ctx, PlayerRoomKey(player.ID), player.RoomID, expiration).Err(); err != nil {
			return fmt.Errorf("failed to save player room mapping: %w", err)
		}
	}

	return nil
}

func (c *Client) GetPlayer(ctx context.Context, playerID string) (*Player, error) {
	key := PlayerKey(playerID)
	data, err := c.rdb.Get(ctx, key).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, ErrPlayerNotFound
		}
		return nil, fmt.Errorf("failed to get player: %w", err)
	}

	var player Player
	if err := msgpack.Unmarshal(data, &player); err != nil {
		return nil, fmt.Errorf("failed to unmarshal player: %w", err)
	}

	return &player, nil
}

func (c *Client) DeletePlayer(ctx context.Context, playerID string) error {
	pipe := c.rdb.Pipeline()

	pipe.Del(ctx, PlayerKey(playerID))
	pipe.Del(ctx, PlayerRoomKey(playerID))
	pipe.Del(ctx, PlayerTokenKey(playerID))

	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("failed to delete player: %w", err)
	}

	return nil
}

func (c *Client) SetReconnectToken(ctx context.Context, playerID, token string, expiration time.Duration) error {
	key := PlayerTokenKey(playerID)
	if err := c.rdb.Set(ctx, key, token, expiration).Err(); err != nil {
		return fmt.Errorf("failed to set reconnect token: %w", err)
	}

	return nil
}

func (c *Client) GetReconnectToken(ctx context.Context, playerID string) (string, error) {
	key := PlayerTokenKey(playerID)
	token, err := c.rdb.Get(ctx, key).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return "", nil
		}
		return "", fmt.Errorf("failed to get reconnect token: %w", err)
	}

	return token, nil
}

func (c *Client) SaveGameState(ctx context.Context, state *GameState, expiration time.Duration) error {
	data, err := msgpack.Marshal(state)
	if err != nil {
		return fmt.Errorf("failed to marshal game state: %w", err)
	}

	key := RoomStateKey(state.RoomID)
	if err := c.rdb.Set(ctx, key, data, expiration).Err(); err != nil {
		return fmt.Errorf("failed to save game state: %w", err)
	}

	return nil
}

func (c *Client) GetGameState(ctx context.Context, roomID string) (*GameState, error) {
	key := RoomStateKey(roomID)
	data, err := c.rdb.Get(ctx, key).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, ErrStateNotFound
		}
		return nil, fmt.Errorf("failed to get game state: %w", err)
	}

	var state GameState
	if err := msgpack.Unmarshal(data, &state); err != nil {
		return nil, fmt.Errorf("failed to unmarshal game state: %w", err)
	}

	return &state, nil
}

func (c *Client) SaveSnapshot(ctx context.Context, snapshot *Snapshot) error {
	data, err := msgpack.Marshal(snapshot)
	if err != nil {
		return fmt.Errorf("failed to marshal snapshot: %w", err)
	}

	key := SnapshotsKey(snapshot.RoomID)
	score := float64(snapshot.Turn)

	if err := c.rdb.ZAdd(ctx, key, redis.Z{Score: score, Member: data}).Err(); err != nil {
		return fmt.Errorf("failed to save snapshot: %w", err)
	}

	return nil
}

func (c *Client) GetSnapshots(ctx context.Context, roomID string, startTurn, endTurn int64) ([]*Snapshot, error) {
	key := SnapshotsKey(roomID)
	opt := &redis.ZRangeBy{
		Min: fmt.Sprintf("%d", startTurn),
		Max: fmt.Sprintf("%d", endTurn),
	}

	results, err := c.rdb.ZRangeByScore(ctx, key, opt).Result()
	if err != nil {
		return nil, fmt.Errorf("failed to get snapshots: %w", err)
	}

	snapshots := make([]*Snapshot, 0, len(results))
	for _, result := range results {
		var snapshot Snapshot
		if err := msgpack.Unmarshal([]byte(result), &snapshot); err != nil {
			return nil, fmt.Errorf("failed to unmarshal snapshot: %w", err)
		}
		snapshots = append(snapshots, &snapshot)
	}

	return snapshots, nil
}

func (c *Client) SaveTimeline(ctx context.Context, event *TimelineEvent) error {
	data, err := msgpack.Marshal(event)
	if err != nil {
		return fmt.Errorf("failed to marshal timeline event: %w", err)
	}

	key := TimelinesKey(event.RoomID)
	score := float64(event.Timestamp.UnixNano())

	member, err := json.Marshal(map[string]interface{}{
		"id":   event.ID,
		"data": data,
	})
	if err != nil {
		return fmt.Errorf("failed to marshal timeline member: %w", err)
	}

	if err := c.rdb.ZAdd(ctx, key, redis.Z{Score: score, Member: member}).Err(); err != nil {
		return fmt.Errorf("failed to save timeline event: %w", err)
	}

	return nil
}

func (c *Client) GetTimelines(ctx context.Context, roomID string, limit int64) ([]*TimelineEvent, error) {
	key := TimelinesKey(roomID)
	results, err := c.rdb.ZRevRange(ctx, key, 0, limit-1).Result()
	if err != nil {
		return nil, fmt.Errorf("failed to get timelines: %w", err)
	}

	events := make([]*TimelineEvent, 0, len(results))
	for _, result := range results {
		var wrapper struct {
			ID   string          `json:"id"`
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal([]byte(result), &wrapper); err != nil {
			return nil, fmt.Errorf("failed to unmarshal timeline wrapper: %w", err)
		}

		var event TimelineEvent
		if err := msgpack.Unmarshal(wrapper.Data, &event); err != nil {
			return nil, fmt.Errorf("failed to unmarshal timeline event: %w", err)
		}
		events = append(events, &event)
	}

	return events, nil
}

func (c *Client) GetPlayerRoom(ctx context.Context, playerID string) (string, error) {
	key := PlayerRoomKey(playerID)
	roomID, err := c.rdb.Get(ctx, key).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return "", nil
		}
		return "", fmt.Errorf("failed to get player room: %w", err)
	}

	return roomID, nil
}
