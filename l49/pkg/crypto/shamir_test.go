package crypto

import (
	"bytes"
	"testing"
)

func TestShamirSplitAndCombine(t *testing.T) {
	shamir := NewShamir()
	secret := []byte("test-secret-key-1234567890")

	shares, err := shamir.Split(secret, 5, 3)
	if err != nil {
		t.Fatalf("Failed to split secret: %v", err)
	}

	if len(shares) != 5 {
		t.Errorf("Expected 5 shares, got %d", len(shares))
	}

	for i, share := range shares {
		if share.X != byte(i+1) {
			t.Errorf("Share %d: expected X=%d, got %d", i, i+1, share.X)
		}
		if len(share.Y) != len(secret) {
			t.Errorf("Share %d: expected Y length %d, got %d", i, len(secret), len(share.Y))
		}
	}

	reconstructed, err := shamir.Combine(shares[:3])
	if err != nil {
		t.Fatalf("Failed to combine shares: %v", err)
	}

	if !bytes.Equal(reconstructed, secret) {
		t.Errorf("Reconstructed secret mismatch. Expected %x, got %x", secret, reconstructed)
	}

	reconstructed2, err := shamir.Combine(shares[2:])
	if err != nil {
		t.Fatalf("Failed to combine shares 3-5: %v", err)
	}

	if !bytes.Equal(reconstructed2, secret) {
		t.Errorf("Reconstructed secret (shares 3-5) mismatch")
	}

	_, err = shamir.Combine(shares[:2])
	if err != nil {
		t.Logf("Expected error with only 2 shares: %v", err)
	}
}

func TestShamirDifferentSecrets(t *testing.T) {
	shamir := NewShamir()

	testCases := [][]byte{
		[]byte("a"),
		[]byte("short"),
		[]byte("this-is-a-much-longer-secret-key-for-testing"),
		make([]byte, 64),
	}

	for i, secret := range testCases {
		shares, err := shamir.Split(secret, 5, 3)
		if err != nil {
			t.Fatalf("Case %d: Failed to split: %v", i, err)
		}

		reconstructed, err := shamir.Combine(shares[1:4])
		if err != nil {
			t.Fatalf("Case %d: Failed to combine: %v", i, err)
		}

		if !bytes.Equal(reconstructed, secret) {
			t.Errorf("Case %d: Secret mismatch", i)
		}
	}
}

func TestKeyShardManager(t *testing.T) {
	manager := NewKeyShardManager(5, 3)

	if manager.GetNumShares() != 5 {
		t.Errorf("Expected 5 shares, got %d", manager.GetNumShares())
	}
	if manager.GetThreshold() != 3 {
		t.Errorf("Expected threshold 3, got %d", manager.GetThreshold())
	}

	keyID := "test-key-1"
	key := []byte("my-super-secret-key")

	err := manager.SplitAndStoreKey(keyID, key)
	if err != nil {
		t.Fatalf("Failed to split and store: %v", err)
	}

	if !manager.HasKey(keyID) {
		t.Error("Key should exist")
	}

	share0, err := manager.GetShare(keyID, 0)
	if err != nil {
		t.Fatalf("Failed to get share 0: %v", err)
	}
	if share0.X != 1 {
		t.Errorf("Share 0 X should be 1, got %d", share0.X)
	}

	reconstructed, err := manager.ReconstructKey(keyID, []int{0, 2, 4})
	if err != nil {
		t.Fatalf("Failed to reconstruct: %v", err)
	}

	if !bytes.Equal(reconstructed, key) {
		t.Error("Reconstructed key mismatch")
	}

	_, err = manager.ReconstructKey(keyID, []int{0, 1})
	if err == nil {
		t.Error("Should fail with only 2 shares")
	}

	manager.DeleteKey(keyID)
	if manager.HasKey(keyID) {
		t.Error("Key should be deleted")
	}
}

func TestShamirEdgeCases(t *testing.T) {
	shamir := NewShamir()

	_, err := shamir.Split([]byte("test"), 5, 1)
	if err == nil {
		t.Error("Should fail with threshold < 2")
	}

	_, err = shamir.Split([]byte("test"), 2, 3)
	if err == nil {
		t.Error("Should fail with threshold > numShares")
	}

	_, err = shamir.Split(nil, 5, 3)
	if err == nil {
		t.Error("Should fail with empty secret")
	}

	_, err = shamir.Combine(nil)
	if err == nil {
		t.Error("Should fail with no shares")
	}
}
