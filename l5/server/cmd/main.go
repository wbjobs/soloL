package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
	"github.com/joho/godotenv"
	"github.com/vmihailenco/msgpack/v5"

	"github.com/timeline-wars/server/internal/game"
	gamesync "github.com/timeline-wars/server/internal/gamesync"
	"github.com/timeline-wars/server/internal/reconnect"
	"github.com/timeline-wars/server/internal/redis"
	"github.com/timeline-wars/server/internal/replay"
	"github.com/timeline-wars/server/internal/room"
	"github.com/timeline-wars/server/internal/spectator"
	"github.com/timeline-wars/server/internal/validation"
	"github.com/timeline-wars/server/internal/ws"
	"github.com/timeline-wars/server/pkg/protocol"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

type GameEngineManager struct {
	mu       sync.RWMutex
	engines  map[string]*game.GameEngine
	hub      *ws.Hub
	redisCli *redis.Client
}

func NewGameEngineManager(hub *ws.Hub, redisCli *redis.Client) *GameEngineManager {
	return &GameEngineManager{
		engines:  make(map[string]*game.GameEngine),
		hub:      hub,
		redisCli: redisCli,
	}
}

func (gem *GameEngineManager) GetEngine(roomID string) *game.GameEngine {
	gem.mu.RLock()
	defer gem.mu.RUnlock()
	return gem.engines[roomID]
}

func (gem *GameEngineManager) CreateEngine(roomID string) *game.GameEngine {
	gem.mu.Lock()
	defer gem.mu.Unlock()

	if engine, ok := gem.engines[roomID]; ok {
		return engine
	}

	engine := game.NewGameEngine(roomID)
	gem.engines[roomID] = engine
	return engine
}

func (gem *GameEngineManager) RemoveEngine(roomID string) {
	gem.mu.Lock()
	defer gem.mu.Unlock()
	delete(gem.engines, roomID)
}

func (gem *GameEngineManager) GetGameState(roomID string) *protocol.GameState {
	engine := gem.GetEngine(roomID)
	if engine == nil {
		return nil
	}
	return engine.GetGameState()
}

func (gem *GameEngineManager) GetFullGameState(roomID string) protocol.FullGameState {
	engine := gem.GetEngine(roomID)
	if engine == nil {
		return protocol.FullGameState{}
	}
	return engine.GetFullGameState()
}

func (gem *GameEngineManager) GetFullGameStateForPlayer(roomID string, playerID string) protocol.FullGameState {
	engine := gem.GetEngine(roomID)
	if engine == nil {
		return protocol.FullGameState{}
	}
	return engine.GetFullGameStateForPlayer(playerID)
}

type Server struct {
	hub             *ws.Hub
	router          *ws.Router
	roomService     *room.RoomService
	roomManager     *room.RoomManager
	engineManager   *GameEngineManager
	reconnectMgr    *reconnect.ReconnectManager
	spectatorMgr    *spectator.SpectatorManager
	validator       *validation.ActionValidator
	replayDir       string
	redisCli        *redis.Client
	planningTime    int
	simulationTime  int
}

func NewServer() *Server {
	return &Server{
		hub:            ws.NewHub(),
		router:         ws.NewRouter(),
		planningTime:   30,
		simulationTime: 5,
		replayDir:      "replays",
	}
}

