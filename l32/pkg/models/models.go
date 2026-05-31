package models

import (
	"time"

	"github.com/google/uuid"
)

type AlignmentTask struct {
	TaskID          uuid.UUID `json:"task_id"`
	Filename        string    `json:"filename"`
	TotalChunks     int       `json:"total_chunks"`
	CompletedChunks int       `json:"completed_chunks"`
	Status          string    `json:"status"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

type SequenceChunk struct {
	ChunkID       uuid.UUID `json:"chunk_id"`
	TaskID        uuid.UUID `json:"task_id"`
	ChunkIndex    int       `json:"chunk_index"`
	SequenceHeader string   `json:"sequence_header"`
	SequenceData  string    `json:"sequence_data"`
}

type AlignmentTaskMessage struct {
	TaskID   uuid.UUID     `json:"task_id"`
	ChunkA   SequenceChunk `json:"chunk_a"`
	ChunkB   SequenceChunk `json:"chunk_b"`
}

type AlignmentResult struct {
	ID                 int       `json:"id"`
	TaskID             uuid.UUID `json:"task_id"`
	ChunkAHeader       string    `json:"chunk_a_header"`
	ChunkBHeader       string    `json:"chunk_b_header"`
	SimilarityScore    float64   `json:"similarity_score"`
	AlignmentLength    int       `json:"alignment_length"`
	IdentityPercentage float64   `json:"identity_percentage"`
	CreatedAt          time.Time `json:"created_at"`
}

type TaskStatusResponse struct {
	TaskID          uuid.UUID `json:"task_id"`
	Status          string    `json:"status"`
	Progress        float64   `json:"progress"`
	TotalChunks     int       `json:"total_chunks"`
	CompletedChunks int       `json:"completed_chunks"`
}

type TopKRequest struct {
	TaskID uuid.UUID `json:"task_id"`
	K      int       `json:"k"`
}

type FastaSequence struct {
	Header     string
	Sequence   string
}
