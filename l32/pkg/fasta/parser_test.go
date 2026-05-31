package fasta

import (
	"strings"
	"testing"

	"github.com/google/uuid"
	"gene-alignment/pkg/models"
)

func TestParseReader(t *testing.T) {
	fastaContent := `>seq1 description
AGCTAGCTAGCT
>seq2 another sequence
TTAGCTAGCTAG
`

	sequences, err := ParseReader(strings.NewReader(fastaContent))
	if err != nil {
		t.Fatalf("Failed to parse: %v", err)
	}

	if len(sequences) != 2 {
		t.Errorf("Expected 2 sequences, got %d", len(sequences))
	}

	if sequences[0].Header != "seq1 description" {
		t.Errorf("Expected header 'seq1 description', got '%s'", sequences[0].Header)
	}

	if sequences[0].Sequence != "AGCTAGCTAGCT" {
		t.Errorf("Expected sequence 'AGCTAGCTAGCT', got '%s'", sequences[0].Sequence)
	}
}

func TestChunkSequence(t *testing.T) {
	seq := models.FastaSequence{
		Header:   "test",
		Sequence: "AGCTAGCTAGCTAGCTAGCT",
	}

	taskID := uuid.New()
	chunks := ChunkSequence(seq, 10, taskID, 0)

	if len(chunks) != 2 {
		t.Errorf("Expected 2 chunks, got %d", len(chunks))
	}

	if len(chunks[0].SequenceData) != 10 {
		t.Errorf("Expected chunk 0 length 10, got %d", len(chunks[0].SequenceData))
	}

	if len(chunks[1].SequenceData) != 10 {
		t.Errorf("Expected chunk 1 length 10, got %d", len(chunks[1].SequenceData))
	}
}
