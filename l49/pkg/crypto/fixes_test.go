package crypto

import (
	"bytes"
	"testing"
)

func TestRC4KSA_PRGA(t *testing.T) {
	key := []byte("SecretKey")
	
	state := NewRC4State(key)
	
	if state.i != 0 || state.j != 0 {
		t.Error("Initial state should have i=0, j=0")
	}
	
	expectedSBox := [256]byte{}
	for i := range expectedSBox {
		expectedSBox[i] = byte(i)
	}
	
	j := byte(0)
	keyLen := len(key)
	for i := 0; i < 256; i++ {
		j = j + expectedSBox[i] + key[i%keyLen]
		expectedSBox[i], expectedSBox[j] = expectedSBox[j], expectedSBox[i]
	}
	
	if state.sbox != expectedSBox {
		t.Error("KSA did not produce expected S-box")
	}
	
	plaintext := []byte("Plaintext")
	encrypted := state.xorStream(plaintext)
	
	if bytes.Equal(encrypted, plaintext) {
		t.Error("Encryption should change the plaintext")
	}
	
	state2 := NewRC4State(key)
	decrypted := state2.xorStream(encrypted)
	
	if !bytes.Equal(decrypted, plaintext) {
		t.Errorf("Decryption failed: got %v, expected %v", decrypted, plaintext)
	}
}

func TestRC4KnownVectors(t *testing.T) {
	testCases := []struct {
		key        []byte
		plaintext  []byte
		ciphertext []byte
	}{
		{
			key:        []byte("Key"),
			plaintext:  []byte("Plaintext"),
			ciphertext: []byte{0xBB, 0xF3, 0x16, 0xE8, 0xD9, 0x40, 0xAF, 0x0A, 0xD3},
		},
		{
			key:        []byte("Wiki"),
			plaintext:  []byte("pedia"),
			ciphertext: []byte{0x10, 0x21, 0xBF, 0x04, 0x20},
		},
	}
	
	for i, tc := range testCases {
		state := NewRC4State(tc.key)
		encrypted := state.xorStream(tc.plaintext)
		
		if !bytes.Equal(encrypted, tc.ciphertext) {
			t.Errorf("Test case %d: expected %x, got %x", i, tc.ciphertext, encrypted)
		}
		
		state2 := NewRC4State(tc.key)
		decrypted := state2.xorStream(encrypted)
		if !bytes.Equal(decrypted, tc.plaintext) {
			t.Errorf("Test case %d: decryption failed", i)
		}
	}
}

func TestTypedEncryption_Int64(t *testing.T) {
	engine := NewRC4Engine(3)
	key := []byte("testkey1234567890")
	engine.AddKey("key1", 1, key)
	
	codec := NewTypedCodec(engine)
	
	encrypted, err := codec.EncryptTyped("123456789", 1, TypeInt64)
	if err != nil {
		t.Fatal(err)
	}
	
	tv, err := codec.DecryptTyped(encrypted)
	if err != nil {
		t.Fatal(err)
	}
	
	if tv.Type != TypeInt64 {
		t.Errorf("Decrypted type should be %v, got %v", TypeInt64, tv.Type)
	}
	
	value, ok := tv.Value.(int64)
	if !ok {
		t.Fatal("Value should be int64")
	}
	
	if value != 123456789 {
		t.Errorf("Expected 123456789, got %d", value)
	}
}

func TestTypedEncryption_Float64(t *testing.T) {
	engine := NewRC4Engine(3)
	key := []byte("testkey1234567890")
	engine.AddKey("key1", 1, key)
	
	codec := NewTypedCodec(engine)
	
	encrypted, err := codec.EncryptTyped("1234.5678", 1, TypeFloat64)
	if err != nil {
		t.Fatal(err)
	}
	
	tv, err := codec.DecryptTyped(encrypted)
	if err != nil {
		t.Fatal(err)
	}
	
	if tv.Type != TypeFloat64 {
		t.Errorf("Decrypted type should be %v, got %v", TypeFloat64, tv.Type)
	}
	
	value, ok := tv.Value.(float64)
	if !ok {
		t.Fatal("Value should be float64")
	}
	
	if value != 1234.5678 {
		t.Errorf("Expected 1234.5678, got %f", value)
	}
}

