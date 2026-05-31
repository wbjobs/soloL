package minhash

import (
	"encoding/binary"
	"hash/fnv"
	"math"
	"math/rand"
)

const (
	DefaultNumPerm   = 128
	DefaultShingleSize = 3
)

type MinHash struct {
	numPerm    int
	permutations [][2]uint64
	seed       int64
}

func NewMinHash(numPerm int, seed int64) *MinHash {
	if numPerm <= 0 {
		numPerm = DefaultNumPerm
	}

	rand.Seed(seed)
	permutations := make([][2]uint64, numPerm)
	for i := range permutations {
		permutations[i][0] = rand.Uint64() | 1
		permutations[i][1] = rand.Uint64()
	}

	return &MinHash{
		numPerm:      numPerm,
		permutations: permutations,
		seed:         seed,
	}
}

func (mh *MinHash) ComputeSignature(sequence string) []uint64 {
	signature := make([]uint64, mh.numPerm)
	for i := range signature {
		signature[i] = math.MaxUint64
	}

	shingles := generateShingles(sequence, DefaultShingleSize)
	for _, shingle := range shingles {
		hash := fnvHash(shingle)
		for i, perm := range mh.permutations {
			hashed := perm[0]*hash + perm[1]
			if hashed < signature[i] {
				signature[i] = hashed
			}
		}
	}

	return signature
}

func (mh *MinHash) EstimateJaccard(sigA, sigB []uint64) float64 {
	if len(sigA) != len(sigB) {
		return 0.0
	}

	matches := 0
	for i := range sigA {
		if sigA[i] == sigB[i] {
			matches++
		}
	}

	return float64(matches) / float64(len(sigA))
}

func generateShingles(s string, k int) []string {
	if k <= 0 || k > len(s) {
		return []string{s}
	}

	shingles := make([]string, 0, len(s)-k+1)
	for i := 0; i <= len(s)-k; i++ {
		shingles = append(shingles, s[i:i+k])
	}
	return shingles
}

func fnvHash(s string) uint64 {
	h := fnv.New64a()
	h.Write([]byte(s))
	return h.Sum64()
}

func SignatureToBytes(sig []uint64) []byte {
	buf := make([]byte, len(sig)*8)
	for i, v := range sig {
		binary.BigEndian.PutUint64(buf[i*8:], v)
	}
	return buf
}

func BytesToSignature(b []byte) []uint64 {
	sig := make([]uint64, len(b)/8)
	for i := range sig {
		sig[i] = binary.BigEndian.Uint64(b[i*8:])
	}
	return sig
}
