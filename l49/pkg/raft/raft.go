package raft

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/big"
	"sync"
	"time"
)

type NodeState int

const (
	Follower NodeState = iota
	Candidate
	Leader
)

type LogEntry struct {
	Term    int
	Index   int
	Command interface{}
}

type RaftCommand struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}

type AppendEntriesRequest struct {
	Term         int
	LeaderID     string
	PrevLogIndex int
	PrevLogTerm  int
	Entries      []LogEntry
	LeaderCommit int
}

type AppendEntriesResponse struct {
	Term    int
	Success bool
}

type RequestVoteRequest struct {
	Term         int
	CandidateID  string
	LastLogIndex int
	LastLogTerm  int
}

type RequestVoteResponse struct {
	Term        int
	VoteGranted bool
}

type RaftNode struct {
	mu          sync.Mutex
	id          string
	state       NodeState
	currentTerm int
	votedFor    string
	log         []LogEntry
	commitIndex int
	lastApplied int
	nextIndex   map[string]int
	matchIndex  map[string]int
	peers       []string
	leaderID    string
	electionTimeout time.Duration
	heartbeatTimeout time.Duration
	lastHeartbeat time.Time
	applyCh     chan<- LogEntry
	stopCh      chan struct{}
}

func NewRaftNode(id string, peers []string, applyCh chan<- LogEntry) *RaftNode {
	return &RaftNode{
		id:               id,
		state:            Follower,
		currentTerm:      0,
		votedFor:         "",
		log:              make([]LogEntry, 0),
		commitIndex:      0,
		lastApplied:      0,
		nextIndex:        make(map[string]int),
		matchIndex:       make(map[string]int),
		peers:            peers,
		electionTimeout:  time.Duration(150+randIntn(150)) * time.Millisecond,
		heartbeatTimeout: 100 * time.Millisecond,
		applyCh:          applyCh,
		stopCh:           make(chan struct{}),
	}
}

func randIntn(n int) int {
	max := big.NewInt(int64(n))
	result, _ := rand.Int(rand.Reader, max)
	return int(result.Int64())
}

func (r *RaftNode) Start() {
	go r.run()
}

func (r *RaftNode) Stop() {
	close(r.stopCh)
}

func (r *RaftNode) run() {
	for {
		select {
		case <-r.stopCh:
			return
		default:
			switch r.state {
			case Follower:
				r.runFollower()
			case Candidate:
				r.runCandidate()
			case Leader:
				r.runLeader()
			}
		}
	}
}

func (r *RaftNode) runFollower() {
	timeout := time.After(r.electionTimeout)
	for r.state == Follower {
		select {
		case <-r.stopCh:
			return
		case <-timeout:
			r.mu.Lock()
			r.state = Candidate
			r.mu.Unlock()
			return
		}
	}
}

func (r *RaftNode) runCandidate() {
	r.mu.Lock()
	r.currentTerm++
	r.votedFor = r.id
	term := r.currentTerm
	lastLogIndex, lastLogTerm := r.lastLogInfo()
	r.mu.Unlock()

	voteCh := make(chan bool, len(r.peers))

	for _, peer := range r.peers {
		go func(peer string) {
			req := RequestVoteRequest{
				Term:         term,
				CandidateID:  r.id,
				LastLogIndex: lastLogIndex,
				LastLogTerm:  lastLogTerm,
			}
			resp, err := r.sendRequestVote(peer, req)
			if err == nil && resp.VoteGranted {
				voteCh <- true
			} else {
				voteCh <- false
			}
		}(peer)
	}

	timeout := time.After(r.electionTimeout)
	granted := 1

	for r.state == Candidate {
		select {
		case <-r.stopCh:
			return
		case v := <-voteCh:
			if v {
				granted++
			}
			if granted > len(r.peers)/2 {
				r.mu.Lock()
				r.state = Leader
				r.leaderID = r.id
				r.initLeaderState()
				r.mu.Unlock()
				return
			}
		case <-timeout:
			r.mu.Lock()
			r.state = Follower
			r.votedFor = ""
			r.mu.Unlock()
			return
		}
	}
}

func (r *RaftNode) runLeader() {
	ticker := time.NewTicker(r.heartbeatTimeout)
	defer ticker.Stop()

	for r.state == Leader {
		select {
		case <-r.stopCh:
			return
		case <-ticker.C:
			r.sendHeartbeats()
		}
	}
}

func (r *RaftNode) initLeaderState() {
	for _, peer := range r.peers {
		r.nextIndex[peer] = len(r.log) + 1
		r.matchIndex[peer] = 0
	}
}

