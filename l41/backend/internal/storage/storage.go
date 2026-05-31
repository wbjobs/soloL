package storage

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	_ "github.com/lib/pq"
)

type Fingerprint struct {
	ID          string            `json:"id"`
	Data        []byte            `json:"data"`
	Filename    string            `json:"filename"`
	DurationMs  int64             `json:"duration_ms"`
	FileHash    string            `json:"file_hash"`
	Metadata    map[string]string `json:"metadata"`
	CreatedAt   time.Time         `json:"created_at"`
}

type MatchResult struct {
	ID         string
	Filename   string
	Distance   int
	Similarity float64
	Metadata   map[string]string
}

type Storage interface {
	Store(ctx context.Context, fp *Fingerprint) (string, error)
	Query(ctx context.Context, fingerprint []byte, maxResults int, threshold int) ([]MatchResult, error)
	BatchQuery(ctx context.Context, fingerprints [][]byte, maxResults int, threshold int) ([][]MatchResult, error)
	Get(ctx context.Context, id string) (*Fingerprint, error)
	Delete(ctx context.Context, id string) error
	List(ctx context.Context, page, pageSize int) ([]Fingerprint, int, error)
	Close() error
}

type PostgresStorage struct {
	db *sql.DB
}

func NewPostgresStorage(host, port, user, password, dbname string) (*PostgresStorage, error) {
	connStr := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		host, port, user, password, dbname)

	db, err := sql.Open("postgres", connStr)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	_, err = db.ExecContext(context.Background(), `SET statement_timeout = '120000'`)
	if err != nil {
		return nil, fmt.Errorf("failed to set statement timeout: %w", err)
	}

	return &PostgresStorage{db: db}, nil
}

func (s *PostgresStorage) Store(ctx context.Context, fp *Fingerprint) (string, error) {
	if fp.FileHash == "" {
		fp.FileHash = calculateFileHash(fp.Data)
	}

	metadataJSON, err := json.Marshal(fp.Metadata)
	if err != nil {
		metadataJSON = []byte("{}")
	}

	storeCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	var id string
	err = s.db.QueryRowContext(storeCtx, `
		INSERT INTO fingerprints (fingerprint_data, filename, duration_ms, file_hash, metadata)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id
	`, fp.Data, fp.Filename, fp.DurationMs, fp.FileHash, metadataJSON).Scan(&id)

	if err != nil {
		return "", fmt.Errorf("failed to store fingerprint: %w", err)
	}

	return id, nil
}

func (s *PostgresStorage) Query(ctx context.Context, fingerprint []byte, maxResults int, threshold int) ([]MatchResult, error) {
	if maxResults <= 0 {
		maxResults = 10
	}
	if threshold <= 0 {
		threshold = 32
	}

	queryCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	rows, err := s.db.QueryContext(queryCtx, `
		SELECT id, filename, distance, similarity
		FROM find_similar_fingerprints($1, $2, $3)
	`, fingerprint, maxResults, threshold)

	if err != nil {
		return nil, fmt.Errorf("failed to query fingerprints: %w", err)
	}
	defer rows.Close()

	var results []MatchResult
	for rows.Next() {
		var r MatchResult
		err := rows.Scan(&r.ID, &r.Filename, &r.Distance, &r.Similarity)
		if err != nil {
			return nil, fmt.Errorf("failed to scan result: %w", err)
		}
		results = append(results, r)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows error: %w", err)
	}

	return results, nil
}

func (s *PostgresStorage) Get(ctx context.Context, id string) (*Fingerprint, error) {
	var fp Fingerprint
	var metadataJSON []byte

	err := s.db.QueryRowContext(ctx, `
		SELECT id, fingerprint_data, filename, duration_ms, file_hash, metadata, created_at
		FROM fingerprints WHERE id = $1
	`, id).Scan(&fp.ID, &fp.Data, &fp.Filename, &fp.DurationMs, &fp.FileHash, &metadataJSON, &fp.CreatedAt)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("fingerprint not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get fingerprint: %w", err)
	}

	if len(metadataJSON) > 0 {
		if err := json.Unmarshal(metadataJSON, &fp.Metadata); err != nil {
			fp.Metadata = make(map[string]string)
		}
	} else {
		fp.Metadata = make(map[string]string)
	}

	return &fp, nil
}

