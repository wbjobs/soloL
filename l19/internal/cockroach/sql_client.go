package cockroach

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"dbdoctor/internal/config"

	_ "github.com/lib/pq"
)

var (
	ErrBackupIncomplete = errors.New("backup incomplete, can resume")
)

type RetryConfig struct {
	MaxRetries      int
	InitialBackoff  time.Duration
	MaxBackoff      time.Duration
	BackoffMultiplier float64
	RetryableErrors []string
}

func DefaultRetryConfig() *RetryConfig {
	return &RetryConfig{
		MaxRetries:        5,
		InitialBackoff:   2 * time.Second,
		MaxBackoff:       60 * time.Second,
		BackoffMultiplier: 2.0,
		RetryableErrors: []string{
			"connection refused",
			"connection reset",
			"timeout",
			"i/o timeout",
			"network is unreachable",
			"broken pipe",
			"EOF",
			"deadline exceeded",
			"context deadline exceeded",
			"500 Internal Server Error",
			"502 Bad Gateway",
			"503 Service Unavailable",
			"504 Gateway Timeout",
			"no route to host",
		},
	}
}

func IsRetryableError(err error, config *RetryConfig) bool {
	if err == nil {
		return false
	}
	errStr := strings.ToLower(err.Error())
	for _, retryable := range config.RetryableErrors {
		if strings.Contains(errStr, strings.ToLower(retryable)) {
			return true
		}
	}
	return false
}

func (c *SQLClient) ExecuteWithRetry(ctx context.Context, operation func() (interface{}, error), config *RetryConfig) (interface{}, error) {
	if config == nil {
		config = DefaultRetryConfig()
	}

	var lastErr error
	for attempt := 0; attempt <= config.MaxRetries; attempt++ {
		if attempt > 0 {
			backoff := time.Duration(float64(config.InitialBackoff) * math.Pow(config.BackoffMultiplier, float64(attempt-1)))
			if backoff > config.MaxBackoff {
				backoff = config.MaxBackoff
			}

			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(backoff):
			}
		}

		result, err := operation()
		if err == nil {
			return result, nil
		}

		lastErr = err
		if !IsRetryableError(err, config) {
			return nil, err
		}
	}

	return nil, fmt.Errorf("operation failed after %d retries: %w", config.MaxRetries, lastErr)
}

type SQLClient struct {
	db      *sql.DB
	cluster *config.ClusterConfig
}

type BackupInfo struct {
	JobID          int64     `json:"job_id"`
	BackupType     string    `json:"backup_type"`
	StartTime      time.Time `json:"start_time"`
	EndTime        time.Time `json:"end_time,omitempty"`
	Status         string    `json:"status"`
	SizeBytes      int64     `json:"size_bytes"`
	Rows           int64     `json:"rows"`
	BackupPath     string    `json:"backup_path"`
	IncrementalFrom string   `json:"incremental_from,omitempty"`
}

type NodeDetail struct {
	NodeID         int       `json:"node_id"`
	Address        string    `json:"address"`
	SQLAddress     string    `json:"sql_address"`
	BuildTag       string    `json:"build_tag"`
	StartedAt      time.Time `json:"started_at"`
	Alive          bool      `json:"alive"`
	TotalReplicas  int       `json:"total_replicas"`
	LiveReplicas   int       `json:"live_replicas"`
	Leaseholders   int       `json:"leaseholders"`
	Ranges         int       `json:"ranges"`
	Unavailable    int       `json:"unavailable_ranges"`
	UnderReplicated int      `json:"under_replicated"`
}

func NewSQLClient(cluster *config.ClusterConfig) (*SQLClient, error) {
	connStr := fmt.Sprintf(
		"postgres://%s:%s@%s:%d/%s?sslmode=%s",
		cluster.User, cluster.Password,
		cluster.SQLHost, cluster.SQLPort,
		cluster.Database, cluster.SSLMode,
	)

	if cluster.CACertPath != "" {
		connStr += fmt.Sprintf("&sslrootcert=%s", cluster.CACertPath)
	}

	db, err := sql.Open("postgres", connStr)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}

	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)

	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	return &SQLClient{
		db:      db,
		cluster: cluster,
	}, nil
}

func (c *SQLClient) Close() error {
	return c.db.Close()
}