func (r *RaftNode) sendHeartbeats() {
	r.mu.Lock()
	term := r.currentTerm
	leaderID := r.id
	commitIndex := r.commitIndex
	r.mu.Unlock()

	for _, peer := range r.peers {
		go func(peer string) {
			r.mu.Lock()
			prevLogIndex := r.nextIndex[peer] - 1
			prevLogTerm := 0
			if prevLogIndex > 0 && prevLogIndex <= len(r.log) {
				prevLogTerm = r.log[prevLogIndex-1].Term
			}
			entries := make([]LogEntry, 0)
			if r.nextIndex[peer] <= len(r.log) {
				entries = r.log[r.nextIndex[peer]-1:]
			}
			r.mu.Unlock()

			req := AppendEntriesRequest{
				Term:         term,
				LeaderID:     leaderID,
				PrevLogIndex: prevLogIndex,
				PrevLogTerm:  prevLogTerm,
				Entries:      entries,
				LeaderCommit: commitIndex,
			}

			resp, err := r.sendAppendEntries(peer, req)
			if err == nil {
				r.handleAppendEntriesResponse(peer, req, resp)
			}
		}(peer)
	}
}

func (r *RaftNode) sendRequestVote(peer string, req RequestVoteRequest) (RequestVoteResponse, error) {
	time.Sleep(10 * time.Millisecond)
	return RequestVoteResponse{Term: req.Term, VoteGranted: true}, nil
}

func (r *RaftNode) sendAppendEntries(peer string, req AppendEntriesRequest) (AppendEntriesResponse, error) {
	time.Sleep(5 * time.Millisecond)
	return AppendEntriesResponse{Term: req.Term, Success: true}, nil
}

func (r *RaftNode) handleAppendEntriesResponse(peer string, req AppendEntriesRequest, resp AppendEntriesResponse) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if resp.Term > r.currentTerm {
		r.currentTerm = resp.Term
		r.state = Follower
		r.votedFor = ""
		return
	}

	if resp.Success {
		if len(req.Entries) > 0 {
			r.matchIndex[peer] = req.Entries[len(req.Entries)-1].Index
			r.nextIndex[peer] = r.matchIndex[peer] + 1
		}
		r.updateCommitIndex()
	} else {
		r.nextIndex[peer] = int(math.Max(1, float64(r.nextIndex[peer]-1)))
	}
}

func (r *RaftNode) updateCommitIndex() {
	for n := r.commitIndex + 1; n <= len(r.log); n++ {
		count := 1
		for _, peer := range r.peers {
			if r.matchIndex[peer] >= n {
				count++
			}
		}
		if count > len(r.peers)/2 && r.log[n-1].Term == r.currentTerm {
			r.commitIndex = n
			r.applyLogEntries()
		}
	}
}

func (r *RaftNode) applyLogEntries() {
	for r.lastApplied < r.commitIndex {
		r.lastApplied++
		entry := r.log[r.lastApplied-1]
		if r.applyCh != nil {
			r.applyCh <- entry
		}
	}
}

func (r *RaftNode) lastLogInfo() (int, int) {
	if len(r.log) == 0 {
		return 0, 0
	}
	last := r.log[len(r.log)-1]
	return last.Index, last.Term
}

func (r *RaftNode) Propose(command interface{}) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.state != Leader {
		return errors.New("not the leader")
	}

	entry := LogEntry{
		Term:    r.currentTerm,
		Index:   len(r.log) + 1,
		Command: command,
	}
	r.log = append(r.log, entry)

	return nil
}

func (r *RaftNode) GetState() NodeState {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.state
}

func (r *RaftNode) GetLeaderID() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.leaderID
}

func (r *RaftNode) GetCurrentTerm() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.currentTerm
}

func (r *RaftNode) IsLeader() bool {
	return r.GetState() == Leader
}

func (r *RaftNode) GetID() string {
	return r.id
}

func GenerateNodeID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func SerializeCommand(cmd RaftCommand) ([]byte, error) {
	return json.Marshal(cmd)
}

func DeserializeCommand(data []byte) (RaftCommand, error) {
	var cmd RaftCommand
	err := json.Unmarshal(data, &cmd)
	return cmd, err
}

func (s NodeState) String() string {
	switch s {
	case Follower:
		return "Follower"
	case Candidate:
		return "Candidate"
	case Leader:
		return "Leader"
	default:
		return fmt.Sprintf("Unknown(%d)", s)
	}
}
