package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
)

const (
	EncryptionKeyEnvVar = "ETCD_CONFIG_ENCRYPTION_KEY"
	encryptedPrefix     = "ENC[AES256_GCM]:"
)

var sensitivePatterns = []string{
	"password",
	"passwd",
	"pwd",
	"secret",
	"token",
	"api_key",
	"apikey",
	"private_key",
	"privatekey",
	"cert",
	"key",
	"credential",
	"auth",
}

func GetEncryptionKey() ([]byte, error) {
	key := os.Getenv(EncryptionKeyEnvVar)
	if key == "" {
		return nil, fmt.Errorf("environment variable %s not set", EncryptionKeyEnvVar)
	}

	keyBytes := []byte(key)
	if len(keyBytes) != 32 {
		return nil, fmt.Errorf("encryption key must be 32 bytes (AES-256), got %d bytes", len(keyBytes))
	}

	return keyBytes, nil
}

func HasEncryptionKey() bool {
	key := os.Getenv(EncryptionKeyEnvVar)
	return key != "" && len(key) == 32
}

func Encrypt(plaintext string, key []byte) (string, error) {
	if len(key) != 32 {
		return "", fmt.Errorf("key must be 32 bytes for AES-256")
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}

	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	encoded := base64.StdEncoding.EncodeToString(ciphertext)
	return encryptedPrefix + encoded, nil
}

func Decrypt(encrypted string, key []byte) (string, error) {
	if !strings.HasPrefix(encrypted, encryptedPrefix) {
		return "", errors.New("not an encrypted value")
	}

	encoded := strings.TrimPrefix(encrypted, encryptedPrefix)
	ciphertext, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", err
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonceSize := gcm.NonceSize()
	if len(ciphertext) < nonceSize {
		return "", errors.New("ciphertext too short")
	}

	nonce, ciphertext := ciphertext[:nonceSize], ciphertext[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", err
	}

	return string(plaintext), nil
}

func TryDecrypt(value string) (string, bool) {
	if !strings.HasPrefix(value, encryptedPrefix) {
		return value, false
	}

	key, err := GetEncryptionKey()
	if err != nil {
		return value, false
	}

	decrypted, err := Decrypt(value, key)
	if err != nil {
		return value, false
	}

	return decrypted, true
}

func IsEncrypted(value string) bool {
	return strings.HasPrefix(value, encryptedPrefix)
}

func IsSensitiveKey(key string) bool {
	keyLower := strings.ToLower(key)
	for _, pattern := range sensitivePatterns {
		if strings.Contains(keyLower, pattern) {
			return true
		}
	}
	return false
}

func EncryptIfSensitive(key, value string) (string, bool) {
	if !IsSensitiveKey(key) {
		return value, false
	}

	keyBytes, err := GetEncryptionKey()
	if err != nil {
		return value, false
	}

	encrypted, err := Encrypt(value, keyBytes)
	if err != nil {
		return value, false
	}

	return encrypted, true
}
