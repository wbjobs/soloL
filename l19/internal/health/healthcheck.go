package health

import (
	"fmt"
	"sync"
	"time"

	"dbdoctor/internal/config"
	"dbdoctor/internal/cockroach"
)

type NodeHealthStatus struct {
	NodeID            int       `json:"node_id"`
	Address           string    `json:"address"`
	Alive             bool      `json:"alive"`
	ConsecutiveFails  int       `json:"consecutive_failures"`
	LastSuccess       time.Time `json:"last_success,omitempty"`
	LastFailure       time.Time `json:"last_failure,omitempty"`
	LastError         string    `json:"last_error,omitempty"`
	Status            string    `json:"status"`
	Unavailable       bool      `json:"unavailable"`
	IsNetworkPartition bool     `json:"is_network_partition"`
}

type HealthReport struct {
	Timestamp          time.Time          `json:"timestamp"`
	TotalNodes         int                `json:"total_nodes"`
	HealthyNodes       int                `json:"healthy_nodes"`
	UnavailableNodes   int                `json:"unavailable_nodes"`
	NetworkPartition   bool               `json:"network_partition"`
	PartitionedNodes   []int              `json:"partitioned_nodes,omitempty"`
	Nodes              []NodeHealthStatus `json:"nodes"`
	FailureThreshold   int                `json:"failure_threshold"`
}

type HealthChecker struct {
	config      *config.HealthCheckConfig
	httpClient  *cockroach.HTTPClient
	sqlClient   *cockroach.SQLClient
	nodeStates  map[int]*nodeState
	mu          sync.RWMutex
}

type nodeState struct {
	consecutiveFails int
	lastSuccess      time.Time
	lastFailure      time.Time
	lastError        string
	isUnavailable    bool
	history          []bool
}

func NewHealthChecker(
	cfg *config.HealthCheckConfig,
	httpClient *cockroach.HTTPClient,
	sqlClient *cockroach.SQLClient,
) *HealthChecker {
	return &HealthChecker{
		config:     cfg,
		httpClient: httpClient,
		sqlClient:  sqlClient,
		nodeStates: make(map[int]*nodeState),
	}
}

func (h *HealthChecker) CheckNodeHeartbeat(nodeID int, timeout time.Duration) *NodeHealthStatus {
	health, err := h.httpClient.GetNodeHealth(nodeID, timeout)
	if err != nil {
		health = &cockroach.NodeHealth{
			NodeID:  nodeID,
			Healthy: false,
			Error:   err.Error(),
		}
	}

	return h.updateNodeState(health)
}

func (h *HealthChecker) CheckAllNodes() (*HealthReport, error) {
	nodes, err := h.sqlClient.GetNodeDetails()
	if err != nil {
		return nil, fmt.Errorf("failed to get node list: %w", err)
	}

	timeout := time.Duration(h.config.Timeout) * time.Second
	results := make([]NodeHealthStatus, len(nodes))
	var wg sync.WaitGroup

	for i, node := range nodes {
		wg.Add(1)
		go func(i int, node cockroach.NodeDetail) {
			defer wg.Done()
			results[i] = *h.CheckNodeHeartbeat(node.NodeID, timeout)
			results[i].Address = node.Address
		}(i, node)
	}

	wg.Wait()

	return h.generateReport(results), nil
}

func (h *HealthChecker) RunContinuousChecks(stopChan <-chan struct{}, resultChan chan<- *HealthReport) {
	interval := time.Duration(h.config.HeartbeatInterval) * time.Second
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			report, err := h.CheckAllNodes()
			if err == nil {
				resultChan <- report
			}
		case <-stopChan:
			return
		}
	}
}

func (h *HealthChecker) updateNodeState(health *cockroach.NodeHealth) *NodeHealthStatus {
	h.mu.Lock()
	defer h.mu.Unlock()

	state, exists := h.nodeStates[health.NodeID]
	if !exists {
		state = &nodeState{
			history: make([]bool, 0, h.config.FailureThreshold),
		}
		h.nodeStates[health.NodeID] = state
	}

	now := time.Now()
	if health.Healthy {
		state.consecutiveFails = 0
		state.lastSuccess = now
		state.lastError = ""
		state.isUnavailable = false
	} else {
		state.consecutiveFails++
		state.lastFailure = now
		state.lastError = health.Error
		if state.consecutiveFails >= h.config.FailureThreshold {
			state.isUnavailable = true
		}
	}

	state.history = append(state.history, health.Healthy)
	if len(state.history) > h.config.FailureThreshold {
		state.history = state.history[1:]
	}

	status := "healthy"
	if !health.Healthy {
		if state.isUnavailable {
			status = "unavailable"
		} else {
			status = "degraded"
		}
	}

	return &NodeHealthStatus{
		NodeID:           health.NodeID,
		Alive:            health.Healthy,
		ConsecutiveFails: state.consecutiveFails,
		LastSuccess:      state.lastSuccess,
		LastFailure:      state.lastFailure,
		LastError:        state.lastError,
		Status:           status,
		Unavailable:      state.isUnavailable,
	}
}

