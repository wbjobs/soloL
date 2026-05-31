package replay

import (
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/timeline-wars/server/pkg/protocol"
)

type ReplayData struct {
	RoomID     string             `json:"roomId"`
	RandomSeed int64              `json:"randomSeed"`
	Players    []protocol.Player  `json:"players"`
	Rounds     []RoundData        `json:"rounds"`
	StartTime  int64              `json:"startTime"`
	EndTime    int64              `json:"endTime"`
	WinnerTeam int                `json:"winnerTeam"`
}

type RoundData struct {
	RoundNumber int                 `json:"roundNumber"`
	Timelines   []protocol.Timeline `json:"timelines"`
	FinalState  protocol.GameState  `json:"finalState"`
}

type ReplayRecorder struct {
	data      ReplayData
	mu        sync.Mutex
	filePath  string
	maxRounds int
}

func NewReplayRecorder(roomID string, randomSeed int64, players []protocol.Player, filePath string) *ReplayRecorder {
	if filePath == "" {
		filePath = fmt.Sprintf("replays/replay_%s_%d.json", roomID, time.Now().UnixMilli())
	}
	playersCopy := make([]protocol.Player, len(players))
	copy(playersCopy, players)
	return &ReplayRecorder{
		data: ReplayData{
			RoomID:     roomID,
			RandomSeed: randomSeed,
			Players:    playersCopy,
			StartTime:  time.Now().UnixMilli(),
			Rounds:     make([]RoundData, 0),
		},
		filePath:  filePath,
		maxRounds: 0,
	}
}

func (r *ReplayRecorder) RecordRound(roundNumber int, timelines []protocol.Timeline, finalState protocol.GameState) {
	r.mu.Lock()
	defer r.mu.Unlock()

	timelinesCopy := make([]protocol.Timeline, len(timelines))
	copy(timelinesCopy, timelines)

	round := RoundData{
		RoundNumber: roundNumber,
		Timelines:   timelinesCopy,
		FinalState:  finalState,
	}
	r.data.Rounds = append(r.data.Rounds, round)

	if roundNumber > r.maxRounds {
		r.maxRounds = roundNumber
	}
}

func (r *ReplayRecorder) SetWinner(winnerTeam int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.data.WinnerTeam = winnerTeam
	r.data.EndTime = time.Now().UnixMilli()
}

func (r *ReplayRecorder) Save() error {
	r.mu.Lock()
	defer r.mu.Unlock()

	dir := "replays"
	if r.filePath != "" {
		lastSlash := -1
		for i := len(r.filePath) - 1; i >= 0; i-- {
			if r.filePath[i] == '/' || r.filePath[i] == '\\' {
				lastSlash = i
				break
			}
		}
		if lastSlash > 0 {
			dir = r.filePath[:lastSlash]
		}
	}

	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create replay directory: %w", err)
	}

	data, err := json.MarshalIndent(r.data, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal replay data: %w", err)
	}

	if err := os.WriteFile(r.filePath, data, 0644); err != nil {
		return fmt.Errorf("failed to write replay file: %w", err)
	}

	return nil
}

func (r *ReplayRecorder) GetData() ReplayData {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.data
}

type ReplayPlayer struct {
	data         ReplayData
	currentRound int
	currentFrame int
	playing      bool
	mu           sync.Mutex
}

func NewReplayPlayer(data ReplayData) *ReplayPlayer {
	return &ReplayPlayer{
		data:         data,
		currentRound: 0,
		currentFrame: 0,
		playing:      false,
	}
}

func LoadFromFile(filePath string) (*ReplayPlayer, error) {
	fileData, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read replay file: %w", err)
	}

	var replayData ReplayData
	if err := json.Unmarshal(fileData, &replayData); err != nil {
		return nil, fmt.Errorf("failed to parse replay data: %w", err)
	}

	return NewReplayPlayer(replayData), nil
}

func (p *ReplayPlayer) GetRound(roundNumber int) (*RoundData, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	for i := range p.data.Rounds {
		if p.data.Rounds[i].RoundNumber == roundNumber {
			return &p.data.Rounds[i], nil
		}
	}

	return nil, fmt.Errorf("round %d not found", roundNumber)
}

func (p *ReplayPlayer) GetTotalRounds() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.data.Rounds)
}

func (p *ReplayPlayer) GetCurrentRound() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.currentRound
}

func (p *ReplayPlayer) SetRound(roundNumber int) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	for i := range p.data.Rounds {
		if p.data.Rounds[i].RoundNumber == roundNumber {
			p.currentRound = roundNumber
			p.currentFrame = 0
			return nil
		}
	}

	return fmt.Errorf("round %d not found", roundNumber)
}

func (p *ReplayPlayer) NextRound() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.currentRound >= len(p.data.Rounds) {
		return fmt.Errorf("already at last round")
	}

	p.currentRound++
	p.currentFrame = 0
	return nil
}

func (p *ReplayPlayer) PrevRound() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.currentRound <= 1 {
		return fmt.Errorf("already at first round")
	}

	p.currentRound--
	p.currentFrame = 0
	return nil
}

func (p *ReplayPlayer) GetFinalState(roundNumber int) (*protocol.GameState, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	for i := range p.data.Rounds {
		if p.data.Rounds[i].RoundNumber == roundNumber {
			return &p.data.Rounds[i].FinalState, nil
		}
	}

	return nil, fmt.Errorf("round %d not found", roundNumber)
}

func (p *ReplayPlayer) GetData() ReplayData {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.data
}
