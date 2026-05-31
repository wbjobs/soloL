package store

import (
	"database/sql"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

type TraceEvent struct {
	ID          int64  `json:"id"`
	PID         uint32 `json:"pid"`
	TID         uint32 `json:"tid"`
	Comm        string `json:"comm"`
	TimestampNs uint64 `json:"timestamp_ns"`
	DurationNs  uint64 `json:"duration_ns"`
	Syscall     string `json:"syscall"`
	FD          uint64 `json:"fd"`
	Size        uint64 `json:"size"`
	Ret         int64  `json:"ret"`
	CreatedAt   string `json:"created_at"`
}

type AggregateResult struct {
	PID            uint32 `json:"pid"`
	Comm           string `json:"comm"`
	Syscall        string `json:"syscall"`
	CallCount      int64  `json:"call_count"`
	TotalDurationNs uint64 `json:"total_duration_ns"`
	AvgDurationNs  uint64 `json:"avg_duration_ns"`
	MinDurationNs  uint64 `json:"min_duration_ns"`
	MaxDurationNs  uint64 `json:"max_duration_ns"`
}

type FlameGraphNode struct {
	Name     string           `json:"name"`
	Value    uint64           `json:"value"`
	Children []FlameGraphNode `json:"children"`
}

type Store struct {
	db *sql.DB
}

func NewStore(dbPath string) (*Store, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("opening database: %w", err)
	}

	db.SetMaxOpenConns(1)

	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, fmt.Errorf("running migrations: %w", err)
	}

	return s, nil
}

func (s *Store) migrate() error {
	_, err := s.db.Exec(`
		CREATE TABLE IF NOT EXISTS trace_events (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			pid INTEGER NOT NULL,
			tid INTEGER NOT NULL,
			comm TEXT NOT NULL,
			timestamp_ns INTEGER NOT NULL,
			duration_ns INTEGER NOT NULL,
			syscall TEXT NOT NULL,
			fd INTEGER NOT NULL,
			size INTEGER NOT NULL,
			ret INTEGER NOT NULL,
			created_at TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_trace_events_pid ON trace_events(pid);
	`)
	return err
}