func TestTypedEncryption_Bool(t *testing.T) {
	engine := NewRC4Engine(3)
	key := []byte("testkey1234567890")
	engine.AddKey("key1", 1, key)
	
	codec := NewTypedCodec(engine)
	
	encrypted, err := codec.EncryptTyped("true", 1, TypeBool)
	if err != nil {
		t.Fatal(err)
	}
	
	tv, err := codec.DecryptTyped(encrypted)
	if err != nil {
		t.Fatal(err)
	}
	
	if tv.Type != TypeBool {
		t.Errorf("Decrypted type should be %v, got %v", TypeBool, tv.Type)
	}
	
	value, ok := tv.Value.(bool)
	if !ok {
		t.Fatal("Value should be bool")
	}
	
	if value != true {
		t.Errorf("Expected true, got %v", value)
	}
}

func TestTypedEncryption_TypeInference(t *testing.T) {
	engine := NewRC4Engine(3)
	key := []byte("testkey1234567890")
	engine.AddKey("key1", 1, key)
	
	codec := NewTypedCodec(engine)
	
	testCases := []struct {
		input    string
		expected DataType
	}{
		{"12345", TypeInt64},
		{"123.45", TypeFloat64},
		{"true", TypeBool},
		{"FALSE", TypeBool},
		{"hello", TypeString},
		{"'12345'", TypeString},
		{"NULL", TypeBytes},
	}
	
	for _, tc := range testCases {
		inferred := codec.inferType(tc.input)
		if inferred != tc.expected {
			t.Errorf("Input '%s': expected %v, got %v", tc.input, tc.expected, inferred)
		}
	}
}

func TestRotationWithDualWrite(t *testing.T) {
	engine := NewRC4Engine(3)
	key1 := []byte("key1-version1-abcdef")
	key2 := []byte("key2-version2-ghijkl")
	
	engine.AddKey("key1", 1, key1)
	
	if engine.IsRotating() {
		t.Error("Should not be rotating initially")
	}
	
	engine.StartRotation()
	if !engine.IsRotating() {
		t.Error("Should be rotating after StartRotation")
	}
	
	plaintext := []byte("test data for rotation")
	encrypted, err := engine.EncryptLatest(plaintext)
	if err != nil {
		t.Fatal(err)
	}
	
	version := int(encrypted[3])
	if version != 1 {
		t.Errorf("Should use latest version 1, got %d", version)
	}
	
	newVersion, err := engine.RotateKey("key2", key2)
	if err != nil {
		t.Fatal(err)
	}
	
	if newVersion != 2 {
		t.Errorf("Expected new version 2, got %d", newVersion)
	}
	
	if engine.IsRotating() {
		t.Error("Should not be rotating after RotateKey completes")
	}
	
	decrypted, err := engine.Decrypt(encrypted)
	if err != nil {
		t.Fatal(err)
	}
	
	if !bytes.Equal(decrypted, plaintext) {
		t.Errorf("Old data should still be decryptable: expected %s, got %s", plaintext, decrypted)
	}
	
	newPlaintext := []byte("new data after rotation")
	newEncrypted, err := engine.EncryptLatest(newPlaintext)
	if err != nil {
		t.Fatal(err)
	}
	
	newVersion2 := int(newEncrypted[3])
	if newVersion2 != 2 {
		t.Errorf("New data should use version 2, got %d", newVersion2)
	}
	
	newDecrypted, err := engine.Decrypt(newEncrypted)
	if err != nil {
		t.Fatal(err)
	}
	
	if !bytes.Equal(newDecrypted, newPlaintext) {
		t.Errorf("New data should decrypt correctly")
	}
}