func (s *Server) Initialize() error {
	if err := godotenv.Load(); err != nil {
		log.Printf("Warning: .env file not found: %v", err)
	}

	redisAddr := getEnv("REDIS_ADDR", "localhost:6379")
	redisPassword := getEnv("REDIS_PASSWORD", "")
	redisDB, _ := strconv.Atoi(getEnv("REDIS_DB", "0"))
	heartbeatTimeout, _ := strconv.Atoi(getEnv("HEARTBEAT_TIMEOUT", "5"))
	reconnectTimeout, _ := strconv.Atoi(getEnv("RECONNECT_TIMEOUT", "30"))
	s.planningTime, _ = strconv.Atoi(getEnv("PLANNING_DURATION", "30"))
	s.simulationTime, _ = strconv.Atoi(getEnv("SIMULATION_DURATION", "5"))

	ws.SetHeartbeatTimeout(time.Duration(heartbeatTimeout) * time.Second)

	redisConfig := redis.Config{
		Addr:     redisAddr,
		Password: redisPassword,
		DB:       redisDB,
	}

	var err error
	s.redisCli, err = redis.NewClient(redisConfig)
	if err != nil {
		log.Printf("Warning: Redis connection failed: %v", err)
		log.Println("Continuing without Redis persistence...")
		s.redisCli = nil
	}

	s.roomManager = room.NewRoomManager(s.hub, s.redisCli)
	s.roomService = room.NewRoomService(s.roomManager, s.hub, s.redisCli)
	s.engineManager = NewGameEngineManager(s.hub, s.redisCli)

	s.reconnectMgr = reconnect.NewReconnectManager(
		s.hub,
		s.redisCli,
		s.engineManager,
	)
	s.reconnectMgr.SetReconnectTimeout(int64(reconnectTimeout))
	s.reconnectMgr.SetOnPlayerTimeout(s.handlePlayerTimeout)

	s.spectatorMgr = spectator.NewSpectatorManager(s.hub)
	s.validator = validation.NewActionValidator()

	s.replayDir = getEnv("REPLAY_DIR", "replays")
	if err := os.MkdirAll(s.replayDir, 0755); err != nil {
		log.Printf("Warning: Failed to create replay directory: %v", err)
	}

	s.registerHandlers()

	go s.hub.Run()
	go s.reconnectMgr.StartMonitoring()

	log.Println("Server initialized successfully")
	return nil
}

func (s *Server) registerHandlers() {
	s.router.Register(strconv.Itoa(protocol.MsgTypeCreateRoom), s.handleCreateRoom)
	s.router.Register(strconv.Itoa(protocol.MsgTypeJoinRoom), s.handleJoinRoom)
	s.router.Register(strconv.Itoa(protocol.MsgTypeLeaveRoom), s.handleLeaveRoom)
	s.router.Register(strconv.Itoa(protocol.MsgTypeReady), s.handlePlayerReady)
	s.router.Register(strconv.Itoa(protocol.MsgTypeStartGame), s.handleStartGame)
	s.router.Register(strconv.Itoa(protocol.MsgTypeSubmitTimeline), s.handleSubmitTimeline)
	s.router.Register(strconv.Itoa(protocol.MsgTypeReconnect), s.handleReconnect)
	s.router.Register(strconv.Itoa(protocol.MsgTypeHeartbeat), s.handleHeartbeat)
	s.router.Register(strconv.Itoa(protocol.MsgTypeSpectateJoin), s.handleSpectateJoin)
	s.router.Register(strconv.Itoa(protocol.MsgTypeSpectateLeave), s.handleSpectateLeave)
	s.router.Register(strconv.Itoa(protocol.MsgTypeReplayList), s.handleReplayList)
	s.router.Register(strconv.Itoa(protocol.MsgTypeReplayData), s.handleReplayData)

	log.Println("Message handlers registered")
}

func (s *Server) handleCreateRoom(ctx context.Context, client *ws.Client, data []byte) error {
	var req protocol.CreateRoomRequest
	if err := msgpack.Unmarshal(data, &req); err != nil {
		return err
	}

	if req.PlayerID == "" {
		req.PlayerID = generatePlayerID()
	}

	client.PlayerID = req.PlayerID
	s.hub.SetClientPlayerID(client, req.PlayerID)

	log.Printf("Player %s creating room: %s", req.PlayerName, req.RoomName)
	return s.roomService.HandleCreateRoom(ctx, client, &req)
}

func (s *Server) handleJoinRoom(ctx context.Context, client *ws.Client, data []byte) error {
	var req protocol.JoinRoomRequest
	if err := msgpack.Unmarshal(data, &req); err != nil {
		return err
	}

	if req.PlayerID == "" {
		req.PlayerID = generatePlayerID()
	}

	client.PlayerID = req.PlayerID
	s.hub.SetClientPlayerID(client, req.PlayerID)

	log.Printf("Player %s joining room: %s", req.PlayerName, req.RoomID)
	return s.roomService.HandleJoinRoom(ctx, client, &req)
}