func (c *SQLClient) GetNodeDetails() ([]NodeDetail, error) {
	query := `
		SELECT
			n.node_id,
			n.address,
			n.sql_address,
			n.build_tag,
			n.started_at,
			n.is_alive,
			COALESCE(m.total_replicas, 0),
			COALESCE(m.live_replicas, 0),
			COALESCE(m.leaseholders, 0),
			COALESCE(m.ranges, 0),
			COALESCE(m.unavailable_ranges, 0),
			COALESCE(m.under_replicated, 0)
		FROM
			crdb_internal.gossip_nodes n
		LEFT JOIN LATERAL (
			SELECT
				SUM(CASE WHEN r.replica_is_leaseholder THEN 1 ELSE 0 END) as leaseholders,
				COUNT(*) as total_replicas,
				SUM(CASE WHEN r.replica_is_live THEN 1 ELSE 0 END) as live_replicas,
				COUNT(DISTINCT r.range_id) as ranges,
				SUM(CASE WHEN r.range_unavailable THEN 1 ELSE 0 END) as unavailable_ranges,
				SUM(CASE WHEN r.range_underreplicated THEN 1 ELSE 0 END) as under_replicated
			FROM crdb_internal.ranges r
			WHERE r.replica_node_id = n.node_id
		) m ON true
		ORDER BY n.node_id
	`

	rows, err := c.db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("failed to query node details: %w", err)
	}
	defer rows.Close()

	var nodes []NodeDetail
	for rows.Next() {
		var node NodeDetail
		err := rows.Scan(
			&node.NodeID, &node.Address, &node.SQLAddress,
			&node.BuildTag, &node.StartedAt, &node.Alive,
			&node.TotalReplicas, &node.LiveReplicas, &node.Leaseholders,
			&node.Ranges, &node.Unavailable, &node.UnderReplicated,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan node row: %w", err)
		}
		nodes = append(nodes, node)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("row iteration error: %w", err)
	}

	return nodes, nil
}

type BackupWithRetryOptions struct {
	S3Path             string
	IncrementalFrom    string
	EncryptionPassphrase string
	FullBackup         bool
	RetryConfig        *RetryConfig
	ProgressCallback   func(attempt int, status string, progress float64)
	ResumeJobID        int64
}

func (c *SQLClient) CreateBackupWithRetry(ctx context.Context, opts BackupWithRetryOptions) (*BackupInfo, error) {
	if opts.RetryConfig == nil {
		opts.RetryConfig = DefaultRetryConfig()
	}

	var lastErr error
	var lastJobID int64

	for attempt := 0; attempt <= opts.RetryConfig.MaxRetries; attempt++ {
		if attempt > 0 {
			backoff := time.Duration(float64(opts.RetryConfig.InitialBackoff) * math.Pow(opts.RetryConfig.BackoffMultiplier, float64(attempt-1)))
			if backoff > opts.RetryConfig.MaxBackoff {
				backoff = opts.RetryConfig.MaxBackoff
			}

			if lastJobID > 0 {
				if opts.ProgressCallback != nil {
					opts.ProgressCallback(attempt, fmt.Sprintf("检查之前的任务 %d 状态...", lastJobID), 0)
				}
				existingStatus, err := c.GetBackupJobStatus(lastJobID)
				if err == nil {
					if existingStatus.Status == "succeeded" {
						if opts.ProgressCallback != nil {
							opts.ProgressCallback(attempt, "检测到之前的备份已成功", 100)
						}
						return existingStatus, nil
					} else if existingStatus.Status == "running" {
						if opts.ProgressCallback != nil {
							opts.ProgressCallback(attempt, "等待正在运行的备份任务...", 0)
						}
						return c.WaitForBackupCompletion(ctx, lastJobID, opts.ProgressCallback, attempt)
					} else if existingStatus.Status == "failed" {
						if opts.ProgressCallback != nil {
							opts.ProgressCallback(attempt, "之前的任务失败，重新创建...", 0)
						}
					}
				}
			}

			if opts.ProgressCallback != nil {
				opts.ProgressCallback(attempt, fmt.Sprintf("重试中 (等待 %.1fs)...", backoff.Seconds()), 0)
			}

			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(backoff):
			}
		}

		if opts.ProgressCallback != nil {
			opts.ProgressCallback(attempt+1, "创建备份任务...", 0)
		}

		var backupInfo *BackupInfo
		var err error

		if opts.FullBackup {
			backupInfo, err = c.CreateFullBackup(opts.S3Path, opts.EncryptionPassphrase)
		} else {
			backupInfo, err = c.CreateIncrementalBackup(opts.S3Path, opts.IncrementalFrom, opts.EncryptionPassphrase)
		}

		if err != nil {
			lastErr = err
			if IsRetryableError(err, opts.RetryConfig) {
				if opts.ProgressCallback != nil {
					opts.ProgressCallback(attempt+1, fmt.Sprintf("创建失败: %v", err), 0)
				}
				continue
			}
			return nil, err
		}

		lastJobID = backupInfo.JobID

		result, err := c.WaitForBackupCompletion(ctx, backupInfo.JobID, opts.ProgressCallback, attempt+1)
		if err != nil {
			lastErr = err
			if IsRetryableError(err, opts.RetryConfig) {
				continue
			}
			return nil, err
		}

		return result, nil
	}

	return nil, fmt.Errorf("backup failed after %d retries: %w", opts.RetryConfig.MaxRetries, lastErr)
}

