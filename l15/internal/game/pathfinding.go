package game

import (
	"citybuilder/internal/database"
	"citybuilder/internal/models"
	"container/heap"
	"encoding/json"
	"fmt"
	"math"
	"sync"
	"time"
)

type PathNode struct {
	X, Y    int
	G, H, F int
	Parent  *PathNode
	index   int
}

type PriorityQueue []*PathNode

func (pq PriorityQueue) Len() int { return len(pq) }

func (pq PriorityQueue) Less(i, j int) bool {
	return pq[i].F < pq[j].F
}

func (pq PriorityQueue) Swap(i, j int) {
	pq[i], pq[j] = pq[j], pq[i]
	pq[i].index = i
	pq[j].index = j
}

func (pq *PriorityQueue) Push(x interface{}) {
	n := len(*pq)
	node := x.(*PathNode)
	node.index = n
	*pq = append(*pq, node)
}

func (pq *PriorityQueue) Pop() interface{} {
	old := *pq
	n := len(old)
	node := old[n-1]
	old[n-1] = nil
	node.index = -1
	*pq = old[0 : n-1]
	return node
}

type PathRequest struct {
	StartX, StartY int
	EndX, EndY     int
	ResultChan     chan *PathResult
}

type PathResult struct {
	Path *models.PathResult
	Err  error
}

type RoadNode struct {
	X, Y int
	ID   int
}

type Pathfinder struct {
	gridMgr          *GridManager
	workerPool       chan *PathRequest
	workerCount      int
	requestCache     map[string][]*PathRequest
	cacheMu          sync.Mutex
	roadNodes        []RoadNode
	roadNodeIndex    map[string]int
	distMatrix       [][]int
	nextMatrix       [][]int
	roadGraphReady   bool
	roadGraphMu      sync.RWMutex
	roadBuildCount   int
	lastRebuildTime  time.Time
}

const (
	INF = math.MaxInt32 / 2
)

func NewPathfinder(gridMgr *GridManager, workerCount int) *Pathfinder {
	pf := &Pathfinder{
		gridMgr:       gridMgr,
		workerPool:    make(chan *PathRequest, 1000),
		workerCount:   workerCount,
		requestCache:  make(map[string][]*PathRequest),
		roadNodeIndex: make(map[string]int),
	}

	for i := 0; i < workerCount; i++ {
		go pf.worker()
	}

	go pf.roadGraphRebuilder()

	return pf
}

func (p *Pathfinder) FindPathAsync(startX, startY, endX, endY int) <-chan *PathResult {
	resultChan := make(chan *PathResult, 1)

	cacheKey := fmt.Sprintf("path:%d:%d:%d:%d", startX, startY, endX, endY)
	cached, err := database.RedisClient.Get(database.Ctx, cacheKey).Result()
	if err == nil {
		var result models.PathResult
		if json.Unmarshal([]byte(cached), &result) == nil {
			resultChan <- &PathResult{Path: &result, Err: nil}
			close(resultChan)
			return resultChan
		}
	}

	p.roadGraphMu.RLock()
	if p.roadGraphReady {
		roadPath, err := p.findRoadPath(startX, startY, endX, endY)
		p.roadGraphMu.RUnlock()
		if err == nil && roadPath != nil {
			data, _ := json.Marshal(roadPath)
			database.RedisClient.Set(database.Ctx, cacheKey, data, 5*time.Minute)
			resultChan <- &PathResult{Path: roadPath, Err: nil}
			close(resultChan)
			return resultChan
		}
	} else {
		p.roadGraphMu.RUnlock()
	}

	req := &PathRequest{
		StartX:     startX,
		StartY:     startY,
		EndX:       endX,
		EndY:       endY,
		ResultChan: resultChan,
	}

	p.cacheMu.Lock()
	reqKey := fmt.Sprintf("%d:%d:%d:%d", startX, startY, endX, endY)
	if pending, ok := p.requestCache[reqKey]; ok {
		p.requestCache[reqKey] = append(pending, req)
		p.cacheMu.Unlock()
		return resultChan
	}
	p.requestCache[reqKey] = []*PathRequest{req}
	p.cacheMu.Unlock()

	select {
	case p.workerPool <- req:
	default:
		go func() {
			p.processRequest(req)
		}()
	}

	return resultChan
}

func (p *Pathfinder) FindPath(startX, startY, endX, endY int) (*models.PathResult, error) {
	resultChan := p.FindPathAsync(startX, startY, endX, endY)
	result := <-resultChan
	return result.Path, result.Err
}

