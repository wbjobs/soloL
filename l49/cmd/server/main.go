package main

import (
	"context"
	"crypto-proxy/pkg/api"
	"crypto-proxy/pkg/crypto"
	"crypto-proxy/pkg/etcd"
	"crypto-proxy/pkg/raft"
	"crypto-proxy/pkg/rotation"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"
)

type Config struct {
	NodeID       string
	APIAddr      string
	Peers        []string
	AutoRotate   bool
	KeyTTL       time.Duration
	MaxKeyVersions int
	DefaultSchema string
}

func main() {
	config := &Config{
		NodeID:        raft.GenerateNodeID(),
		APIAddr:       ":8080",
		Peers:         []string{},
		AutoRotate:    false,
		KeyTTL:        24 * time.Hour,
		MaxKeyVersions: 3,
		DefaultSchema: "test",
	}

	cryptoEngine := crypto.NewRC4Engine(config.MaxKeyVersions)
	metadataMgr := crypto.NewMetadataManager()

	keyID, keyBytes, _ := rotation.GenerateNewKey()
	cryptoEngine.AddKey(keyID, 1, keyBytes)

	etcdClient := etcd.NewMockEtcdClient()
	metadataStore := etcd.NewMetadataStore(etcdClient, "/crypto-proxy/")

	initialKey := &crypto.RC4Key{
		ID:        keyID,
		Version:   1,
		KeyBytes:  keyBytes,
		CreatedAt: time.Now().Unix(),
		Active:    true,
	}
	metadataStore.SaveKey(context.Background(), initialKey)

	applyCh := make(chan raft.LogEntry, 100)
	raftNode := raft.NewRaftNode(config.NodeID, config.Peers, applyCh)
	raftNode.Start()

	arbitrator := rotation.NewKeyRotationArbitrator(
		config.NodeID,
		raftNode,
		metadataStore,
		cryptoEngine,
		metadataMgr,
		config.AutoRotate,
		config.KeyTTL,
	)
	arbitrator.Start()

	apiServer := api.NewAPIServer(
		config.APIAddr,
		cryptoEngine,
		metadataMgr,
		arbitrator,
	)
	apiServer.Start()

	log.Printf("Crypto Proxy Server started")
	log.Printf("Node ID: %s", config.NodeID)
	log.Printf("API Server: http://localhost%s", config.APIAddr)
	log.Printf("Raft State: %s", raftNode.GetState().String())

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	log.Println("Shutting down...")

	arbitrator.Stop()
	raftNode.Stop()
	apiServer.Stop()
	metadataStore.Close()

	log.Println("Shutdown complete")
}