func (c *SQLClient) WaitForBackupCompletion(ctx context.Context, jobID int64, progressCallback func(attempt int, status string, progress float64), attempt int) (*BackupInfo, error) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-ticker.C:
			status, err := c.GetBackupJobStatus(jobID)
			if err != nil {
				if progressCallback != nil {
					progressCallback(attempt, fmt.Sprintf("查询状态失败: %v", err), 0)
				}
				if IsRetryableError(err, DefaultRetryConfig()) {
					continue
				}
				return nil, err
			}

			if status.Status == "succeeded" {
				if progressCallback != nil {
					progressCallback(attempt, "备份完成", 100)
				}
				return status, nil
			} else if status.Status == "failed" || status.Status == "canceled" {
				return status, fmt.Errorf("backup job %s", status.Status)
			} else if status.Status == "running" {
				elapsed := time.Since(status.StartTime).Seconds()
				progress := math.Min(elapsed/300*100, 95)
				if progressCallback != nil {
					progressCallback(attempt, fmt.Sprintf("备份进行中: %s", status.Status), progress)
				}
			}
		}
	}
}

func (c *SQLClient) CreateIncrementalBackup(s3Path string, incrementalFrom string, encryptionPassphrase string) (*BackupInfo, error) {
	var query string
	var args []interface{}

	if incrementalFrom != "" {
		query = `
			BACKUP INTO $1
			INCREMENTAL FROM $2
			WITH
				detached,
				encryption_passphrase = $3
		`
		args = []interface{}{s3Path, incrementalFrom, encryptionPassphrase}
	} else {
		query = `
			BACKUP INTO $1
			WITH
				detached,
				encryption_passphrase = $2
		`
		args = []interface{}{s3Path, encryptionPassphrase}
	}

	var jobID int64
	err := c.db.QueryRow(query, args...).Scan(&jobID)
	if err != nil {
		return nil, fmt.Errorf("failed to create backup job: %w", err)
	}

	return &BackupInfo{
		JobID:          jobID,
		BackupType:     "incremental",
		Status:         "running",
		StartTime:      time.Now(),
		BackupPath:     s3Path,
		IncrementalFrom: incrementalFrom,
	}, nil
}

func (c *SQLClient) CreateFullBackup(s3Path string, encryptionPassphrase string) (*BackupInfo, error) {
	query := `
		BACKUP INTO $1
		WITH
			detached,
			encryption_passphrase = $2
	`

	var jobID int64
	err := c.db.QueryRow(query, s3Path, encryptionPassphrase).Scan(&jobID)
	if err != nil {
		return nil, fmt.Errorf("failed to create backup job: %w", err)
	}

	return &BackupInfo{
		JobID:      jobID,
		BackupType: "full",
		Status:     "running",
		StartTime:  time.Now(),
		BackupPath: s3Path,
	}, nil
}

func (c *SQLClient) GetBackupJobStatus(jobID int64) (*BackupInfo, error) {
	query := `
		SELECT
			job_id,
			status,
			created,
			finished,
			fraction_completed,
			description
		FROM
			[SHOW JOBS]
		WHERE
			job_id = $1
	`

	var (
		jobIDOut       int64
		status         string
		created        time.Time
		finished       sql.NullTime
		fraction       float64
		description    string
	)

	err := c.db.QueryRow(query, jobID).Scan(&jobIDOut, &status, &created, &finished, &fraction, &description)
	if err != nil {
		return nil, fmt.Errorf("failed to get backup job status: %w", err)
	}

	backup := &BackupInfo{
		JobID:     jobIDOut,
		Status:    status,
		StartTime: created,
	}

	if finished.Valid {
		backup.EndTime = finished.Time
	}

	if status == "succeeded" {
		backup.BackupType = "completed"
	}

	return backup, nil
}

func (c *SQLClient) ListBackups(s3Path string, encryptionPassphrase string) ([]BackupInfo, error) {
	query := `
		SHOW BACKUPS IN $1 WITH encryption_passphrase = $2
	`

	rows, err := c.db.Query(query, s3Path, encryptionPassphrase)
	if err != nil {
		return nil, fmt.Errorf("failed to list backups: %w", err)
	}
	defer rows.Close()

	var backups []BackupInfo
	for rows.Next() {
		var (
			path       string
			startTime  time.Time
			endTime    time.Time
			backupType string
		)

		cols, err := rows.Columns()
		if err != nil {
			return nil, err
		}

		if len(cols) >= 4 {
			err = rows.Scan(&path, &startTime, &endTime, &backupType)
		} else {
			err = rows.Scan(&path, &startTime, &endTime)
			backupType = "unknown"
		}

		if err != nil {
			return nil, fmt.Errorf("failed to scan backup row: %w", err)
		}

		backups = append(backups, BackupInfo{
			BackupType: backupType,
			StartTime:  startTime,
			EndTime:    endTime,
			BackupPath: path,
			Status:     "available",
		})
	}

	return backups, nil
}

func (c *SQLClient) RestoreBackup(s3Path string, targetTime string, encryptionPassphrase string, database string) (int64, error) {
	var query string
	var args []interface{}

	if targetTime != "" {
		query = `
			RESTORE DATABASE $1
			FROM LATEST IN $2
			AS OF SYSTEM TIME $3
			WITH
				detached,
				encryption_passphrase = $4
		`
		args = []interface{}{database, s3Path, targetTime, encryptionPassphrase}
	} else {
		query = `
			RESTORE DATABASE $1
			FROM LATEST IN $2
			WITH
				detached,
				encryption_passphrase = $3
		`
		args = []interface{}{database, s3Path, encryptionPassphrase}
	}

	var jobID int64
	err := c.db.QueryRow(query, args...).Scan(&jobID)
	if err != nil {
		return 0, fmt.Errorf("failed to create restore job: %w", err)
	}

	return jobID, nil
}

