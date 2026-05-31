package crypto

import (
	"encoding/binary"
	"errors"
	"sync"
)

const (
	sboxSize = 256
	typeTagSize = 1
)

type DataType byte

const (
	TypeString DataType = iota
	TypeInt64
	TypeFloat64
	TypeBool
	TypeBytes
)

type RC4State struct {
	sbox [sboxSize]byte
	i    byte
	j    byte
}

type RC4Key struct {
	ID        string
	Version   int
	KeyBytes  []byte
	CreatedAt int64
	Active    bool
}

type RC4Engine struct {
	mu            sync.RWMutex
	activeKeys    map[int]*RC4Key
	latestVersion int
	maxVersions   int
	rotationMu    sync.RWMutex
	rotating      bool
}

func NewRC4State(key []byte) *RC4State {
	state := &RC4State{}
	state.ksa(key)
	state.i = 0
	state.j = 0
	return state
}

func (s *RC4State) ksa(key []byte) {
	for i := 0; i < sboxSize; i++ {
		s.sbox[i] = byte(i)
	}

	j := byte(0)
	keyLen := len(key)
	for i := 0; i < sboxSize; i++ {
		j = j + s.sbox[i] + key[i%keyLen]
		s.sbox[i], s.sbox[j] = s.sbox[j], s.sbox[i]
	}
}

func (s *RC4State) prga(output []byte) {
	for k := 0; k < len(output); k++ {
		s.i++
		s.j += s.sbox[s.i]
		s.sbox[s.i], s.sbox[s.j] = s.sbox[s.j], s.sbox[s.i]
		output[k] = s.sbox[s.sbox[s.i]+s.sbox[s.j]]
	}
}

func (s *RC4State) reset() {
	s.i = 0
	s.j = 0
}

func (s *RC4State) xorStream(data []byte) []byte {
	s.reset()
	keystream := make([]byte, len(data))
	s.prga(keystream)

	result := make([]byte, len(data))
	for i := range data {
		result[i] = data[i] ^ keystream[i]
	}

	return result
}

func NewRC4Engine(maxVersions int) *RC4Engine {
	if maxVersions <= 0 {
		maxVersions = 3
	}
	return &RC4Engine{
		activeKeys:    make(map[int]*RC4Key),
		latestVersion: 0,
		maxVersions:   maxVersions,
		rotating:      false,
	}
}

func (e *RC4Engine) AddKey(keyID string, version int, keyBytes []byte) error {
	if len(keyBytes) < 5 || len(keyBytes) > 256 {
		return errors.New("RC4 key length must be between 5 and 256 bytes")
	}

	e.mu.Lock()
	defer e.mu.Unlock()

	if len(e.activeKeys) >= e.maxVersions {
		var oldestVersion int = e.latestVersion
		for v := range e.activeKeys {
			if v < oldestVersion {
				oldestVersion = v
			}
		}
		delete(e.activeKeys, oldestVersion)
	}

	e.activeKeys[version] = &RC4Key{
		ID:        keyID,
		Version:   version,
		KeyBytes:  append([]byte(nil), keyBytes...),
		Active:    true,
	}

	if version > e.latestVersion {
		e.latestVersion = version
	}

	return nil
}

func (e *RC4Engine) GetLatestVersion() int {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.latestVersion
}

func (e *RC4Engine) getState(version int) (*RC4State, error) {
	e.mu.RLock()
	key, exists := e.activeKeys[version]
	e.mu.RUnlock()

	if !exists {
		return nil, errors.New("key version not found")
	}

	return NewRC4State(key.KeyBytes), nil
}

func (e *RC4Engine) Encrypt(plaintext []byte, version int) ([]byte, error) {
	state, err := e.getState(version)
	if err != nil {
		return nil, err
	}

	ciphertext := make([]byte, len(plaintext)+4)
	binary.BigEndian.PutUint32(ciphertext[:4], uint32(version))

	encrypted := state.xorStream(plaintext)
	copy(ciphertext[4:], encrypted)

	return ciphertext, nil
}

func (e *RC4Engine) EncryptLatest(plaintext []byte) ([]byte, error) {
	e.rotationMu.RLock()
	rotating := e.rotating
	e.rotationMu.RUnlock()

	e.mu.RLock()
	latest := e.latestVersion
	prevVersion := latest - 1
	_, hasPrev := e.activeKeys[prevVersion]
	e.mu.RUnlock()

	if rotating && hasPrev {
		_, err := e.Encrypt(plaintext, prevVersion)
		if err != nil {
			return nil, err
		}
	}

	return e.Encrypt(plaintext, latest)
}

func (e *RC4Engine) Decrypt(ciphertext []byte) ([]byte, error) {
	if len(ciphertext) < 4 {
		return nil, errors.New("invalid ciphertext length")
	}

	version := int(binary.BigEndian.Uint32(ciphertext[:4]))

	state, err := e.getState(version)
	if err != nil {
		e.mu.RLock()
		latest := e.latestVersion
		e.mu.RUnlock()

		if version > latest {
			return nil, errors.New("data encrypted with newer key version, please update keys")
		}
		return nil, err
	}

	decrypted := state.xorStream(ciphertext[4:])
	return decrypted, nil
}

func (e *RC4Engine) GetActiveVersions() []int {
	e.mu.RLock()
	defer e.mu.RUnlock()

	versions := make([]int, 0, len(e.activeKeys))
	for v := range e.activeKeys {
		versions = append(versions, v)
	}
	return versions
}

func (e *RC4Engine) StartRotation() {
	e.rotationMu.Lock()
	defer e.rotationMu.Unlock()
	e.rotating = true
}

func (e *RC4Engine) CompleteRotation() {
	e.rotationMu.Lock()
	defer e.rotationMu.Unlock()
	e.rotating = false
}

func (e *RC4Engine) IsRotating() bool {
	e.rotationMu.RLock()
	defer e.rotationMu.RUnlock()
	return e.rotating
}

func (e *RC4Engine) RotateKey(newKeyID string, newKeyBytes []byte) (int, error) {
	e.StartRotation()
	defer e.CompleteRotation()

	e.mu.RLock()
	newVersion := e.latestVersion + 1
	e.mu.RUnlock()

	err := e.AddKey(newKeyID, newVersion, newKeyBytes)
	if err != nil {
		return 0, err
	}

	return newVersion, nil
}

func (e *RC4Engine) RemoveKey(version int) bool {
	e.mu.Lock()
	defer e.mu.Unlock()

	if _, exists := e.activeKeys[version]; !exists {
		return false
	}

	delete(e.activeKeys, version)

	if version == e.latestVersion {
		e.latestVersion = 0
		for v := range e.activeKeys {
			if v > e.latestVersion {
				e.latestVersion = v
			}
		}
	}

	return true
}

func (e *RC4Engine) ReEncryptWithNewVersion(ciphertext []byte, newVersion int) ([]byte, error) {
	plaintext, err := e.Decrypt(ciphertext)
	if err != nil {
		return nil, err
	}

	return e.Encrypt(plaintext, newVersion)
}