func (s *Server) handleLeaveRoom(ctx context.Context, client *ws.Client, data []byte) error {
	var req protocol.LeaveRoomRequest
	if err := msgpack.Unmarshal(data, &req); err != nil {
		return err
	}

	log.Printf("Player %s leaving room: %s", req.PlayerID, req.RoomID)
	return s.roomService.HandleLeaveRoom(ctx, client, &req)
}

func (s *Server) handlePlayerReady(ctx context.Context, client *ws.Client, data []byte) error {
	var req protocol.ReadyRequest
	if err := msgpack.Unmarshal(data, &req); err != nil {
		return err
	}

	log.Printf("Player %s ready state: %v in room %s", req.PlayerID, req.Ready, req.RoomID)
	return s.roomService.HandlePlayerReady(ctx, client, &req)
}

func (s *Server) handleStartGame(ctx context.Context, client *ws.Client, data []byte) error {
	var req protocol.StartGameRequest
	if err := msgpack.Unmarshal(data, &req); err != nil {
		return err
	}

	log.Printf("Starting game in room: %s", req.RoomID)

	r, ok := s.roomManager.GetRoom(req.RoomID)
	if !ok {
		return sendError(client, protocol.ErrCodeRoomNotFound, "Room not found")
	}

	if r.HostID != client.PlayerID {
		return sendError(client, protocol.ErrCodeNotHost, "Only host can start game")
	}

	if !r.AllPlayersReady() {
		return sendError(client, protocol.ErrCodeNotAllReady, "Not all players are ready")
	}

	engine := s.engineManager.CreateEngine(req.RoomID)
	players := r.GetPlayers()

	gameState, err := engine.StartGame(players)
	if err != nil {
		return sendError(client, protocol.ErrCodeInternalError, err.Error())
	}

	startMsg := protocol.GameStartMessage{
		RoomID:    req.RoomID,
		GameState: *gameState,
		Timestamp: time.Now().UnixMilli(),
	}

	msgType := strconv.Itoa(protocol.MsgTypeGameStart)
	s.hub.BroadcastToRoomWithType(req.RoomID, msgType, startMsg)

	go s.runGameLoop(req.RoomID, engine)

	log.Printf("Game started in room: %s", req.RoomID)
	return nil
}

func (s *Server) handleSubmitTimeline(ctx context.Context, client *ws.Client, data []byte) error {
	var req protocol.TimelineSubmitRequest
	if err := msgpack.Unmarshal(data, &req); err != nil {
		return err
	}

	log.Printf("Player %s submitted timeline for room %s", client.PlayerID, req.RoomID)

	engine := s.engineManager.GetEngine(req.RoomID)
	if engine == nil {
		return sendError(client, protocol.ErrCodeGameNotStarted, "Game not started")
	}

	req.Timeline.PlayerID = client.PlayerID

	gameState := engine.GetGameState()
	if gameState == nil {
		return sendError(client, protocol.ErrCodeGameNotStarted, "Game state not available")
	}

	validationErrors := s.validator.ValidateTimeline(req.Timeline, gameState)
	if len(validationErrors) > 0 {
		errData := make([]protocol.ValidationErrData, len(validationErrors))
		for i, ve := range validationErrors {
			errData[i] = protocol.ValidationErrData{
				ActionID: ve.ActionID,
				Code:     ve.Code,
				Message:  ve.Message,
			}
		}
		resultMsg := protocol.ValidationResultMessage{
			PlayerID: client.PlayerID,
			Valid:    false,
			Errors:   errData,
		}
		valType := strconv.Itoa(protocol.MsgTypeValidationResult)
		client.SendMessageWithType(valType, resultMsg)

		return sendError(client, protocol.ErrCodeInvalidTimeline, fmt.Sprintf("Timeline validation failed: %d errors", len(validationErrors)))
	}

	if err := engine.SubmitTimeline(req.Timeline); err != nil {
		return sendError(client, protocol.ErrCodeInvalidTimeline, err.Error())
	}

	resp := protocol.TimelineSubmitResponse{
		RoomID:   req.RoomID,
		PlayerID: client.PlayerID,
		Success:  true,
	}

	ackType := strconv.Itoa(protocol.MsgTypeSubmitTimelineAck)
	if err := client.SendMessageWithType(ackType, resp); err != nil {
		return err
	}

	allSubmitted := engine.CheckAllSubmitted()
	if allSubmitted {
		log.Printf("All players submitted, starting simulation for room %s", req.RoomID)
	}

	return nil
}

