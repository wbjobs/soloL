package main

import (
	"fmt"
	"log"
	"net"
	"os"
	"time"

	"fingerprint-service/internal/fingerprint"
	"fingerprint-service/internal/storage"
	pb "fingerprint-service/proto/fingerprintpb"

	"google.golang.org/grpc"
	"google.golang.org/grpc/keepalive"
	"google.golang.org/grpc/reflection"
)

func getEnv(key, defaultValue string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return defaultValue
}

func main() {
	dbHost := getEnv("DB_HOST", "localhost")
	dbPort := getEnv("DB_PORT", "5432")
	dbUser := getEnv("DB_USER", "fingerprint")
	dbPassword := getEnv("DB_PASSWORD", "fingerprint123")
	dbName := getEnv("DB_NAME", "fingerprint_db")
	grpcPort := getEnv("GRPC_PORT", "50051")
	redisHost := getEnv("REDIS_HOST", "localhost")
	redisPort := getEnv("REDIS_PORT", "6379")
	redisPassword := getEnv("REDIS_PASSWORD", "")
	redisTTLHours := 24

	store, err := storage.NewPostgresStorage(dbHost, dbPort, dbUser, dbPassword, dbName)
	if err != nil {
		log.Fatalf("Failed to create storage: %v", err)
	}

	log.Println("Connected to database successfully")

	var finalStore storage.Storage = store

	redisCache, err := storage.NewRedisCache(redisHost, redisPort, redisPassword, redisTTLHours)
	if err != nil {
		log.Printf("Warning: Redis not available, running without cache: %v", err)
	} else {
		log.Println("Connected to Redis cache successfully")
		finalStore = storage.NewCachedStorage(store, redisCache)
	}

	svc := fingerprint.NewService(finalStore)
	defer finalStore.Close()

	lis, err := net.Listen("tcp", ":"+grpcPort)
	if err != nil {
		log.Fatalf("Failed to listen: %v", err)
	}

	kaParams := keepalive.ServerParameters{
		MaxConnectionIdle:     5 * time.Minute,
		MaxConnectionAge:      30 * time.Minute,
		MaxConnectionAgeGrace: 10 * time.Second,
		Time:                  30 * time.Second,
		Timeout:               10 * time.Second,
	}

	kaPolicy := keepalive.EnforcementPolicy{
		MinTime:             10 * time.Second,
		PermitWithoutStream: true,
	}

	grpcServer := grpc.NewServer(
		grpc.MaxRecvMsgSize(1024*1024*64),
		grpc.MaxSendMsgSize(1024*1024*64),
		grpc.KeepaliveParams(kaParams),
		grpc.KeepaliveEnforcementPolicy(kaPolicy),
		grpc.InitialConnWindowSize(1<<20),
		grpc.InitialWindowSize(1<<20),
	)

	pb.RegisterFingerprintServiceServer(grpcServer, svc)

	reflection.Register(grpcServer)

	log.Printf("gRPC server listening on port %s", grpcPort)
	log.Println("Fingerprint service started successfully")

	if err := grpcServer.Serve(lis); err != nil {
		log.Fatalf("Failed to serve: %v", err)
	}
}