type LeaseRebalanceResult struct {
	TotalRanges      int
	LeasesTransferred int
	ReplicasMoved    int
	Errors           []string
	Duration         time.Duration
}

func (c *SQLClient) RebalanceRangeLeases() error {
	_, err := c.db.Exec("SELECT crdb_internal.leaseholder_stats_reset()")
	if err != nil {
		return fmt.Errorf("failed to reset leaseholder stats: %w", err)
	}

	_, err = c.db.Exec("SELECT crdb_internal.rebalance_all_replicas()")
	if err != nil {
		return fmt.Errorf("failed to rebalance replicas: %w", err)
	}

	_, err = c.db.Exec("SELECT crdb_internal.transfer_lease_all()")
	if err != nil {
		return fmt.Errorf("failed to transfer leases: %w", err)
	}

	return nil
}

func (c *SQLClient) SafeRebalance(progressCallback func(string)) (*LeaseRebalanceResult, error) {
	result := &LeaseRebalanceResult{
		Errors: make([]string, 0),
	}
	startTime := time.Now()

	if progressCallback != nil {
		progressCallback("Phase 1/4: Analyzing range distribution...")
	}

	query := `
		SELECT
			r.range_id,
			r.start_key,
			r.replica_node_ids,
			r.lease_holder,
			n.node_id as target_node,
			'lease' as action_type
		FROM crdb_internal.ranges r
		CROSS JOIN crdb_internal.gossip_nodes n
		WHERE
			r.lease_holder != n.node_id
			AND n.is_alive = true
			AND array_length(r.replica_node_ids, 1) >= 3
		LIMIT 100
	`

	rows, err := c.db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("failed to analyze ranges: %w", err)
	}
	defer rows.Close()

	type rangeInfo struct {
		RangeID       int
		StartKey      string
		ReplicaNodes  string
		LeaseHolder   int
		TargetNode    int
	}

	ranges := make([]rangeInfo, 0)
	for rows.Next() {
		var r rangeInfo
		if err := rows.Scan(&r.RangeID, &r.StartKey, &r.ReplicaNodes, &r.LeaseHolder, &r.TargetNode); err != nil {
			continue
		}
		ranges = append(ranges, r)
	}

	result.TotalRanges = len(ranges)

	if progressCallback != nil {
		progressCallback(fmt.Sprintf("Phase 2/4: Transferring %d leases...", len(ranges)))
	}

	leaseTransferred := 0
	for i, r := range ranges {
		if progressCallback != nil && i%10 == 0 {
			progressCallback(fmt.Sprintf("  Transferring lease %d/%d...", i+1, len(ranges)))
		}

		err := c.transferLease(r.RangeID, r.TargetNode)
		if err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("range %d: %v", r.RangeID, err))
			continue
		}

		if err := c.waitForLeaseRaftConfirm(r.RangeID, 30*time.Second); err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("range %d raft confirm: %v", r.RangeID, err))
			continue
		}

		leaseTransferred++
		time.Sleep(100 * time.Millisecond)
	}
	result.LeasesTransferred = leaseTransferred

	if progressCallback != nil {
		progressCallback(fmt.Sprintf("Phase 3/4: Waiting for lease stabilization..."))
	}
	time.Sleep(2 * time.Second)

	if progressCallback != nil {
		progressCallback("Phase 4/4: Moving replicas...")
	}

	_, err = c.db.Exec("SELECT crdb_internal.rebalance_all_replicas()")
	if err != nil {
		result.Errors = append(result.Errors, fmt.Sprintf("replica rebalance: %v", err))
	} else {
		result.ReplicasMoved = -1
	}

	result.Duration = time.Since(startTime)
	return result, nil
}

func (c *SQLClient) transferLease(rangeID int, targetNode int) error {
	query := fmt.Sprintf(`
		ALTER RANGE %d EXPERIMENTAL_RELOCATE LEASE TO %d
	`, rangeID, targetNode)

	_, err := c.db.Exec(query)
	if err != nil {
		return fmt.Errorf("failed to relocate lease: %w", err)
	}
	return nil
}

func (c *SQLClient) waitForLeaseRaftConfirm(rangeID int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	for time.Now().Before(deadline) {
		<-ticker.C

		var leaseHolder int
		query := `
			SELECT lease_holder
			FROM crdb_internal.ranges
			WHERE range_id = $1
		`
		err := c.db.QueryRow(query, rangeID).Scan(&leaseHolder)
		if err == nil {
			return nil
		}
	}

	return fmt.Errorf("timeout waiting for raft confirmation")
}

