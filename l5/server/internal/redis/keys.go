package redis

import "fmt"

const (
	prefix            = "tw:"
	roomPrefix        = prefix + "room:"
	roomPlayersPrefix = prefix + "room:players:"
	roomStatePrefix   = prefix + "room:state:"
	playerPrefix      = prefix + "player:"
	playerRoomPrefix  = prefix + "player:room:"
	playerTokenPrefix = prefix + "player:token:"
	snapshotsPrefix   = prefix + "snapshots:"
	timelinesPrefix   = prefix + "timelines:"
	channelPrefix     = prefix + "channel:"
)

func RoomKey(roomID string) string {
	return roomPrefix + roomID
}

func RoomPlayersKey(roomID string) string {
	return roomPlayersPrefix + roomID
}

func RoomStateKey(roomID string) string {
	return roomStatePrefix + roomID
}

func PlayerKey(playerID string) string {
	return playerPrefix + playerID
}

func PlayerRoomKey(playerID string) string {
	return playerRoomPrefix + playerID
}

func PlayerTokenKey(playerID string) string {
	return playerTokenPrefix + playerID
}

func SnapshotsKey(roomID string) string {
	return snapshotsPrefix + roomID
}

func TimelinesKey(roomID string) string {
	return timelinesPrefix + roomID
}

func BroadcastChannel(roomID string) string {
	return fmt.Sprintf("%sbroadcast:%s", channelPrefix, roomID)
}

func PrivateChannel(playerID string) string {
	return fmt.Sprintf("%sprivate:%s", channelPrefix, playerID)
}