func TestConcurrentEncryptionDuringRotation(t *testing.T) {
	engine := NewRC4Engine(3)
	key1 := []byte("concurrent-key1-abcdef")
	key2 := []byte("concurrent-key2-ghijkl")
	
	engine.AddKey("key1", 1, key1)
	
	done := make(chan bool, 10)
	errors := make(chan error, 10)
	
	engine.StartRotation()
	
	for i := 0; i < 10; i++ {
		go func(id int) {
			data := []byte("concurrent data " + string(rune('A'+id)))
			encrypted, err := engine.EncryptLatest(data)
			if err != nil {
				errors <- err
				done <- false
				return
			}
			
			decrypted, err := engine.Decrypt(encrypted)
			if err != nil {
				errors <- err
				done <- false
				return
			}
			
			if !bytes.Equal(decrypted, data) {
				errors <- nil
				done <- false
				return
			}
			
			done <- true
		}(i)
	}
	
	_, err := engine.RotateKey("key2", key2)
	if err != nil {
		t.Fatal(err)
	}
	
	successCount := 0
	for i := 0; i < 10; i++ {
		if <-done {
			successCount++
		}
	}
	
	select {
	case err := <-errors:
		if err != nil {
			t.Errorf("Error during concurrent encryption: %v", err)
		}
	default:
	}
	
	if successCount < 8 {
		t.Errorf("Too many failures: %d/10 succeeded", successCount)
	}
	
	t.Logf("Concurrent encryption during rotation: %d/10 succeeded", successCount)
}

func TestMultipleKeyVersions(t *testing.T) {
	engine := NewRC4Engine(3)
	
	keys := []struct {
		id      string
		version int
		bytes   []byte
	}{
		{"key1", 1, []byte("key1-version1-aaaaaaaa")},
		{"key2", 2, []byte("key2-version2-bbbbbbbb")},
		{"key3", 3, []byte("key3-version3-cccccccc")},
	}
	
	for _, k := range keys {
		err := engine.AddKey(k.id, k.version, k.bytes)
		if err != nil {
			t.Fatal(err)
		}
	}
	
	plaintext := []byte("multi-version test")
	
	for _, k := range keys {
		encrypted, err := engine.Encrypt(plaintext, k.version)
		if err != nil {
			t.Fatal(err)
		}
		
		version := int(encrypted[3])
		if version != k.version {
			t.Errorf("Expected version %d in ciphertext, got %d", k.version, version)
		}
		
		decrypted, err := engine.Decrypt(encrypted)
		if err != nil {
			t.Fatal(err)
		}
		
		if !bytes.Equal(decrypted, plaintext) {
			t.Errorf("Version %d decryption failed", k.version)
		}
	}
	
	latestEncrypted, err := engine.EncryptLatest(plaintext)
	if err != nil {
		t.Fatal(err)
	}
	
	latestVersion := int(latestEncrypted[3])
	if latestVersion != 3 {
		t.Errorf("Latest version should be 3, got %d", latestVersion)
	}
}

func TestKeyEviction(t *testing.T) {
	engine := NewRC4Engine(3)
	
	for i := 1; i <= 5; i++ {
		key := []byte("key" + string(rune('0'+i)) + "-version" + string(rune('0'+i)))
		err := engine.AddKey("key"+string(rune('0'+i)), i, key)
		if err != nil {
			t.Fatal(err)
		}
	}
	
	versions := engine.GetActiveVersions()
	if len(versions) != 3 {
		t.Errorf("Expected 3 active keys, got %d", len(versions))
	}
	
	latest := engine.GetLatestVersion()
	if latest != 5 {
		t.Errorf("Latest version should be 5, got %d", latest)
	}
	
	_, err := engine.Encrypt([]byte("test"), 1)
	if err == nil {
		t.Error("Should fail to encrypt with evicted key version 1")
	}
	
	_, err = engine.Encrypt([]byte("test"), 5)
	if err != nil {
		t.Errorf("Should succeed with version 5: %v", err)
	}
}

func TestRC4Engine_DecryptWithWrongKey(t *testing.T) {
	codec1 := NewTypedCodec(NewRC4Engine(3))
	codec2 := NewTypedCodec(NewRC4Engine(3))
	
	codec1.engine.AddKey("key1", 1, []byte("correct-key-123456"))
	codec2.engine.AddKey("key2", 1, []byte("wrong-key-654321"))
	
	plaintext := "secret data"
	encrypted, err := codec1.EncryptTyped(plaintext, 1, TypeString)
	if err != nil {
		t.Fatal(err)
	}
	
	_, err = codec2.DecryptTyped(encrypted)
	if err == nil {
		t.Error("Typed decryption should fail with wrong key (invalid type marker)")
	} else {
		t.Logf("Expected error with wrong key: %v", err)
	}
}