func (c *SQLClient) CheckClusterHealth() (bool, string, error) {
	query := `
		SELECT
			COUNT(*) as unhealthy_nodes
		FROM
			crdb_internal.gossip_nodes
		WHERE
			is_alive = false
	`

	var unhealthyNodes int
	err := c.db.QueryRow(query).Scan(&unhealthyNodes)
	if err != nil {
		return false, "", fmt.Errorf("failed to check cluster health: %w", err)
	}

	if unhealthyNodes > 0 {
		return false, fmt.Sprintf("%d nodes are unhealthy", unhealthyNodes), nil
	}

	query = `
		SELECT
			COUNT(*) as unavailable_ranges
		FROM
			crdb_internal.ranges
		WHERE
			unavailable = true
	`

	var unavailableRanges int
	err = c.db.QueryRow(query).Scan(&unavailableRanges)
	if err != nil {
		return false, "", fmt.Errorf("failed to check range health: %w", err)
	}

	if unavailableRanges > 0 {
		return false, fmt.Sprintf("%d ranges are unavailable", unavailableRanges), nil
	}

	return true, "cluster is healthy", nil
}

type DiagnosticSnapshot struct {
	Timestamp           time.Time `json:"timestamp"`
	QPS                 float64   `json:"qps"`
	P99LatencyMs        float64   `json:"p99_latency_ms"`
	P50LatencyMs        float64   `json:"p50_latency_ms"`
	AvgLatencyMs        float64   `json:"avg_latency_ms"`
	ActiveQueries       int       `json:"active_queries"`
	TotalQueries        int64     `json:"total_queries"`
	SlowQueries         int       `json:"slow_queries"`
	TransactionsPerSec  float64   `json:"transactions_per_sec"`
	CommitsPerSec       float64   `json:"commits_per_sec"`
	RollbacksPerSec     float64   `json:"rollbacks_per_sec"`
	RangeCount          int       `json:"range_count"`
	ReplicaCount        int       `json:"replica_count"`
	UnavailableRanges   int       `json:"unavailable_ranges"`
	UnderReplicated     int       `json:"under_replicated"`
	Liveness            float64   `json:"liveness"`
	MemoryUsageBytes    int64     `json:"memory_usage_bytes"`
	CPUUsagePercent     float64   `json:"cpu_usage_percent"`
	DiskReadBytes       int64     `json:"disk_read_bytes"`
	DiskWriteBytes      int64     `json:"disk_write_bytes"`
	NetBytesSent        int64     `json:"net_bytes_sent"`
	NetBytesRecv        int64     `json:"net_bytes_recv"`
}

type SlowQueryInfo struct {
	QueryID      string    `json:"query_id"`
	Query        string    `json:"query"`
	Database     string    `json:"database"`
	DurationMs   float64   `json:"duration_ms"`
	StartTime    time.Time `json:"start_time"`
	NodeID       int       `json:"node_id"`
	Status       string    `json:"status"`
	RowsAffected int64     `json:"rows_affected"`
	Retries      int       `json:"retries"`
}

type TableStatInfo struct {
	TableName      string `json:"table_name"`
	Database       string `json:"database"`
	RowCount       int64  `json:"row_count"`
	IndexCount     int    `json:"index_count"`
	TombstoneCount int64  `json:"tombstone_count"`
	RangeCount     int    `json:"range_count"`
	ReplicaCount   int    `json:"replica_count"`
	HasPrimaryKey  bool   `json:"has_primary_key"`
}

type DiagnosticResult struct {
	ClusterName      string               `json:"cluster_name"`
	StartTime        time.Time            `json:"start_time"`
	EndTime          time.Time            `json:"end_time"`
	DurationSeconds  int                  `json:"duration_seconds"`
	Snapshots        []DiagnosticSnapshot `json:"snapshots"`
	SlowQueries      []SlowQueryInfo      `json:"slow_queries"`
	TableStats       []TableStatInfo      `json:"table_stats"`
	Recommendations  []Recommendation     `json:"recommendations"`
	SummaryQPS       float64              `json:"summary_qps"`
	SummaryP99Ms     float64              `json:"summary_p99_ms"`
	SummarySlowCount int                  `json:"summary_slow_count"`
}

type Recommendation struct {
	Severity  string `json:"severity"`
	Category  string `json:"category"`
	Title     string `json:"title"`
	Detail    string `json:"detail"`
	Action    string `json:"action"`
}

