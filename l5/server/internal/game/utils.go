package game

import (
	"time"
)

func generateUnitID(playerID string) string {
	return "unit_" + playerID + "_" + time.Now().Format("20060102150405") + "_" + randomString(4)
}

func randomString(n int) string {
	const letters = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, n)
	for i := range b {
		b[i] = letters[time.Now().UnixNano()%int64(len(letters))]
		time.Sleep(1 * time.Nanosecond)
	}
	return string(b)
}
