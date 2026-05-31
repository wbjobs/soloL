package fasta

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/google/uuid"
	"gene-alignment/pkg/models"
)

func ParseFile(filePath string) ([]models.FastaSequence, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to open file: %w", err)
	}
	defer file.Close()

	return ParseReader(file)
}

func ParseReader(r io.Reader) ([]models.FastaSequence, error) {
	var sequences []models.FastaSequence
	var currentSeq *models.FastaSequence

	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024)

	for scanner.Scan() {
		line := scanner.Text()
		line = strings.TrimSpace(line)

		if line == "" {
			continue
		}

		if strings.HasPrefix(line, ">") {
			if currentSeq != nil {
				sequences = append(sequences, *currentSeq)
			}
			header := strings.TrimPrefix(line, ">")
			currentSeq = &models.FastaSequence{
				Header:   header,
				Sequence: "",
			}
		} else {
			if currentSeq == nil {
				return nil, fmt.Errorf("invalid FASTA format: sequence data before header")
			}
			currentSeq.Sequence += strings.ToUpper(line)
		}
	}

	if currentSeq != nil {
		sequences = append(sequences, *currentSeq)
	}

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("scanner error: %w", err)
	}

	return sequences, nil
}

func ChunkSequence(seq models.FastaSequence, chunkSize int, taskID uuid.UUID, startIndex int) []models.SequenceChunk {
	var chunks []models.SequenceChunk
	seqLen := len(seq.Sequence)

	if seqLen <= chunkSize {
		chunks = append(chunks, models.SequenceChunk{
			ChunkID:        uuid.New(),
			TaskID:         taskID,
			ChunkIndex:     startIndex,
			SequenceHeader: seq.Header,
			SequenceData:   seq.Sequence,
		})
		return chunks
	}

	chunkIndex := startIndex
	for i := 0; i < seqLen; i += chunkSize {
		end := i + chunkSize
		if end > seqLen {
			end = seqLen
		}

		chunks = append(chunks, models.SequenceChunk{
			ChunkID:        uuid.New(),
			TaskID:         taskID,
			ChunkIndex:     chunkIndex,
			SequenceHeader: fmt.Sprintf("%s_chunk_%d", seq.Header, chunkIndex-startIndex),
			SequenceData:   seq.Sequence[i:end],
		})
		chunkIndex++
	}

	return chunks
}

func ProcessFile(filePath string, chunkSize int, taskID uuid.UUID) ([]models.SequenceChunk, error) {
	sequences, err := ParseFile(filePath)
	if err != nil {
		return nil, err
	}

	var allChunks []models.SequenceChunk
	chunkIndex := 0

	for _, seq := range sequences {
		chunks := ChunkSequence(seq, chunkSize, taskID, chunkIndex)
		allChunks = append(allChunks, chunks...)
		chunkIndex += len(chunks)
	}

	return allChunks, nil
}