func (c *SQLClient) CollectDiagnosticSnapshot() (*DiagnosticSnapshot, error) {
	snap := &DiagnosticSnapshot{Timestamp: time.Now()}

	queries := []struct {
		query string
		scan  func(row *sql.Row) error
	}{
		{
			`SELECT COALESCE(value::float, 0) FROM crdb_internal.node_metrics WHERE name = 'sql.queries.count' LIMIT 1`,
			func(row *sql.Row) error { return row.Scan(&snap.TotalQueries) },
		},
		{
			`SELECT COALESCE(COUNT(*), 0) FROM crdb_internal.node_statement_statistics WHERE latency > 0.1`,
			func(row *sql.Row) error { return row.Scan(&snap.SlowQueries) },
		},
		{
			`SELECT COALESCE(COUNT(*), 0) FROM [SHOW CLUSTER STATEMENTS]`,
			func(row *sql.Row) error { return row.Scan(&snap.ActiveQueries) },
		},
		{
			`SELECT COALESCE(COUNT(*), 0) FROM crdb_internal.ranges`,
			func(row *sql.Row) error { return row.Scan(&snap.RangeCount) },
		},
		{
			`SELECT COALESCE(COUNT(*), 0) FROM crdb_internal.ranges WHERE unavailable = true`,
			func(row *sql.Row) error { return row.Scan(&snap.UnavailableRanges) },
		},
		{
			`SELECT COALESCE(COUNT(*), 0) FROM crdb_internal.ranges WHERE under_replicated = true`,
			func(row *sql.Row) error { return row.Scan(&snap.UnderReplicated) },
		},
	}

	for _, q := range queries {
		if err := q.scan(c.db.QueryRow(q.query)); err != nil {
			continue
		}
	}

	c.collectMetricsFromShowStats(snap)

	return snap, nil
}

func (c *SQLClient) collectMetricsFromShowStats(snap *DiagnosticSnapshot) {
	rows, err := c.db.Query(`
		SELECT
			metric,
			value
		FROM (
			SELECT 'sql.query.count' as metric, COALESCE(COUNT(*), 0)::float as value FROM [SHOW CLUSTER STATEMENTS]
			UNION ALL
			SELECT 'range.count', COALESCE(COUNT(*), 0)::float FROM crdb_internal.ranges
			UNION ALL
			SELECT 'range.unavailable', COALESCE(COUNT(*), 0)::float FROM crdb_internal.ranges WHERE unavailable = true
		) sub
	`)
	if err != nil {
		return
	}
	defer rows.Close()

	for rows.Next() {
		var metric string
		var value float64
		if err := rows.Scan(&metric, &value); err != nil {
			continue
		}
		switch metric {
		case "sql.query.count":
			snap.ActiveQueries = int(value)
		case "range.unavailable":
			snap.UnavailableRanges = int(value)
		}
	}
}

func (c *SQLClient) CollectSlowQueries(thresholdMs float64) ([]SlowQueryInfo, error) {
	query := fmt.Sprintf(`
		SELECT
			query_id,
			query,
			database,
			elapsed::float * 1000 as duration_ms,
			start,
			node_id,
			status,
			rows_affected,
			retries
		FROM [SHOW CLUSTER STATEMENTS]
		WHERE elapsed > '%f seconds'::interval
		ORDER BY elapsed DESC
		LIMIT 50
	`, thresholdMs/1000.0)

	rows, err := c.db.Query(query)
	if err != nil {
		altQuery := fmt.Sprintf(`
			SELECT
				query_id,
				query,
				database,
				avg_latency::float * 1000 as duration_ms,
				NOW() as start,
				0 as node_id,
				'completed' as status,
				0 as rows_affected,
				0 as retries
			FROM crdb_internal.node_statement_statistics
			WHERE avg_latency > '%f seconds'::interval
			ORDER BY avg_latency DESC
			LIMIT 50
		`, thresholdMs/1000.0)
		rows, err = c.db.Query(altQuery)
		if err != nil {
			return nil, fmt.Errorf("failed to query slow queries: %w", err)
		}
	}
	defer rows.Close()

	var slowQueries []SlowQueryInfo
	for rows.Next() {
		var sq SlowQueryInfo
		if err := rows.Scan(&sq.QueryID, &sq.Query, &sq.Database, &sq.DurationMs,
			&sq.StartTime, &sq.NodeID, &sq.Status, &sq.RowsAffected, &sq.Retries); err != nil {
			continue
		}
		slowQueries = append(slowQueries, sq)
	}

	return slowQueries, nil
}

func (c *SQLClient) CollectTableStats() ([]TableStatInfo, error) {
	query := `
		SELECT
			t.table_name,
			t.table_catalog as database,
			COALESCE(s.row_count, 0),
			COALESCE(idx.index_count, 0),
			COALESCE(tomb.tombstone_count, 0),
			COALESCE(r.range_count, 0),
			COALESCE(rep.replica_count, 0),
			COALESCE(pk.has_pk, false)
		FROM information_schema.tables t
		LEFT JOIN (
			SELECT
				table_name,
				COUNT(*) as index_count
			FROM information_schema.statistics
			WHERE index_name != 'PRIMARY'
			GROUP BY table_name
		) idx ON t.table_name = idx.table_name
		LEFT JOIN (
			SELECT
				table_name,
				estimate_count as row_count
			FROM crdb_internal.table_row_statistics
		) s ON t.table_name = s.table_name
		LEFT JOIN (
			SELECT
				table_name,
				0 as tombstone_count
			FROM information_schema.tables
			WHERE 1=0
		) tomb ON t.table_name = tomb.table_name
		LEFT JOIN (
			SELECT
				table_name,
				COUNT(*) as range_count
			FROM (
				SELECT
					split_part(range_name, '.', 2) as table_name
				FROM crdb_internal.ranges
				WHERE range_name LIKE '%.%'
			) sub
			GROUP BY table_name
		) r ON t.table_name = r.table_name
		LEFT JOIN (
			SELECT
				split_part(range_name, '.', 2) as table_name,
				COUNT(*) as replica_count
			FROM crdb_internal.ranges
			WHERE range_name LIKE '%.%'
			GROUP BY split_part(range_name, '.', 2)
		) rep ON t.table_name = rep.table_name
		LEFT JOIN (
			SELECT
				table_name,
				true as has_pk
			FROM information_schema.table_constraints
			WHERE constraint_type = 'PRIMARY KEY'
		) pk ON t.table_name = pk.table_name
		WHERE t.table_schema = 'public'
		AND t.table_type = 'BASE TABLE'
		ORDER BY s.row_count DESC NULLS LAST
	`

	rows, err := c.db.Query(query)
	if err != nil {
		return c.collectTableStatsFallback()
	}
	defer rows.Close()

	var stats []TableStatInfo
	for rows.Next() {
		var st TableStatInfo
		if err := rows.Scan(&st.TableName, &st.Database, &st.RowCount, &st.IndexCount,
			&st.TombstoneCount, &st.RangeCount, &st.ReplicaCount, &st.HasPrimaryKey); err != nil {
			continue
		}
		stats = append(stats, st)
	}

	return stats, nil
}

