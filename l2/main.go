//go:build linux

package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
	"syscall-tracer/handler"
	"syscall-tracer/store"
	"syscall-tracer/tracer"

	"github.com/gin-gonic/gin"
)

func main() {
	dbPath := envOrDefault("DB_PATH", "trace.db")
	port := envOrDefault("PORT", "9090")

	s, err := store.NewStore(dbPath)
	if err != nil {
		log.Fatalf("Failed to initialize store: %v", err)
	}
	defer s.Close()

	t, err := tracer.NewTracer(s)
	if err != nil {
		log.Fatalf("Failed to initialize tracer: %v", err)
	}
	defer t.Close()

	h := handler.NewHandler(t, s)

	gin.SetMode(gin.ReleaseMode)
	engine := gin.Default()
	h.RegisterRoutes(engine)

	srv := &http.Server{
		Addr:    fmt.Sprintf(":%s", port),
		Handler: engine,
	}

	go func() {
		log.Printf("Server starting on :%s", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down server...")

	if t.IsTracing() {
		log.Println("Stopping active trace...")
		if err := t.StopTrace(); err != nil {
			log.Printf("Error stopping trace: %v", err)
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("Server forced shutdown: %v", err)
	}

	log.Println("Server exited")
}

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