func (s *Server) handleReconnect(ctx context.Context, client *ws.Client, data []byte) error {
	var req protocol.ReconnectRequest
	if err := msgpack.Unmarshal(data, &req); err != nil {
		return err
	}

	log.Printf("Player %s attempting to reconnect to room %s", req.PlayerID, req.RoomID)

	client.PlayerID = req.PlayerID
	client.RoomID = req.RoomID
	s.hub.SetClientRoom(client, req.RoomID)
	s.hub.SetClientPlayerID(client, req.PlayerID)

	engine := s.engineManager.GetEngine(req.RoomID)
	if engine == nil {
		return sendError(client, protocol.ErrCodeGameNotStarted, "Game not found")
	}

	fullState := s.engineManager.GetFullGameStateForPlayer(req.RoomID, req.PlayerID)
	ackType := strconv.Itoa(protocol.MsgTypeReconnectAck)
	if err := client.SendMessageWithType(ackType, fullState); err != nil {
		return err
	}

	s.reconnectMgr.HandleReconnect(req.PlayerID, req.RoomID, req.ReconnectToken, client)

	log.Printf("Player %s reconnected to room %s", req.PlayerID, req.RoomID)
	return nil
}

func (s *Server) handleHeartbeat(ctx context.Context, client *ws.Client, data []byte) error {
	var req protocol.HeartbeatRequest
	if err := msgpack.Unmarshal(data, &req); err != nil {
		return err
	}

	resp := protocol.HeartbeatResponse{
		Timestamp: time.Now().UnixMilli(),
	}

	ackType := strconv.Itoa(protocol.MsgTypeHeartbeat)
	return client.SendMessageWithType(ackType, resp)
}

func (s *Server) handleSpectateJoin(ctx context.Context, client *ws.Client, data []byte) error {
	var req protocol.SpectateJoinRequest
	if err := msgpack.Unmarshal(data, &req); err != nil {
		return err
	}

	if req.PlayerID == "" {
		req.PlayerID = generatePlayerID()
	}

	engine := s.engineManager.GetEngine(req.RoomID)
	if engine == nil {
		return sendError(client, protocol.ErrCodeGameNotStarted, "Game not started, cannot spectate")
	}

	if err := s.spectatorMgr.AddSpectator(req.RoomID, req.PlayerID, client); err != nil {
		return sendError(client, protocol.ErrCodeSpectatorLimit, err.Error())
	}

	client.PlayerID = req.PlayerID
	s.hub.SetClientPlayerID(client, req.PlayerID)

	gameState := engine.GetGameState()
	resp := protocol.SpectateJoinResponse{
		Success:  true,
		RoomID:   req.RoomID,
		GameState: *gameState,
		Message:  "Spectating game",
	}

	ackType := strconv.Itoa(protocol.MsgTypeSpectateJoin)
	if err := client.SendMessageWithType(ackType, resp); err != nil {
		return err
	}

	log.Printf("Player %s joined as spectator in room %s", req.PlayerID, req.RoomID)
	return nil
}

func (s *Server) handleSpectateLeave(ctx context.Context, client *ws.Client, data []byte) error {
	var req protocol.SpectateLeaveRequest
	if err := msgpack.Unmarshal(data, &req); err != nil {
		return err
	}

	if err := s.spectatorMgr.RemoveSpectator(req.PlayerID); err != nil {
		return sendError(client, protocol.ErrCodePlayerNotInRoom, err.Error())
	}

	log.Printf("Spectator %s left room %s", req.PlayerID, req.RoomID)
	return nil
}

