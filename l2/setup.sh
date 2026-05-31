#!/bin/bash
set -euo pipefail

echo "=== eBPF Syscall Tracer - Linux Setup ==="

if [ "$(uname -s)" != "Linux" ]; then
    echo "Error: This script must be run on Linux (eBPF requires Linux kernel)"
    exit 1
fi

echo "[1/6] Installing system dependencies..."
if command -v apt-get &>/dev/null; then
    sudo apt-get update
    sudo apt-get install -y clang llvm gcc-multilib libbpf-dev linux-headers-$(uname -r)
elif command -v dnf &>/dev/null; then
    sudo dnf install -y clang llvm gcc-multilib libbpf-devel kernel-headers
elif command -v pacman &>/dev/null; then
    sudo pacman -S --noconfirm clang llvm libbpf linux-headers
else
    echo "Warning: Unsupported package manager. Please install: clang, llvm, libbpf-dev, linux-headers"
fi

echo "[2/6] Checking kernel version..."
KERNEL_VER=$(uname -r | cut -d'-' -f1)
echo "  Current kernel: $KERNEL_VER"
echo "  - Ring buffer requires kernel >= 5.8"
echo "  - kprobe mode works best on kernel >= 5.7"
echo "  - tracepoint mode works on kernel >= 4.14 (fallback)"

echo "[3/6] Generating vmlinux.h (optional)..."
if [ -f /sys/kernel/btf/vmlinux ]; then
    bpftool btf dump file /sys/kernel/btf/vmlinux format c > bpf/vmlinux.h 2>/dev/null && echo "  vmlinux.h generated successfully" || echo "  vmlinux.h generation skipped"
else
    echo "  BTF not available, using standard headers"
fi

echo "[4/6] Running go generate (bpf2go)..."
go generate ./tracer/

echo "[5/6] Building tracer service..."
CGO_ENABLED=0 go build -o bin/tracer .

echo "[6/6] Building demo service..."
go build -o bin/demo ./cmd/demo/

echo ""
echo "=== Build Complete ==="
echo "  Tracer service: ./bin/tracer"
echo "  Demo service:   ./bin/demo"
echo ""
echo "Features:"
echo "  - Ring buffer (16MB) for high-performance event delivery"
echo "  - Automatic kprobe -> tracepoint fallback on old kernels"
echo "  - Batch event processing (256 events/batch)"
echo ""
echo "Usage:"
echo "  1. Start demo service:     ./bin/demo"
echo "  2. Get demo PID:          pgrep demo"
echo "  3. Start tracer service:  sudo ./bin/tracer"
echo "  4. Begin tracing:         curl -X POST http://localhost:9090/trace/start -d '{\"pid\":<DEMO_PID>}'"
echo "  5. Exercise demo:         curl http://localhost:8080/read"
echo "  6. View trace data:       curl http://localhost:9090/trace/data?pid=<DEMO_PID>"
echo "  7. View aggregates:       curl 'http://localhost:9090/trace/aggregate?time_range=last_5m'"
echo "  8. View flame graph:      open http://localhost:9090/trace/flamegraph?time_range=last_5m"
echo "  9. Stop tracing:          curl -X POST http://localhost:9090/trace/stop"
