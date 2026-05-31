.PHONY: generate build demo clean

BPF_SRC = bpf/trace.c
TRACER_PKG = tracer

generate:
	go generate ./$(TRACER_PKG)

build: generate
	CGO_ENABLED=0 go build -o bin/tracer .

demo:
	go build -o bin/demo ./cmd/demo

clean:
	rm -rf bin/
	rm -f tracer/bpf_bpfel.go tracer/bpf_bpfeb.go
	rm -f tracer/bpf_bpfel.o tracer/bpf_bpfeb.o
	rm -f trace.db
	rm -f bpf/vmlinux.h

run: build
	sudo ./bin/tracer

run-demo: demo
	./bin/demo

deps:
	go mod tidy