func (s *Server) handleReplayList(ctx context.Context, client *ws.Client, data []byte) error {
	var req protocol.ReplayListRequest
	if err := msgpack.Unmarshal(data, &req); err != nil {
		return err
	}

	limit := req.Limit
	if limit <= 0 {
		limit = 20
	}

	entries, err := os.ReadDir(s.replayDir)
	if err != nil {
		return sendError(client, protocol.ErrCodeReplayNotFound, "Replay directory not found")
	}

	var summaries []protocol.ReplaySummary
	count := 0

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}

		filePath := s.replayDir + "/" + entry.Name()
		fileData, err := os.ReadFile(filePath)
		if err != nil {
			continue
		}

		var replayData replay.ReplayData
		if err := json.Unmarshal(fileData, &replayData); err != nil {
			continue
		}

		if req.RoomID != "" && replayData.RoomID != req.RoomID {
			continue
		}

		summaries = append(summaries, protocol.ReplaySummary{
			RoomID:     replayData.RoomID,
			StartTime:  replayData.StartTime,
			EndTime:    replayData.EndTime,
			Rounds:     len(replayData.Rounds),
			WinnerTeam: replayData.WinnerTeam,
			FilePath:   filePath,
		})

		count++
		if count >= limit {
			break
		}
	}

	resp := protocol.ReplayListResponse{
		Replays: summaries,
	}

	respType := strconv.Itoa(protocol.MsgTypeReplayList)
	return client.SendMessageWithType(respType, resp)
}

func (s *Server) handleReplayData(ctx context.Context, client *ws.Client, data []byte) error {
	var req protocol.ReplayDataRequest
	if err := msgpack.Unmarshal(data, &req); err != nil {
		return err
	}

	player, err := replay.LoadFromFile(req.FilePath)
	if err != nil {
		return sendError(client, protocol.ErrCodeReplayNotFound, "Replay file not found")
	}

	replayData := player.GetData()
	respType := strconv.Itoa(protocol.MsgTypeReplayData)
	return client.SendMessageWithType(respType, replayData)
}

func (s *Server) handlePlayerTimeout(playerID string) {
	log.Printf("Player %s timed out", playerID)

	for roomID, engine := range s.engineManager.engines {
		if engine != nil {
			r, ok := s.roomManager.GetRoom(roomID)
			if ok && r.HasPlayer(playerID) {
				timeoutMsg := protocol.ErrorMessage{
					Code:    protocol.ErrCodePlayerTimeout,
					Message: fmt.Sprintf("Player %s has timed out", playerID),
				}
				msgType := strconv.Itoa(protocol.MsgTypeError)
				s.hub.BroadcastToRoomWithType(roomID, msgType, timeoutMsg)
			}
		}
	}
}

