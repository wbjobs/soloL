package main

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"time"
)

func main() {
	port := "8080"
	if p := os.Getenv("DEMO_PORT"); p != "" {
		port = p
	}

	tmpFile := "/tmp/demo-io.txt"
	f, err := os.Create(tmpFile)
	if err != nil {
		log.Fatalf("Failed to create temp file: %v", err)
	}
	f.WriteString("Hello from demo service - this exercises write syscall\n")
	f.Close()

	mux := http.NewServeMux()

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, "Demo service running on :%s\n", port)
		fmt.Fprintf(w, "Endpoints: /, /read, /write, /connect\n")
	})

	mux.HandleFunc("/read", func(w http.ResponseWriter, r *http.Request) {
		f, err := os.Open(tmpFile)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		defer f.Close()

		data, err := io.ReadAll(f)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}

		w.Header().Set("Content-Type", "text/plain")
		w.Write(data)
	})

	mux.HandleFunc("/write", func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}

		f, err := os.OpenFile(tmpFile, os.O_APPEND|os.O_WRONLY, 0644)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		defer f.Close()

		n, err := f.Write(body)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}

		fmt.Fprintf(w, "Wrote %d bytes\n", n)
	})

	mux.HandleFunc("/connect", func(w http.ResponseWriter, r *http.Request) {
		client := &http.Client{Timeout: 5 * time.Second}
		resp, err := client.Get("https://httpbin.org/get")
		if err != nil {
			fmt.Fprintf(w, "Connect attempt failed: %v\n", err)
			return
		}
		defer resp.Body.Close()

		body, _ := io.ReadAll(resp.Body)
		fmt.Fprintf(w, "Connected! Response length: %d bytes\n", len(body))
	})

	addr := ":" + port
	log.Printf("Demo service starting on %s", addr)
	log.Printf("This service exercises read/write/connect syscalls for eBPF tracing")
	log.Fatal(http.ListenAndServe(addr, mux))
}