func (c *SQLClient) collectTableStatsFallback() ([]TableStatInfo, error) {
	query := `
		SELECT
			table_name,
			COALESCE(estimate_count, 0)
		FROM crdb_internal.table_row_statistics
		WHERE database_name = current_database()
		ORDER BY estimate_count DESC NULLS LAST
		LIMIT 20
	`

	rows, err := c.db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("failed to query table stats: %w", err)
	}
	defer rows.Close()

	var stats []TableStatInfo
	for rows.Next() {
		var st TableStatInfo
		if err := rows.Scan(&st.TableName, &st.RowCount); err != nil {
			continue
		}
		st.Database = "defaultdb"
		stats = append(stats, st)
	}

	return stats, nil
}

func (c *SQLClient) CollectTombstoneStats() (map[string]int64, error) {
	query := `
		SELECT
			span_name as table_name,
			COUNT(*) as tombstone_estimate
		FROM crdb_internal.node_txn_stats
		WHERE span_name LIKE '%public.%'
		GROUP BY span_name
	`

	rows, err := c.db.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string]int64)
	for rows.Next() {
		var tableName string
		var count int64
		if err := rows.Scan(&tableName, &count); err != nil {
			continue
		}
		result[tableName] = count
	}

	return result, nil
}

func (c *SQLClient) RunDiagnostics(durationSeconds int, slowThresholdMs float64, progressCallback func(string)) (*DiagnosticResult, error) {
	result := &DiagnosticResult{
		StartTime:       time.Now(),
		DurationSeconds: durationSeconds,
		Snapshots:       make([]DiagnosticSnapshot, 0),
		SlowQueries:     make([]SlowQueryInfo, 0),
		TableStats:      make([]TableStatInfo, 0),
		Recommendations: make([]Recommendation, 0),
	}

	if progressCallback != nil {
		progressCallback("采集表统计信息...")
	}
	tableStats, err := c.CollectTableStats()
	if err == nil {
		result.TableStats = tableStats
	}

	if progressCallback != nil {
		progressCallback(fmt.Sprintf("开始采集 %d 秒性能快照...", durationSeconds))
	}

	interval := 5
	if durationSeconds < 5 {
		interval = durationSeconds
	}
	ticker := time.NewTicker(time.Duration(interval) * time.Second)
	defer ticker.Stop()

	elapsed := 0
	for elapsed < durationSeconds {
		snap, err := c.CollectDiagnosticSnapshot()
		if err == nil {
			result.Snapshots = append(result.Snapshots, *snap)
		}

		select {
		case <-ticker.C:
			elapsed += interval
			if progressCallback != nil {
				progressCallback(fmt.Sprintf("已采集 %d/%d 秒...", elapsed, durationSeconds))
			}
		}
	}

	result.EndTime = time.Now()

	if progressCallback != nil {
		progressCallback("采集慢查询日志...")
	}
	slowQueries, err := c.CollectSlowQueries(slowThresholdMs)
	if err == nil {
		result.SlowQueries = slowQueries
	}

	c.computeSummary(result)
	c.generateRecommendations(result)

	return result, nil
}

func (c *SQLClient) computeSummary(result *DiagnosticResult) {
	if len(result.Snapshots) == 0 {
		return
	}

	var totalQPS float64
	var maxP99 float64
	var totalSlow int

	for i, snap := range result.Snapshots {
		totalQPS += snap.QPS
		if snap.P99LatencyMs > maxP99 {
			maxP99 = snap.P99LatencyMs
		}
		totalSlow += snap.SlowQueries

		if i > 0 {
			delta := snap.TotalQueries - result.Snapshots[i-1].TotalQueries
			snapInterval := snap.Timestamp.Sub(result.Snapshots[i-1].Timestamp).Seconds()
			if snapInterval > 0 {
				result.SummaryQPS += float64(delta) / snapInterval
			}
		}
	}

	n := len(result.Snapshots)
	if n > 1 {
		result.SummaryQPS /= float64(n - 1)
	}
	result.SummaryP99Ms = maxP99
	result.SummarySlowCount = totalSlow

	_ = totalQPS
}

