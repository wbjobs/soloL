package smithwaterman

const (
	Match      = 2
	Mismatch   = -1
	GapPenalty = -1
)

type AlignmentResult struct {
	Score              int
	AlignmentLength    int
	IdentityPercentage float64
	AlignedA           string
	AlignedB           string
}

func Align(seqA, seqB string) AlignmentResult {
	m := len(seqA)
	n := len(seqB)

	scoreMatrix := make([][]int, m+1)
	for i := range scoreMatrix {
		scoreMatrix[i] = make([]int, n+1)
	}

	maxScore := 0
	maxI, maxJ := 0, 0

	for i := 1; i <= m; i++ {
		for j := 1; j <= n; j++ {
			matchScore := scoreMatrix[i-1][j-1] + matchOrMismatch(seqA[i-1], seqB[j-1])
			deleteScore := scoreMatrix[i-1][j] + GapPenalty
			insertScore := scoreMatrix[i][j-1] + GapPenalty

			scoreMatrix[i][j] = max(0, matchScore, deleteScore, insertScore)

			if scoreMatrix[i][j] > maxScore {
				maxScore = scoreMatrix[i][j]
				maxI = i
				maxJ = j
			}
		}
	}

	alignedA, alignedB := backtrack(scoreMatrix, seqA, seqB, maxI, maxJ)

	identityCount := 0
	alignLen := len(alignedA)
	for i := 0; i < alignLen; i++ {
		if alignedA[i] == alignedB[i] && alignedA[i] != '-' && alignedB[i] != '-' {
			identityCount++
		}
	}

	identityPercentage := 0.0
	if alignLen > 0 {
		identityPercentage = float64(identityCount) / float64(alignLen) * 100
	}

	return AlignmentResult{
		Score:              maxScore,
		AlignmentLength:    alignLen,
		IdentityPercentage: identityPercentage,
		AlignedA:           alignedA,
		AlignedB:           alignedB,
	}
}

func matchOrMismatch(a, b byte) int {
	if a == b {
		return Match
	}
	return Mismatch
}

func max(nums ...int) int {
	maxVal := nums[0]
	for _, num := range nums[1:] {
		if num > maxVal {
			maxVal = num
		}
	}
	return maxVal
}

func backtrack(scoreMatrix [][]int, seqA, seqB string, i, j int) (string, string) {
	var alignedA, alignedB string

	for i > 0 && j > 0 && scoreMatrix[i][j] > 0 {
		currentScore := scoreMatrix[i][j]
		diagonalScore := scoreMatrix[i-1][j-1]
		upScore := scoreMatrix[i-1][j]
		leftScore := scoreMatrix[i][j-1]

		if currentScore == diagonalScore+matchOrMismatch(seqA[i-1], seqB[j-1]) {
			alignedA = string(seqA[i-1]) + alignedA
			alignedB = string(seqB[j-1]) + alignedB
			i--
			j--
		} else if currentScore == upScore+GapPenalty {
			alignedA = string(seqA[i-1]) + alignedA
			alignedB = "-" + alignedB
			i--
		} else if currentScore == leftScore+GapPenalty {
			alignedA = "-" + alignedA
			alignedB = string(seqB[j-1]) + alignedB
			j--
		} else {
			break
		}
	}

	return alignedA, alignedB
}

func CalculateSimilarity(seqA, seqB string) float64 {
	result := Align(seqA, seqB)
	if result.AlignmentLength == 0 {
		return 0.0
	}
	return result.IdentityPercentage / 100.0
}
