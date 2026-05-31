package main

import (
	"context"
	"crypto-proxy/pkg/crypto"
	"crypto-proxy/pkg/proxy"
	"crypto-proxy/pkg/rotation"
	"encoding/hex"
	"fmt"
	"log"
	"time"
)

func main() {
	cryptoEngine := crypto.NewRC4Engine(3)
	metadataMgr := crypto.NewMetadataManager()

	keyID, keyBytes, _ := rotation.GenerateNewKey()
	cryptoEngine.AddKey(keyID, 1, keyBytes)

	metadataMgr.AddColumn(&crypto.ColumnEncryptionConfig{
		TableSchema: "test",
		TableName:   "users",
		ColumnName:  "email",
		ColumnType:  crypto.TypeString,
		Enabled:     true,
		KeyVersion:  1,
		CreatedAt:   time.Now().Unix(),
		UpdatedAt:   time.Now().Unix(),
	})

	metadataMgr.AddColumn(&crypto.ColumnEncryptionConfig{
		TableSchema: "test",
		TableName:   "users",
		ColumnName:  "phone",
		ColumnType:  crypto.TypeString,
		Enabled:     true,
		KeyVersion:  1,
		CreatedAt:   time.Now().Unix(),
		UpdatedAt:   time.Now().Unix(),
	})

	metadataMgr.AddColumn(&crypto.ColumnEncryptionConfig{
		TableSchema: "test",
		TableName:   "users",
		ColumnName:  "age",
		ColumnType:  crypto.TypeInt64,
		Enabled:     true,
		KeyVersion:  1,
		CreatedAt:   time.Now().Unix(),
		UpdatedAt:   time.Now().Unix(),
	})

	metadataMgr.AddColumn(&crypto.ColumnEncryptionConfig{
		TableSchema: "test",
		TableName:   "users",
		ColumnName:  "balance",
		ColumnType:  crypto.TypeFloat64,
		Enabled:     true,
		KeyVersion:  1,
		CreatedAt:   time.Now().Unix(),
		UpdatedAt:   time.Now().Unix(),
	})

	metadataMgr.AddColumn(&crypto.ColumnEncryptionConfig{
		TableSchema: "test",
		TableName:   "users",
		ColumnName:  "is_active",
		ColumnType:  crypto.TypeBool,
		Enabled:     true,
		KeyVersion:  1,
		CreatedAt:   time.Now().Unix(),
		UpdatedAt:   time.Now().Unix(),
	})

	proxyInstance := proxy.NewProxy(cryptoEngine, metadataMgr, "test")

	fmt.Println("=== Database Encryption Proxy Demo (Fixed Version) ===")
	fmt.Println()

	fmt.Println("=== Fix 1: RC4 Standard KSA/PRGA Algorithm ===")
	testPlaintext := []byte("Hello, RC4!")
	encrypted1, _ := cryptoEngine.Encrypt(testPlaintext, 1)
	decrypted1, _ := cryptoEngine.Decrypt(encrypted1)
	fmt.Printf("Plaintext: %s\n", testPlaintext)
	fmt.Printf("Encrypted (hex): %x\n", encrypted1)
	fmt.Printf("Decrypted: %s\n", decrypted1)
	fmt.Printf("Match: %v\n", string(decrypted1) == string(testPlaintext))
	fmt.Println()

	fmt.Println("=== Fix 2: Typed Encryption/Decryption ===")
	insertSQL := "INSERT INTO users (name, email, phone, age, balance, is_active) VALUES ('John', 'john@example.com', '13800138000', '30', '9999.99', 'true')"
	fmt.Println("Original SQL:", insertSQL)
	
	processedSQL, err := proxyInstance.ProcessQuery(insertSQL)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println("Processed SQL:", processedSQL)
	fmt.Println()

	typedCodec := crypto.NewTypedCodec(cryptoEngine)
	testCases := []struct {
		name  string
		value string
		dtype crypto.DataType
	}{
		{"String", "'test@example.com'", crypto.TypeString},
		{"Int64", "12345", crypto.TypeInt64},
		{"Float64", "9999.99", crypto.TypeFloat64},
		{"Bool", "true", crypto.TypeBool},
	}

	for _, tc := range testCases {
		encrypted, _ := typedCodec.EncryptTypedLatest(tc.value, tc.dtype)
		tv, _ := typedCodec.DecryptTyped(encrypted)
		fmt.Printf("%s: original=%s, decrypted=%v (type=%s)\n",
			tc.name, tc.value, tv.Value, tv.Type)
	}
	fmt.Println()

	fmt.Println("=== Fix 3: Connection Pool Management ===")
	connCounter := 0
	pool, err := proxy.NewConnectionPool(
		5,
		2,
		30*time.Second,
		5*time.Minute,
		func() (proxy.DBConnection, error) {
			connCounter++
			return proxy.NewMockDBConnection(fmt.Sprintf("conn-%d", connCounter)), nil
		},
	)
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Close()

	stats := pool.Stats()
	fmt.Printf("Pool stats: total=%d, idle=%d, in_use=%d\n",
		stats["total_connections"], stats["idle"], stats["in_use"])

	ctx := context.Background()
	qc1, _ := proxy.NewQueryContext(ctx, pool)
	qc2, _ := proxy.NewQueryContext(ctx, pool)

	stats = pool.Stats()
	fmt.Printf("After get 2 conns: total=%d, idle=%d, in_use=%d\n",
		stats["total_connections"], stats["idle"], stats["in_use"])

	qc1.Release()
	qc2.Release()

	stats = pool.Stats()
	fmt.Printf("After release: total=%d, idle=%d, in_use=%d\n",
		stats["total_connections"], stats["idle"], stats["in_use"])
	fmt.Println()

	fmt.Println("=== Fix 4: Rotation with Dual Write ===")
	testData := "rotation_test_data"
	encrypted, _ := cryptoEngine.Encrypt([]byte(testData), 1)
	fmt.Printf("Encrypted data (hex): %s\n", hex.EncodeToString(encrypted))

	fmt.Println("Starting key rotation...")
	cryptoEngine.StartRotation()
	fmt.Printf("Is rotating: %v\n", cryptoEngine.IsRotating())

	newKeyID, newKeyBytes, _ := rotation.GenerateNewKey()
	newVersion, _ := cryptoEngine.RotateKey(newKeyID, newKeyBytes)
	fmt.Printf("New key version: %d\n", newVersion)
	fmt.Printf("Is rotating: %v\n", cryptoEngine.IsRotating())

	decrypted, _ := cryptoEngine.Decrypt(encrypted)
	fmt.Printf("Old data decrypted with new keys: %s\n", decrypted)

	newEncrypted, _ := cryptoEngine.EncryptLatest([]byte("new_data_after_rotation"))
	newDecrypted, _ := cryptoEngine.Decrypt(newEncrypted)
	fmt.Printf("New data: %s\n", newDecrypted)

	fmt.Println()
	fmt.Println("Encrypted columns for table 'users':")
	colTypes := proxyInstance.GetEncryptedColumnsWithType("test", "users")
	for col, dtype := range colTypes {
		fmt.Printf("  - %s (%s)\n", col, dtype)
	}
}