func (h *HealthChecker) generateReport(nodeStatuses []NodeHealthStatus) *HealthReport {
	h.mu.RLock()
	defer h.mu.RUnlock()

	report := &HealthReport{
		Timestamp:        time.Now(),
		TotalNodes:       len(nodeStatuses),
		Nodes:            nodeStatuses,
		FailureThreshold: h.config.FailureThreshold,
	}

	unavailableCount := 0
	partitionedNodes := make([]int, 0)
	healthyCount := 0

	for i := range nodeStatuses {
		node := &nodeStatuses[i]

		if h.config.FailureThreshold >= 3 {
			node.IsNetworkPartition = h.detectNetworkPartition(node.NodeID)
		}

		if node.Unavailable {
			unavailableCount++
			if node.IsNetworkPartition {
				partitionedNodes = append(partitionedNodes, node.NodeID)
			}
		} else if node.Alive {
			healthyCount++
		}
	}

	report.HealthyNodes = healthyCount
	report.UnavailableNodes = unavailableCount
	report.NetworkPartition = len(partitionedNodes) > 0
	report.PartitionedNodes = partitionedNodes

	return report
}

func (h *HealthChecker) detectNetworkPartition(nodeID int) bool {
	state, exists := h.nodeStates[nodeID]
	if !exists {
		return false
	}

	if state.consecutiveFails < h.config.FailureThreshold {
		return false
	}

	if len(state.history) < h.config.FailureThreshold {
		return false
	}

	consecutiveFailures := 0
	for i := len(state.history) - 1; i >= 0; i-- {
		if !state.history[i] {
			consecutiveFailures++
		} else {
			break
		}
	}

	if consecutiveFailures >= h.config.FailureThreshold {
		return true
	}

	return state.isUnavailable && consecutiveFailures >= 3
}

func (h *HealthChecker) GetNodeState(nodeID int) *NodeHealthStatus {
	h.mu.RLock()
	defer h.mu.RUnlock()

	state, exists := h.nodeStates[nodeID]
	if !exists {
		return nil
	}

	status := "healthy"
	if state.isUnavailable {
		status = "unavailable"
	} else if state.consecutiveFails > 0 {
		status = "degraded"
	}

	return &NodeHealthStatus{
		NodeID:            nodeID,
		Alive:             state.consecutiveFails == 0,
		ConsecutiveFails:  state.consecutiveFails,
		LastSuccess:       state.lastSuccess,
		LastFailure:       state.lastFailure,
		LastError:         state.lastError,
		Status:            status,
		Unavailable:       state.isUnavailable,
		IsNetworkPartition: h.detectNetworkPartition(nodeID),
	}
}

func (h *HealthChecker) ResetNodeState(nodeID int) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if state, exists := h.nodeStates[nodeID]; exists {
		state.consecutiveFails = 0
		state.isUnavailable = false
		state.history = make([]bool, 0, h.config.FailureThreshold)
		state.lastError = ""
	}
}

func (r *HealthReport) PrintSummary() {
	fmt.Printf("=== Cluster Health Report ===\n")
	fmt.Printf("Timestamp: %s\n", r.Timestamp.Format(time.RFC3339))
	fmt.Printf("Total Nodes: %d\n", r.TotalNodes)
	fmt.Printf("Healthy Nodes: %d\n", r.HealthyNodes)
	fmt.Printf("Unavailable Nodes: %d\n", r.UnavailableNodes)
	fmt.Printf("Failure Threshold: %d consecutive failures\n", r.FailureThreshold)

	if r.NetworkPartition {
		fmt.Printf("\n⚠️  NETWORK PARTITION DETECTED!\n")
		fmt.Printf("Partitioned nodes: %v\n", r.PartitionedNodes)
	}

	fmt.Printf("\n--- Node Details ---\n")
	for _, node := range r.Nodes {
		statusIcon := "✅"
		if node.Status == "degraded" {
			statusIcon = "⚠️"
		} else if node.Status == "unavailable" {
			statusIcon = "❌"
		}

		fmt.Printf("\n%s Node %d (%s)\n", statusIcon, node.NodeID, node.Address)
		fmt.Printf("  Status: %s\n", node.Status)
		fmt.Printf("  Consecutive Failures: %d\n", node.ConsecutiveFails)

		if !node.LastSuccess.IsZero() {
			fmt.Printf("  Last Success: %s\n", node.LastSuccess.Format(time.RFC3339))
		}
		if !node.LastFailure.IsZero() {
			fmt.Printf("  Last Failure: %s\n", node.LastFailure.Format(time.RFC3339))
		}
		if node.LastError != "" {
			fmt.Printf("  Last Error: %s\n", node.LastError)
		}
		if node.IsNetworkPartition {
			fmt.Printf("  ⚠️  Network Partition Detected\n")
		}
	}
}