func (p *Pathfinder) worker() {
	for req := range p.workerPool {
		p.processRequest(req)
	}
}

func (p *Pathfinder) processRequest(req *PathRequest) {
	reqKey := fmt.Sprintf("%d:%d:%d:%d", req.StartX, req.StartY, req.EndX, req.EndY)

	result, err := p.aStar(req.StartX, req.StartY, req.EndX, req.EndY)

	if err == nil && result != nil && len(result.Path) > 0 {
		cacheKey := fmt.Sprintf("path:%d:%d:%d:%d", req.StartX, req.StartY, req.EndX, req.EndY)
		data, _ := json.Marshal(result)
		database.RedisClient.Set(database.Ctx, cacheKey, data, 5*time.Minute)
	}

	p.cacheMu.Lock()
	if pendingReqs, ok := p.requestCache[reqKey]; ok {
		for _, pendingReq := range pendingReqs {
			select {
			case pendingReq.ResultChan <- &PathResult{Path: result, Err: err}:
			default:
			}
			close(pendingReq.ResultChan)
		}
		delete(p.requestCache, reqKey)
	}
	p.cacheMu.Unlock()
}

func (p *Pathfinder) aStar(startX, startY, endX, endY int) (*models.PathResult, error) {
	if !p.gridMgr.IsValidPosition(startX, startY) || !p.gridMgr.IsValidPosition(endX, endY) {
		return nil, fmt.Errorf("invalid position")
	}

	gridSize := p.gridMgr.GetGridSize()
	openSet := make(PriorityQueue, 0)
	closedSet := make(map[string]bool)
	nodeMap := make(map[string]*PathNode)

	startNode := &PathNode{
		X: startX,
		Y: startY,
		G: 0,
		H: heuristic(startX, startY, endX, endY),
	}
	startNode.F = startNode.G + startNode.H

	heap.Push(&openSet, startNode)
	nodeMap[nodeKey(startX, startY)] = startNode

	directions := [][2]int{
		{-1, 0}, {1, 0}, {0, -1}, {0, 1},
		{-1, -1}, {-1, 1}, {1, -1}, {1, 1},
	}

	for openSet.Len() > 0 {
		current := heap.Pop(&openSet).(*PathNode)

		if current.X == endX && current.Y == endY {
			path := reconstructPath(current)
			return &models.PathResult{
				Path: path,
				Cost: current.G,
			}, nil
		}

		closedSet[nodeKey(current.X, current.Y)] = true

		for _, dir := range directions {
			nx, ny := current.X+dir[0], current.Y+dir[1]

			if nx < 0 || nx >= gridSize || ny < 0 || ny >= gridSize {
				continue
			}

			if closedSet[nodeKey(nx, ny)] {
				continue
			}

			tile, err := p.gridMgr.GetTile(nx, ny)
			if err != nil {
				continue
			}

			if tile.Terrain == models.TerrainWater || tile.Terrain == models.TerrainMountain {
				continue
			}

			moveCost := 10
			if dir[0] != 0 && dir[1] != 0 {
				moveCost = 14
			}

			if tile.HasRoad {
				moveCost = 5
			} else if tile.BuildingID != nil {
				moveCost += 20
			}

			g := current.G + moveCost
			h := heuristic(nx, ny, endX, endY)
			f := g + h

			key := nodeKey(nx, ny)
			existing, exists := nodeMap[key]
			if !exists {
				newNode := &PathNode{
					X:      nx,
					Y:      ny,
					G:      g,
					H:      h,
					F:      f,
					Parent: current,
				}
				nodeMap[key] = newNode
				heap.Push(&openSet, newNode)
			} else if g < existing.G {
				existing.G = g
				existing.F = f
				existing.Parent = current
				heap.Fix(&openSet, existing.index)
			}
		}
	}

	return nil, fmt.Errorf("path not found")
}

func (p *Pathfinder) roadGraphRebuilder() {
	ticker := time.NewTicker(30 * time.Second)
	for range ticker.C {
		p.RebuildRoadGraph()
	}
}