func (c *SQLClient) generateRecommendations(result *DiagnosticResult) {
	for _, sq := range result.SlowQueries {
		if sq.DurationMs > 1000 {
			result.Recommendations = append(result.Recommendations, Recommendation{
				Severity: "high",
				Category: "慢查询",
				Title:    fmt.Sprintf("查询执行时间过长 (%.0fms)", sq.DurationMs),
				Detail:   fmt.Sprintf("数据库 %s 中的查询执行时间 %.0fms，远超100ms阈值", sq.Database, sq.DurationMs),
				Action:   fmt.Sprintf("检查查询是否缺少索引: %s", truncateQuery(sq.Query, 80)),
			})
		}
	}

	for _, ts := range result.TableStats {
		if ts.IndexCount == 0 && ts.RowCount > 10000 {
			result.Recommendations = append(result.Recommendations, Recommendation{
				Severity: "high",
				Category: "索引",
				Title:    fmt.Sprintf("表 %s 缺少二级索引", ts.TableName),
				Detail:   fmt.Sprintf("表 %s 有 %d 行但只有 %d 个索引，频繁查询可能产生全表扫描", ts.TableName, ts.RowCount, ts.IndexCount),
				Action:   fmt.Sprintf("为表 %s 添加常用查询字段的二级索引", ts.TableName),
			})
		}

		if !ts.HasPrimaryKey && ts.RowCount > 0 {
			result.Recommendations = append(result.Recommendations, Recommendation{
				Severity: "high",
				Category: "索引",
				Title:    fmt.Sprintf("表 %s 缺少主键", ts.TableName),
				Detail:   fmt.Sprintf("表 %s 没有主键，可能影响性能和数据一致性", ts.TableName),
				Action:   fmt.Sprintf("为表 %s 添加主键约束", ts.TableName),
			})
		}

		if ts.TombstoneCount > ts.RowCount/10 && ts.RowCount > 1000 {
			result.Recommendations = append(result.Recommendations, Recommendation{
				Severity: "medium",
				Category: "GC",
				Title:    fmt.Sprintf("表 %s tombstone过多", ts.TableName),
				Detail:   fmt.Sprintf("表 %s 的tombstone数量(%d)超过行数的10%%，可能影响读取性能", ts.TableName, ts.TombstoneCount),
				Action:   "执行 ALTER TABLE ... COMPACT 或手动触发GC: SET CLUSTER SETTING kv.range_merge.queue_interval = '50ms'",
			})
		}
	}

	for _, snap := range result.Snapshots {
		if snap.UnavailableRanges > 0 {
			result.Recommendations = append(result.Recommendations, Recommendation{
				Severity: "critical",
				Category: "可用性",
				Title:    fmt.Sprintf("%d 个Range不可用", snap.UnavailableRanges),
				Detail:   fmt.Sprintf("集群中有 %d 个不可用Range，可能导致数据读写失败", snap.UnavailableRanges),
				Action:   "检查节点存活状态，确保副本数足够: dbdoctor node status -H",
			})
			break
		}
	}

	for _, snap := range result.Snapshots {
		if snap.UnderReplicated > 5 {
			result.Recommendations = append(result.Recommendations, Recommendation{
				Severity: "medium",
				Category: "复制",
				Title:    fmt.Sprintf("%d 个Range复制不足", snap.UnderReplicated),
				Detail:   fmt.Sprintf("集群中有 %d 个Range的副本数少于期望值", snap.UnderReplicated),
				Action:   "检查节点资源是否充足，或调整复制因子配置",
			})
			break
		}
	}

	if result.SummaryP99Ms > 500 {
		result.Recommendations = append(result.Recommendations, Recommendation{
			Severity: "high",
			Category: "延迟",
			Title:    fmt.Sprintf("P99延迟过高 (%.0fms)", result.SummaryP99Ms),
			Detail:   fmt.Sprintf("集群P99延迟为 %.0fms，远超正常水平(< 100ms)", result.SummaryP99Ms),
			Action:   "检查是否有长事务、锁竞争、或热点Range，使用 dbdoctor diagnose 进一步分析",
		})
	}

	if len(result.SlowQueries) > 10 {
		result.Recommendations = append(result.Recommendations, Recommendation{
			Severity: "medium",
			Category: "慢查询",
			Title:    fmt.Sprintf("大量慢查询 (%d条)", len(result.SlowQueries)),
			Detail:   fmt.Sprintf("检测到 %d 条执行时间超过100ms的查询", len(result.SlowQueries)),
			Action:   "分析慢查询模式，添加缺失索引或优化查询逻辑",
		})
	}
}

func truncateQuery(query string, maxLen int) string {
	if len(query) <= maxLen {
		return query
	}
	return query[:maxLen] + "..."
}
