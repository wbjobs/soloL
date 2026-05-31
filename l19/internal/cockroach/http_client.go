package cockroach

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"dbdoctor/internal/config"
)

type NodeStatus struct {
	NodeID    int       `json:"node_id"`
	Address   string    `json:"address"`
	SQLAddress string   `json:"sql_address"`
	BuildTag  string    `json:"build_tag"`
	StartedAt time.Time `json:"started_at"`
	Metrics   Metrics   `json:"metrics"`
}

type Metrics struct {
	LiveReplicas       int `json:"replicas.live"`
	TotalReplicas      int `json:"replicas.total"`
	Leaseholders       int `json:"replicas.leaseholders"`
	Ranges             int `json:"ranges"`
	UnavailableRanges  int `json:"ranges.unavailable"`
	UnderReplicated    int `json:"ranges.under_replicated"`
	CPUPercent         float64 `json:"sys.cpu.percent"`
	MemoryUsage        float64 `json:"sys.rss"`
}

type NodeHealth struct {
	NodeID    int       `json:"node_id"`
	Healthy   bool      `json:"healthy"`
	LastCheck time.Time `json:"last_check"`
	Error     string    `json:"error,omitempty"`
}

type RebalanceResponse struct {
	JobID     int64  `json:"job_id"`
	Status    string `json:"status"`
	Message   string `json:"message"`
}

type HTTPClient struct {
	baseURL    string
	cluster    *config.ClusterConfig
	httpClient *http.Client
}

func NewHTTPClient(cluster *config.ClusterConfig) *HTTPClient {
	baseURL := fmt.Sprintf("http://%s:%d", cluster.HTTPHost, cluster.HTTPPort)
	if cluster.SSLMode == "require" || cluster.SSLMode == "verify-full" {
		baseURL = fmt.Sprintf("https://%s:%d", cluster.HTTPHost, cluster.HTTPPort)
	}

	tr := &http.Transport{
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: cluster.SSLMode != "verify-full",
		},
	}

	return &HTTPClient{
		baseURL: baseURL,
		cluster: cluster,
		httpClient: &http.Client{
			Timeout:   30 * time.Second,
			Transport: tr,
		},
	}
}

func (c *HTTPClient) GetNodes() ([]NodeStatus, error) {
	url := fmt.Sprintf("%s/api/v2/nodes/", c.baseURL)
	resp, err := c.doRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result struct {
		Nodes []NodeStatus `json:"nodes"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode nodes response: %w", err)
	}

	return result.Nodes, nil
}

func (c *HTTPClient) GetNodeHealth(nodeID int, timeout time.Duration) (*NodeHealth, error) {
	url := fmt.Sprintf("%s/api/v2/health/?node_id=%d", c.baseURL, nodeID)
	
	client := &http.Client{
		Timeout: timeout,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{
				InsecureSkipVerify: c.cluster.SSLMode != "verify-full",
			},
		},
	}

	start := time.Now()
	resp, err := client.Get(url)
	health := &NodeHealth{
		NodeID:    nodeID,
		LastCheck: time.Now(),
	}

	if err != nil {
		health.Healthy = false
		health.Error = err.Error()
		return health, nil
	}
	defer resp.Body.Close()

	health.Healthy = resp.StatusCode >= 200 && resp.StatusCode < 300
	if !health.Healthy {
		body, _ := io.ReadAll(resp.Body)
		health.Error = fmt.Sprintf("HTTP %d: %s", resp.StatusCode, string(body))
	}

	_ = start
	return health, nil
}

func (c *HTTPClient) CheckNodeLiveness(nodeID int) (*NodeHealth, error) {
	url := fmt.Sprintf("%s/api/v2/nodes/%d", c.baseURL, nodeID)
	resp, err := c.doRequest("GET", url, nil)
	health := &NodeHealth{
		NodeID:    nodeID,
		LastCheck: time.Now(),
	}

	if err != nil {
		health.Healthy = false
		health.Error = err.Error()
		return health, nil
	}
	defer resp.Body.Close()

	var node NodeStatus
	if err := json.NewDecoder(resp.Body).Decode(&node); err != nil {
		health.Healthy = false
		health.Error = fmt.Sprintf("failed to parse response: %v", err)
		return health, nil
	}

	health.Healthy = true
	return health, nil
}

func (c *HTTPClient) TriggerRebalance() (*RebalanceResponse, error) {
	url := fmt.Sprintf("%s/api/v2/admin/rebalance", c.baseURL)
	resp, err := c.doRequest("POST", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to trigger rebalance: %w", err)
	}
	defer resp.Body.Close()

	var result RebalanceResponse
	if resp.StatusCode == 200 {
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			result.Status = "success"
			result.Message = "Rebalance triggered successfully"
		}
	} else {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("rebalance failed: HTTP %d - %s", resp.StatusCode, string(body))
	}

	return &result, nil
}

func (c *HTTPClient) TriggerLeaseRebalance() (*RebalanceResponse, error) {
	url := fmt.Sprintf("%s/api/v2/admin/leaseholder_rebalance", c.baseURL)
	resp, err := c.doRequest("POST", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to trigger lease rebalance: %w", err)
	}
	defer resp.Body.Close()

	var result RebalanceResponse
	if resp.StatusCode == 200 {
		result.Status = "success"
		result.Message = "Lease rebalance triggered successfully"
	} else {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("lease rebalance failed: HTTP %d - %s", resp.StatusCode, string(body))
	}

	return &result, nil
}

func (c *HTTPClient) doRequest(method, url string, body io.Reader) (*http.Response, error) {
	req, err := http.NewRequest(method, url, body)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	if c.cluster.User != "" && c.cluster.Password != "" {
		req.SetBasicAuth(c.cluster.User, c.cluster.Password)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, fmt.Errorf("API error: HTTP %d - %s", resp.StatusCode, string(respBody))
	}

	return resp, nil
}