func (p *Pathfinder) RebuildRoadGraph() {
	var roadTiles []models.Tile
	database.DB.Where("has_road = ?", true).Find(&roadTiles)

	if len(roadTiles) < 2 {
		return
	}

	p.roadGraphMu.Lock()
	defer p.roadGraphMu.Unlock()

	p.roadNodes = make([]RoadNode, 0, len(roadTiles))
	p.roadNodeIndex = make(map[string]int)

	for i, tile := range roadTiles {
		key := fmt.Sprintf("%d,%d", tile.X, tile.Y)
		p.roadNodeIndex[key] = i
		p.roadNodes = append(p.roadNodes, RoadNode{X: tile.X, Y: tile.Y, ID: i})
	}

	n := len(p.roadNodes)
	if n == 0 {
		p.roadGraphReady = false
		return
	}

	p.distMatrix = make([][]int, n)
	p.nextMatrix = make([][]int, n)
	for i := range p.distMatrix {
		p.distMatrix[i] = make([]int, n)
		p.nextMatrix[i] = make([]int, n)
		for j := range p.distMatrix[i] {
			if i == j {
				p.distMatrix[i][j] = 0
				p.nextMatrix[i][j] = j
			} else {
				p.distMatrix[i][j] = INF
				p.nextMatrix[i][j] = -1
			}
		}
	}

	directions := [][2]int{{-1, 0}, {1, 0}, {0, -1}, {0, 1}}
	for i, node := range p.roadNodes {
		for _, dir := range directions {
			nx, ny := node.X+dir[0], node.Y+dir[1]
			key := fmt.Sprintf("%d,%d", nx, ny)
			if j, ok := p.roadNodeIndex[key]; ok {
				p.distMatrix[i][j] = 10
				p.nextMatrix[i][j] = j
			}
		}
	}

	for k := 0; k < n; k++ {
		for i := 0; i < n; i++ {
			for j := 0; j < n; j++ {
				if p.distMatrix[i][k]+p.distMatrix[k][j] < p.distMatrix[i][j] {
					p.distMatrix[i][j] = p.distMatrix[i][k] + p.distMatrix[k][j]
					p.nextMatrix[i][j] = p.nextMatrix[i][k]
				}
			}
		}
	}

	p.roadGraphReady = true
	p.lastRebuildTime = time.Now()
}

func (p *Pathfinder) findRoadPath(startX, startY, endX, endY int) (*models.PathResult, error) {
	nearestStart := p.findNearestRoadNode(startX, startY)
	nearestEnd := p.findNearestRoadNode(endX, endY)

	if nearestStart == -1 || nearestEnd == -1 {
		return nil, fmt.Errorf("no road access")
	}

	if p.distMatrix[nearestStart][nearestEnd] == INF {
		return nil, fmt.Errorf("no road connection")
	}

	roadPath := p.reconstructRoadPath(nearestStart, nearestEnd)

	fullPath := make([][2]int, 0)
	fullPath = append(fullPath, [2]int{startX, startY})
	for _, nodeID := range roadPath {
		fullPath = append(fullPath, [2]int{p.roadNodes[nodeID].X, p.roadNodes[nodeID].Y})
	}
	fullPath = append(fullPath, [2]int{endX, endY})

	return &models.PathResult{
		Path: fullPath,
		Cost: p.distMatrix[nearestStart][nearestEnd],
	}, nil
}

func (p *Pathfinder) findNearestRoadNode(x, y int) int {
	key := fmt.Sprintf("%d,%d", x, y)
	if id, ok := p.roadNodeIndex[key]; ok {
		return id
	}

	minDist := math.MaxInt32
	nearestID := -1

	for id, node := range p.roadNodes {
		dist := abs(node.X-x) + abs(node.Y-y)
		if dist < minDist && dist <= 3 {
			minDist = dist
			nearestID = id
		}
	}

	return nearestID
}

func (p *Pathfinder) reconstructRoadPath(start, end int) []int {
	if p.nextMatrix[start][end] == -1 {
		return nil
	}

	path := []int{start}
	for start != end {
		start = p.nextMatrix[start][end]
		path = append(path, start)
	}
	return path
}

func (p *Pathfinder) InvalidatePathCache() {
	iter := database.RedisClient.Scan(database.Ctx, 0, "path:*", 0).Iterator()
	for iter.Next(database.Ctx) {
		database.RedisClient.Del(database.Ctx, iter.Val())
	}

	go p.RebuildRoadGraph()
}

func heuristic(x1, y1, x2, y2 int) int {
	dx := math.Abs(float64(x1 - x2))
	dy := math.Abs(float64(y1 - y2))
	return int((dx + dy - 0.5*math.Min(dx, dy)) * 10)
}

func nodeKey(x, y int) string {
	return fmt.Sprintf("%d,%d", x, y)
}

func reconstructPath(node *PathNode) [][2]int {
	path := make([][2]int, 0)
	for node != nil {
		path = append([][2]int{{node.X, node.Y}}, path...)
		node = node.Parent
	}
	return path
}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}
