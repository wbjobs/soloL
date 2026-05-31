package crypto

import (
	"crypto/rand"
	"errors"
)

type ShamirShare struct {
	X byte
	Y []byte
}

type Shamir struct {
	logTable [256]byte
	expTable [256]byte
}

func NewShamir() *Shamir {
	s := &Shamir{}
	s.initTables()
	return s
}

func (s *Shamir) initTables() {
	primitive := 0x11D
	x := 1
	for i := 0; i < 255; i++ {
		s.expTable[i] = byte(x)
		s.logTable[x] = byte(i)
		x <<= 1
		if x&0x100 != 0 {
			x ^= primitive
		}
	}
	s.expTable[255] = s.expTable[0]
}

func (s *Shamir) gfAdd(a, b byte) byte {
	return a ^ b
}

func (s *Shamir) gfMul(a, b byte) byte {
	if a == 0 || b == 0 {
		return 0
	}
	logA := int(s.logTable[a])
	logB := int(s.logTable[b])
	return s.expTable[(logA+logB)%255]
}

func (s *Shamir) gfDiv(a, b byte) byte {
	if b == 0 {
		panic("divide by zero")
	}
	if a == 0 {
		return 0
	}
	logA := int(s.logTable[a])
	logB := int(s.logTable[b])
	return s.expTable[(logA-logB+255)%255]
}

func (s *Shamir) Split(secret []byte, numShares, threshold int) ([]*ShamirShare, error) {
	if threshold < 2 {
		return nil, errors.New("threshold must be at least 2")
	}
	if numShares < threshold {
		return nil, errors.New("numShares must be >= threshold")
	}
	if numShares > 255 {
		return nil, errors.New("numShares must be <= 255")
	}
	if len(secret) == 0 {
		return nil, errors.New("secret cannot be empty")
	}

	shares := make([]*ShamirShare, numShares)
	for i := 0; i < numShares; i++ {
		shares[i] = &ShamirShare{
			X: byte(i + 1),
			Y: make([]byte, len(secret)),
		}
	}

	for b := 0; b < len(secret); b++ {
		coeffs := make([]byte, threshold)
		coeffs[0] = secret[b]
		for i := 1; i < threshold; i++ {
			randBytes := make([]byte, 1)
			rand.Read(randBytes)
			coeffs[i] = randBytes[0]
		}

		for i := 0; i < numShares; i++ {
			x := byte(i + 1)
			y := s.evalPoly(coeffs, x)
			shares[i].Y[b] = y
		}
	}

	return shares, nil
}

func (s *Shamir) evalPoly(coeffs []byte, x byte) byte {
	result := coeffs[len(coeffs)-1]
	for i := len(coeffs) - 2; i >= 0; i-- {
		result = s.gfAdd(s.gfMul(result, x), coeffs[i])
	}
	return result
}

func (s *Shamir) Combine(shares []*ShamirShare) ([]byte, error) {
	if len(shares) == 0 {
		return nil, errors.New("no shares provided")
	}

	secretLen := len(shares[0].Y)
	for _, share := range shares {
		if len(share.Y) != secretLen {
			return nil, errors.New("shares have inconsistent lengths")
		}
	}

	secret := make([]byte, secretLen)
	for b := 0; b < secretLen; b++ {
		points := make(map[byte]byte)
		for _, share := range shares {
			points[share.X] = share.Y[b]
		}
		secret[b] = s.lagrangeInterpolation(points, 0)
	}

	return secret, nil
}

func (s *Shamir) lagrangeInterpolation(points map[byte]byte, x byte) byte {
	result := byte(0)
	for xi, yi := range points {
		numerator := byte(1)
		denominator := byte(1)
		for xj := range points {
			if xi != xj {
				numerator = s.gfMul(numerator, s.gfAdd(x, xj))
				denominator = s.gfMul(denominator, s.gfAdd(xi, xj))
			}
		}
		term := s.gfMul(yi, s.gfDiv(numerator, denominator))
		result = s.gfAdd(result, term)
	}
	return result
}

type KeyShardManager struct {
	shamir     *Shamir
	numShares  int
	threshold  int
	shardStore map[string][]*ShamirShare
}

func NewKeyShardManager(numShares, threshold int) *KeyShardManager {
	if numShares < 3 {
		numShares = 5
	}
	if threshold < 2 {
		threshold = 3
	}
	if threshold > numShares {
		threshold = numShares
	}
	return &KeyShardManager{
		shamir:     NewShamir(),
		numShares:  numShares,
		threshold:  threshold,
		shardStore: make(map[string][]*ShamirShare),
	}
}

func (m *KeyShardManager) SplitAndStoreKey(keyID string, key []byte) error {
	shares, err := m.shamir.Split(key, m.numShares, m.threshold)
	if err != nil {
		return err
	}
	m.shardStore[keyID] = shares
	return nil
}

func (m *KeyShardManager) ReconstructKey(keyID string, shareIndices []int) ([]byte, error) {
	allShares, exists := m.shardStore[keyID]
	if !exists {
		return nil, errors.New("key not found")
	}

	if len(shareIndices) < m.threshold {
		return nil, errors.New("insufficient shares")
	}

	shares := make([]*ShamirShare, len(shareIndices))
	for i, idx := range shareIndices {
		if idx < 0 || idx >= len(allShares) {
			return nil, errors.New("invalid share index")
		}
		shares[i] = allShares[idx]
	}

	return m.shamir.Combine(shares)
}

func (m *KeyShardManager) GetShare(keyID string, index int) (*ShamirShare, error) {
	shares, exists := m.shardStore[keyID]
	if !exists {
		return nil, errors.New("key not found")
	}
	if index < 0 || index >= len(shares) {
		return nil, errors.New("invalid share index")
	}
	return shares[index], nil
}

func (m *KeyShardManager) DeleteKey(keyID string) {
	delete(m.shardStore, keyID)
}

func (m *KeyShardManager) HasKey(keyID string) bool {
	_, exists := m.shardStore[keyID]
	return exists
}

func (m *KeyShardManager) GetThreshold() int {
	return m.threshold
}

func (m *KeyShardManager) GetNumShares() int {
	return m.numShares
}
func (m *KeyShardManager) GetThreshold() int {
	return m.threshold
}

func (m *KeyShardManager) GetNumShares() int {
	return m