func (s *Store) Insert(event *TraceEvent) error {
	_, err := s.db.Exec(
		`INSERT INTO trace_events (pid, tid, comm, timestamp_ns, duration_ns, syscall, fd, size, ret, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		event.PID, event.TID, event.Comm, event.TimestampNs,
		event.DurationNs, event.Syscall, event.FD, event.Size,
		event.Ret, time.Now().UTC().Format(time.RFC3339Nano),
	)
	return err
}

func (s *Store) QueryByPID(pid uint32) ([]TraceEvent, error) {
	rows, err := s.db.Query(
		`SELECT id, pid, tid, comm, timestamp_ns, duration_ns, syscall, fd, size, ret, created_at
		 FROM trace_events WHERE pid = ? ORDER BY timestamp_ns ASC`,
		pid,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanEvents(rows)
}

func (s *Store) QueryAll() ([]TraceEvent, error) {
	rows, err := s.db.Query(
		`SELECT id, pid, tid, comm, timestamp_ns, duration_ns, syscall, fd, size, ret, created_at
		 FROM trace_events ORDER BY timestamp_ns ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanEvents(rows)
}

func (s *Store) Clear() error {
	_, err := s.db.Exec(`DELETE FROM trace_events`)
	return err
}

func (s *Store) Close() error {
	return s.db.Close()
}

func ParseTimeRange(timeRange string) (time.Time, error) {
	now := time.Now().UTC()
	switch timeRange {
	case "last_1m":
		return now.Add(-1 * time.Minute), nil
	case "last_5m":
		return now.Add(-5 * time.Minute), nil
	case "last_15m":
		return now.Add(-15 * time.Minute), nil
	case "last_1h":
		return now.Add(-1 * time.Hour), nil
	case "last_6h":
		return now.Add(-6 * time.Hour), nil
	case "last_24h":
		return now.Add(-24 * time.Hour), nil
	case "all":
		return time.Time{}, nil
	default:
		return time.Time{}, fmt.Errorf("invalid time_range: %s (use last_1m, last_5m, last_15m, last_1h, last_6h, last_24h, all)", timeRange)
	}
}

func (s *Store) AggregateByPIDAndSyscall(since time.Time, pid uint32) ([]AggregateResult, error) {
	var rows *sql.Rows
	var err error

	baseQuery := `
		SELECT
			pid,
			comm,
			syscall,
			COUNT(*) as call_count,
			SUM(duration_ns) as total_duration_ns,
			AVG(duration_ns) as avg_duration_ns,
			MIN(duration_ns) as min_duration_ns,
			MAX(duration_ns) as max_duration_ns
		FROM trace_events
	`

	if since.IsZero() && pid == 0 {
		rows, err = s.db.Query(baseQuery + `
			GROUP BY pid, comm, syscall
			ORDER BY pid, call_count DESC
		`)
	} else if since.IsZero() {
		rows, err = s.db.Query(baseQuery+`
			WHERE pid = ?
			GROUP BY pid, comm, syscall
			ORDER BY call_count DESC
		`, pid)
	} else if pid == 0 {
		rows, err = s.db.Query(baseQuery+`
			WHERE created_at >= ?
			GROUP BY pid, comm, syscall
			ORDER BY pid, call_count DESC
		`, since.Format(time.RFC3339Nano))
	} else {
		rows, err = s.db.Query(baseQuery+`
			WHERE pid = ? AND created_at >= ?
			GROUP BY pid, comm, syscall
			ORDER BY call_count DESC
		`, pid, since.Format(time.RFC3339Nano))
	}

	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []AggregateResult
	for rows.Next() {
		var r AggregateResult
		if err := rows.Scan(
			&r.PID, &r.Comm, &r.Syscall,
			&r.CallCount, &r.TotalDurationNs, &r.AvgDurationNs,
			&r.MinDurationNs, &r.MaxDurationNs,
		); err != nil {
			return nil, err
		}
		results = append(results, r)
	}
	return results, rows.Err()
}

func (s *Store) GenerateFlameGraph(since time.Time, pid uint32) (*FlameGraphNode, error) {
	agg, err := s.AggregateByPIDAndSyscall(since, pid)
	if err != nil {
		return nil, err
	}

	root := &FlameGraphNode{
		Name:  "root",
		Value: 0,
	}

	pidIndex := make(map[uint32]int)
	var totalValue uint64

	for _, r := range agg {
		idx, exists := pidIndex[r.PID]
		if !exists {
			idx = len(root.Children)
			root.Children = append(root.Children, FlameGraphNode{
				Name:  fmt.Sprintf("%s (pid=%d)", r.Comm, r.PID),
				Value: 0,
			})
			pidIndex[r.PID] = idx
		}

		syscallNode := FlameGraphNode{
			Name:  fmt.Sprintf("%s (avg=%dns, count=%d)", r.Syscall, r.AvgDurationNs, r.CallCount),
			Value: r.TotalDurationNs,
		}

		root.Children[idx].Children = append(root.Children[idx].Children, syscallNode)
		root.Children[idx].Value += r.TotalDurationNs
		totalValue += r.TotalDurationNs
	}

	root.Value = totalValue
	return root, nil
}

func scanEvents(rows *sql.Rows) ([]TraceEvent, error) {
	var events []TraceEvent
	for rows.Next() {
		var e TraceEvent
		if err := rows.Scan(
			&e.ID, &e.PID, &e.TID, &e.Comm,
			&e.TimestampNs, &e.DurationNs, &e.Syscall,
			&e.FD, &e.Size, &e.Ret, &e.CreatedAt,
		); err != nil {
			return nil, err
		}
		events = append(events, e)
	}
	return events, rows.Err()
}
