package crypto

import (
	"testing"
)

func TestEncryptDecrypt(t *testing.T) {
	key := []byte("01234567890123456789012345678901") // 32 bytes
	plaintext := "my-secret-password-123"

	encrypted, err := Encrypt(plaintext, key)
	if err != nil {
		t.Fatalf("encrypt failed: %v", err)
	}

	if !IsEncrypted(encrypted) {
		t.Error("encrypted value should be marked as encrypted")
	}

	decrypted, err := Decrypt(encrypted, key)
	if err != nil {
		t.Fatalf("decrypt failed: %v", err)
	}

	if decrypted != plaintext {
		t.Errorf("decrypted value mismatch: expected %q, got %q", plaintext, decrypted)
	}
}

func TestEncryptWrongKeySize(t *testing.T) {
	key := []byte("short-key")
	_, err := Encrypt("test", key)
	if err == nil {
		t.Error("expected error for wrong key size")
	}
}

func TestIsSensitiveKey(t *testing.T) {
	tests := []struct {
		key      string
		expected bool
	}{
		{"db_password", true},
		{"api_key", true},
		{"private_key", true},
		{"user_token", true},
		{"app_name", false},
		{"port", false},
		{"database_host", false},
		{"DB_PASSWORD", true},
		{"API-KEY", true},
	}

	for _, tt := range tests {
		if got := IsSensitiveKey(tt.key); got != tt.expected {
			t.Errorf("IsSensitiveKey(%q) = %v, expected %v", tt.key, got, tt.expected)
		}
	}
}

func TestTryDecrypt_NotEncrypted(t *testing.T) {
	value := "plain-text"
	result, decrypted := TryDecrypt(value)
	if decrypted {
		t.Error("should not decrypt plain text")
	}
	if result != value {
		t.Error("should return original value")
	}
}

func TestEncryptIfSensitive(t *testing.T) {
	sensitiveKey := "db_password"
	nonSensitiveKey := "app_name"
	value := "secret123"

	t.Setenv(EncryptionKeyEnvVar, "01234567890123456789012345678901")

	result, encrypted := EncryptIfSensitive(nonSensitiveKey, value)
	if encrypted {
		t.Error("non-sensitive key should not be encrypted")
	}
	if result != value {
		t.Error("non-sensitive key value should be unchanged")
	}

	result, encrypted = EncryptIfSensitive(sensitiveKey, value)
	if !encrypted {
		t.Error("sensitive key should be encrypted")
	}
	if !IsEncrypted(result) {
		t.Error("result should be marked as encrypted")
	}

	decrypted, _ := TryDecrypt(result)
	if decrypted != value {
		t.Errorf("decryption failed: expected %q, got %q", value, decrypted)
	}
}

func TestHasEncryptionKey(t *testing.T) {
	t.Setenv(EncryptionKeyEnvVar, "")
	if HasEncryptionKey() {
		t.Error("should return false when no key set")
	}

	t.Setenv(EncryptionKeyEnvVar, "01234567890123456789012345678901")
	if !HasEncryptionKey() {
		t.Error("should return true when key set")
	}

	t.Setenv(EncryptionKeyEnvVar, "short")
	if HasEncryptionKey() {
		t.Error("should return false for wrong key size")
	}
}
