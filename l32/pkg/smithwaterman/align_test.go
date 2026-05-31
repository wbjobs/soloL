package smithwaterman

import "testing"

func TestAlign(t *testing.T) {
	tests := []struct {
		name     string
		seqA     string
		seqB     string
		minScore int
	}{
		{
			name:     "identical sequences",
			seqA:     "GGTTGACTA",
			seqB:     "GGTTGACTA",
			minScore: 18,
		},
		{
			name:     "similar sequences",
			seqA:     "GGTTGACTA",
			seqB:     "GGTTGGCTA",
			minScore: 14,
		},
		{
			name:     "different sequences",
			seqA:     "AAAAAAAAA",
			seqB:     "GGTTGACTA",
			minScore: 0,
		},
		{
			name:     "empty sequence",
			seqA:     "",
			seqB:     "GGTTGACTA",
			minScore: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := Align(tt.seqA, tt.seqB)
			if result.Score < tt.minScore {
				t.Errorf("Expected score >= %d, got %d", tt.minScore, result.Score)
			}
		})
	}
}

func TestCalculateSimilarity(t *testing.T) {
	seqA := "GGTTGACTA"
	seqB := "GGTTGACTA"

	similarity := CalculateSimilarity(seqA, seqB)
	if similarity != 1.0 {
		t.Errorf("Expected similarity 1.0 for identical sequences, got %f", similarity)
	}
}
