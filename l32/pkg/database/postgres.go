package database

import (
	"database/sql"
	"fmt"

	_ "github.com/lib/pq"
	"github.com/google/uuid"
	"gene-alignment/pkg/models"
)

type DB struct {
	conn *sql.DB
}

func NewDB(url string) (*DB, error) {
	conn, err := sql.Open("postgres", url)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	if err := conn.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	return &DB{conn: conn}, nil
}

func (db *DB) Close() {
	db.conn.Close()
}

func (db *DB) CreateTask(taskID uuid.UUID, filename string, totalChunks int) error {
	query := `
		INSERT INTO alignment_tasks (task_id, filename, total_chunks, status)
		VALUES ($1, $2, $3, 'processing')
	`
	_, err := db.conn.Exec(query, taskID, filename, totalChunks)
	return err
}

func (db *DB) InsertChunk(chunk models.SequenceChunk) error {
	query := `
		INSERT INTO sequence_chunks (chunk_id, task_id, chunk_index, sequence_header, sequence_data)
		VALUES ($1, $2, $3, $4, $5)
	`
	_, err := db.conn.Exec(query, chunk.ChunkID, chunk.TaskID, chunk.ChunkIndex, chunk.SequenceHeader, chunk.SequenceData)
	return err
}

func (db *DB) InsertResult(result models.AlignmentResult) error {
	query := `
		INSERT INTO alignment_results (task_id, chunk_a_id, chunk_b_id, similarity_score, alignment_length, identity_percentage)
		SELECT $1, sc1.chunk_id, sc2.chunk_id, $2, $3, $4
		FROM sequence_chunks sc1, sequence_chunks sc2
		WHERE sc1.sequence_header = $5 AND sc1.task_id = $1
		  AND sc2.sequence_header = $6 AND sc2.task_id = $1
	`
	_, err := db.conn.Exec(query, result.TaskID, result.SimilarityScore, result.AlignmentLength, result.IdentityPercentage, result.ChunkAHeader, result.ChunkBHeader)
	return err
}

func (db *DB) IncrementCompletedChunks(taskID uuid.UUID) error {
	query := `
		UPDATE alignment_tasks
		SET completed_chunks = completed_chunks + 1,
		    updated_at = CURRENT_TIMESTAMP
		WHERE task_id = $1
	`
	_, err := db.conn.Exec(query, taskID)
	return err
}

func (db *DB) UpdateTaskStatus(taskID uuid.UUID, status string) error {
	query := `
		UPDATE alignment_tasks
		SET status = $2, updated_at = CURRENT_TIMESTAMP
		WHERE task_id = $1
	`
	_, err := db.conn.Exec(query, taskID, status)
	return err
}

func (db *DB) GetTaskStatus(taskID uuid.UUID) (*models.TaskStatusResponse, error) {
	query := `
		SELECT task_id, status, total_chunks, completed_chunks
		FROM alignment_tasks
		WHERE task_id = $1
	`

	var resp models.TaskStatusResponse
	err := db.conn.QueryRow(query, taskID).Scan(&resp.TaskID, &resp.Status, &resp.TotalChunks, &resp.CompletedChunks)
	if err != nil {
		return nil, err
	}

	if resp.TotalChunks > 0 {
		resp.Progress = float64(resp.CompletedChunks) / float64(resp.TotalChunks) * 100
	}

	return &resp, nil
}

func (db *DB) GetTopKResults(taskID uuid.UUID, k int) ([]models.AlignmentResult, error) {
	query := `
		SELECT ar.id, ar.task_id, sc1.sequence_header, sc2.sequence_header, 
		       ar.similarity_score, ar.alignment_length, ar.identity_percentage, ar.created_at
		FROM alignment_results ar
		JOIN sequence_chunks sc1 ON ar.chunk_a_id = sc1.chunk_id
		JOIN sequence_chunks sc2 ON ar.chunk_b_id = sc2.chunk_id
		WHERE ar.task_id = $1
		ORDER BY ar.similarity_score DESC
		LIMIT $2
	`

	rows, err := db.conn.Query(query, taskID, k)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []models.AlignmentResult
	for rows.Next() {
		var r models.AlignmentResult
		err := rows.Scan(&r.ID, &r.TaskID, &r.ChunkAHeader, &r.ChunkBHeader,
			&r.SimilarityScore, &r.AlignmentLength, &r.IdentityPercentage, &r.CreatedAt)
		if err != nil {
			return nil, err
		}
		results = append(results, r)
	}

	return results, nil
}

func (db *DB) CheckAndFinalizeTask(taskID uuid.UUID) error {
	query := `
		SELECT total_chunks, completed_chunks
		FROM alignment_tasks
		WHERE task_id = $1
	`

	var total, completed int
	err := db.conn.QueryRow(query, taskID).Scan(&total, &completed)
	if err != nil {
		return err
	}

	if completed >= total {
		return db.UpdateTaskStatus(taskID, "completed")
	}

	return nil
}