func (s *PostgresStorage) Delete(ctx context.Context, id string) error {
	result, err := s.db.ExecContext(ctx, `DELETE FROM fingerprints WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("failed to delete fingerprint: %w", err)
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		return fmt.Errorf("fingerprint not found")
	}

	return nil
}

func (s *PostgresStorage) List(ctx context.Context, page, pageSize int) ([]Fingerprint, int, error) {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 20
	}

	offset := (page - 1) * pageSize

	var totalCount int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM fingerprints`).Scan(&totalCount)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to count: %w", err)
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT id, filename, duration_ms, created_at
		FROM fingerprints
		ORDER BY created_at DESC
		LIMIT $1 OFFSET $2
	`, pageSize, offset)

	if err != nil {
		return nil, 0, fmt.Errorf("failed to list: %w", err)
	}
	defer rows.Close()

	var fps []Fingerprint
	for rows.Next() {
		var fp Fingerprint
		err := rows.Scan(&fp.ID, &fp.Filename, &fp.DurationMs, &fp.CreatedAt)
		if err != nil {
			return nil, 0, fmt.Errorf("failed to scan: %w", err)
		}
		fps = append(fps, fp)
	}

	return fps, totalCount, nil
}

func (s *PostgresStorage) Close() error {
	return s.db.Close()
}

func (s *PostgresStorage) BatchQuery(ctx context.Context, fingerprints [][]byte, maxResults int, threshold int) ([][]MatchResult, error) {
	if maxResults <= 0 {
		maxResults = 10
	}
	if threshold <= 0 {
		threshold = 32
	}

	if len(fingerprints) <= 5 {
		return s.batchQueryDB(ctx, fingerprints, maxResults, threshold)
	}

	return s.batchQueryConcurrent(ctx, fingerprints, maxResults, threshold)
}

func (s *PostgresStorage) batchQueryDB(ctx context.Context, fingerprints [][]byte, maxResults int, threshold int) ([][]MatchResult, error) {
	queryCtx, cancel := context.WithTimeout(ctx, 120*time.Second)
	defer cancel()

	pgArray := fmt.Sprintf("ARRAY[")
	for i, fp := range fingerprints {
		if i > 0 {
			pgArray += ","
		}
		pgArray += fmt.Sprintf("\\x%x", fp)
	}
	pgArray += "]::BYTEA[]"

	query := fmt.Sprintf(`
		SELECT query_index, id, filename, distance, similarity
		FROM batch_find_similar_fingerprints(%s, %d, %d)
	`, pgArray, maxResults, threshold)

	rows, err := s.db.QueryContext(queryCtx, query)
	if err != nil {
		return s.batchQueryConcurrent(ctx, fingerprints, maxResults, threshold)
	}
	defer rows.Close()

	resultMap := make(map[int][]MatchResult)
	for rows.Next() {
		var queryIndex int
		var r MatchResult
		err := rows.Scan(&queryIndex, &r.ID, &r.Filename, &r.Distance, &r.Similarity)
		if err != nil {
			continue
		}
		resultMap[queryIndex-1] = append(resultMap[queryIndex-1], r)
	}

	results := make([][]MatchResult, len(fingerprints))
	for i := range fingerprints {
		results[i] = resultMap[i]
		if results[i] == nil {
			results[i] = []MatchResult{}
		}
	}

	return results, nil
}

func (s *PostgresStorage) batchQueryConcurrent(ctx context.Context, fingerprints [][]byte, maxResults int, threshold int) ([][]MatchResult, error) {
	results := make([][]MatchResult, len(fingerprints))
	var mu sync.Mutex
	var wg sync.WaitGroup

	sem := make(chan struct{}, 10)

	for i, fp := range fingerprints {
		wg.Add(1)
		sem <- struct{}{}

		go func(idx int, fingerprint []byte) {
			defer wg.Done()
			defer func() { <-sem }()

			matches, err := s.Query(ctx, fingerprint, maxResults, threshold)
			mu.Lock()
			if err != nil {
				results[idx] = []MatchResult{}
			} else {
				results[idx] = matches
			}
			mu.Unlock()
		}(i, fp)
	}

	wg.Wait()
	return results, nil
}

func calculateFileHash(data []byte) string {
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}
