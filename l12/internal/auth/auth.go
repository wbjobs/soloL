package auth

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type KeyManager struct {
	privateKey ed25519.PrivateKey
	publicKey  ed25519.PublicKey
}

type Claims struct {
	UserID   string `json:"user_id"`
	UserName string `json:"user_name"`
	RoomID   string `json:"room_id,omitempty"`
	IsOwner  bool   `json:"is_owner,omitempty"`
	jwt.RegisteredClaims
}

func NewKeyManager() (*KeyManager, error) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("failed to generate ed25519 key: %w", err)
	}
	return &KeyManager{
		privateKey: priv,
		publicKey:  pub,
	}, nil
}

func NewKeyManagerFromKeys(publicKeyStr, privateKeyStr string) (*KeyManager, error) {
	pubBytes, err := base64.StdEncoding.DecodeString(publicKeyStr)
	if err != nil {
		return nil, fmt.Errorf("failed to decode public key: %w", err)
	}
	privBytes, err := base64.StdEncoding.DecodeString(privateKeyStr)
	if err != nil {
		return nil, fmt.Errorf("failed to decode private key: %w", err)
	}
	return &KeyManager{
		privateKey: ed25519.PrivateKey(privBytes),
		publicKey:  ed25519.PublicKey(pubBytes),
	}, nil
}

func (km *KeyManager) GetPublicKey() string {
	return base64.StdEncoding.EncodeToString(km.publicKey)
}

func (km *KeyManager) GetPrivateKey() string {
	return base64.StdEncoding.EncodeToString(km.privateKey)
}

func (km *KeyManager) GenerateToken(userID, userName, roomID string, isOwner bool) (string, error) {
	claims := Claims{
		UserID:   userID,
		UserName: userName,
		RoomID:   roomID,
		IsOwner:  isOwner,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "canvas-signal",
			Subject:   userID,
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
	return token.SignedString(km.privateKey)
}

func (km *KeyManager) ValidateToken(tokenString string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodEd25519); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return km.publicKey, nil
	})

	if err != nil {
		return nil, fmt.Errorf("token parse failed: %w", err)
	}

	if claims, ok := token.Claims.(*Claims); ok && token.Valid {
		return claims, nil
	}

	return nil, errors.New("invalid token")
}

func (km *KeyManager) Sign(data []byte) string {
	signature := ed25519.Sign(km.privateKey, data)
	return base64.StdEncoding.EncodeToString(signature)
}

func (km *KeyManager) Verify(data []byte, signatureStr string) bool {
	signature, err := base64.StdEncoding.DecodeString(signatureStr)
	if err != nil {
		return false
	}
	return ed25519.Verify(km.publicKey, data, signature)
}

func (km *KeyManager) VerifyOwnerSignature(roomID, userID, signatureStr string) bool {
	data := []byte(fmt.Sprintf("kick:%s:%s", roomID, userID))
	return km.Verify(data, signatureStr)
}