func (s *Server) runGameLoop(roomID string, engine *game.GameEngine) {
	players := engine.GetGameState().Players
	randomSeed := engine.GetSimulator().GetRandomSeed()
	filePath := fmt.Sprintf("%s/replay_%s_%d.json", s.replayDir, roomID, time.Now().UnixMilli())
	recorder := replay.NewReplayRecorder(roomID, randomSeed, players, filePath)

	for {
		if engine.IsGameOver() {
			break
		}

		_, err := engine.StartPlanningPhase()
		if err != nil {
			log.Printf("Error starting planning phase for room %s: %v", roomID, err)
			break
		}

		phaseMsg := protocol.PhaseChangeMessage{
			RoomID:       roomID,
			Phase:        fmt.Sprint(protocol.GamePhasePlanning),
			Turn:         engine.GetCurrentTurn(),
			DurationSec:  int32(s.planningTime),
			Timestamp:    time.Now().UnixMilli(),
		}
		msgType := strconv.Itoa(protocol.MsgTypePhaseChange)
		s.hub.BroadcastToRoomWithType(roomID, msgType, phaseMsg)
		s.spectatorMgr.BroadcastToSpectators(roomID, msgType, phaseMsg)

		time.Sleep(time.Duration(s.planningTime) * time.Second)

		if engine.IsGameOver() {
			break
		}

		simMsg := protocol.PhaseChangeMessage{
			RoomID:      roomID,
			Phase:       fmt.Sprint(protocol.GamePhaseSimulating),
			Turn:        engine.GetCurrentTurn(),
			DurationSec: int32(s.simulationTime),
			Timestamp:   time.Now().UnixMilli(),
		}
		s.hub.BroadcastToRoomWithType(roomID, msgType, simMsg)
		s.spectatorMgr.BroadcastToSpectators(roomID, msgType, simMsg)

		timelines := engine.GetSyncManager().GetAllTimelines()

		frames, err := engine.StartSimulatingPhase()
		if err != nil {
			log.Printf("Simulation error for room %s: %v", roomID, err)
			continue
		}

		var finalState protocol.GameState
		gameStates := make([]protocol.GameState, len(frames))
		for i, frame := range frames {
			gameStates[i] = frame.GameState
			finalState = frame.GameState
		}

		synchronizer := gamesync.NewStateSynchronizer(roomID, s.hub, s.redisCli, s.engineManager)
		if err := synchronizer.BroadcastSnapshots(gameStates); err != nil {
			log.Printf("Broadcast error for room %s: %v", roomID, err)
		}

		for _, frame := range frames {
			snapshotMsg := protocol.StateSnapshotMessage{
				GameState: frame.GameState,
				RoomID:    roomID,
			}
			snapType := strconv.Itoa(protocol.MsgTypeSpectateState)
			s.spectatorMgr.BroadcastToSpectators(roomID, snapType, snapshotMsg)
		}

		recorder.RecordRound(engine.GetCurrentTurn(), timelines, finalState)

		if engine.IsGameOver() {
			winnerTeam, winnerPlayers := engine.GetWinner()
			gameOverMsg := protocol.GameOverMessage{
				RoomID:        roomID,
				WinnerTeam:    winnerTeam,
				WinnerPlayers: winnerPlayers,
				Timestamp:     time.Now().UnixMilli(),
			}
			overType := strconv.Itoa(protocol.MsgTypeGameOver)
			s.hub.BroadcastToRoomWithType(roomID, overType, gameOverMsg)
			s.spectatorMgr.BroadcastToSpectators(roomID, overType, gameOverMsg)

			recorder.SetWinner(winnerTeam)
			if err := recorder.Save(); err != nil {
				log.Printf("Failed to save replay for room %s: %v", roomID, err)
			} else {
				log.Printf("Replay saved for room %s: %s", roomID, filePath)
			}

			s.spectatorMgr.CleanRoomSpectators(roomID)
			break
		}

		engine.IncrementTurn()
	}

	log.Printf("Game loop ended for room: %s", roomID)
}

func (s *Server) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	client := s.hub.NewClientWithRouter(conn, s.router)
	s.hub.Register(client)

	defer func() {
		s.hub.Unregister(client)
		conn.Close()

		if client.PlayerID != "" && client.RoomID != "" {
			s.reconnectMgr.HandleDisconnect(client.PlayerID, client.RoomID)
		}
	}()

	ctx := context.Background()
	client.ReadPumpWithContext(ctx, s.router)
}

func (s *Server) HandleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, `{"status":"ok","timestamp":%d,"clients":%d,"rooms":%d}`,
		time.Now().Unix(),
		s.hub.GetClientCount(),
		s.roomManager.GetRoomCount(),
	)
}

func (s *Server) Run(port string) error {
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", s.HandleWebSocket)
	mux.HandleFunc("/health", s.HandleHealth)

	server := &http.Server{
		Addr:    ":" + port,
		Handler: corsMiddleware(mux),
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		log.Printf("Server starting on port %s...", port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	<-stop
	log.Println("Shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Printf("Server shutdown error: %v", err)
	}

	s.hub.Stop()
	if s.redisCli != nil {
		_ = s.redisCli.Close()
	}

	log.Println("Server shutdown complete")
	return nil
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func sendError(client *ws.Client, code int, message string) error {
	errMsg := protocol.ErrorMessage{
		Code:    code,
		Message: message,
	}
	msgType := strconv.Itoa(protocol.MsgTypeError)
	return client.SendMessageWithType(msgType, errMsg)
}

func generatePlayerID() string {
	return "player_" + strconv.FormatInt(time.Now().UnixNano(), 36)
}

func getEnv(key, defaultValue string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return defaultValue
}

func main() {
	server := NewServer()

	if err := server.Initialize(); err != nil {
		log.Fatalf("Failed to initialize server: %v", err)
	}

	port := getEnv("PORT", "8080")
	if err := server.Run(port); err != nil {
		log.Fatalf("Failed to run server: %v", err)
	}
}
