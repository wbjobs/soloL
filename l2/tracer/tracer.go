//go:build linux

package tracer

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"log"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"github.com/cilium/ebpf"
	"github.com/cilium/ebpf/link"
	"github.com/cilium/ebpf/ringbuf"
	"syscall-tracer/store"
)

//go:generate go run github.com/cilium/ebpf/cmd/bpf2go -cc clang -cflags "-O2 -g -D__TARGET_ARCH_x86" -target bpfel,bpfeb bpf ../bpf/trace.c

type TraceMode string

const (
	ModeKprobe    TraceMode = "kprobe"
	ModeTracepoint TraceMode = "tracepoint"
)

type Tracer struct {
	mu        sync.Mutex
	objs      bpfObjects
	links     []link.Link
	reader    *ringbuf.Reader
	store     *store.Store
	tracing   bool
	pid       uint32
	done      chan struct{}
	traceMode TraceMode
}

type KernelVersion struct {
	Major int
	Minor int
	Patch int
}

func GetKernelVersion() (KernelVersion, error) {
	var uname syscall.Utsname
	if err := syscall.Uname(&uname); err != nil {
		return KernelVersion{}, err
	}

	release := strings.TrimSpace(unsafe.String(&uname.Release[0], len(uname.Release)))
	var major, minor, patch int
	parts := strings.SplitN(release, ".", 3)
	if len(parts) > 0 {
		fmt.Sscanf(parts[0], "%d", &major)
	}
	if len(parts) > 1 {
		fmt.Sscanf(parts[1], "%d", &minor)
	}
	if len(parts) > 2 {
		patchParts := strings.SplitN(parts[2], "-", 2)
		fmt.Sscanf(patchParts[0], "%d", &patch)
	}

	return KernelVersion{Major: major, Minor: minor, Patch: patch}, nil
}

func (v KernelVersion) String() string {
	return fmt.Sprintf("%d.%d.%d", v.Major, v.Minor, v.Patch)
}

func (v KernelVersion) Less(other KernelVersion) bool {
	if v.Major != other.Major {
		return v.Major < other.Major
	}
	if v.Minor != other.Minor {
		return v.Minor < other.Minor
	}
	return v.Patch < other.Patch
}

func NewTracer(s *store.Store) (*Tracer, error) {
	objs := bpfObjects{}
	if err := loadBpfObjects(&objs, nil); err != nil {
		return nil, fmt.Errorf("loading eBPF objects: %w", err)
	}

	return &Tracer{
		objs:  objs,
		store: s,
	}, nil
}

func (t *Tracer) StartTrace(pid uint32) error {
	t.mu.Lock()
	defer t.mu.Unlock()

	if t.tracing {
		return fmt.Errorf("already tracing PID %d", t.pid)
	}

	kv, err := GetKernelVersion()
	if err != nil {
		log.Printf("Warning: failed to get kernel version, defaulting to tracepoint mode: %v", err)
	} else {
		log.Printf("Detected kernel version: %s", kv.String())
	}

	key := uint32(0)
	if err := t.objs.Config.Update(key, pid, ebpf.UpdateAny); err != nil {
		return fmt.Errorf("setting target PID: %w", err)
	}

	mode, err := t.attachProbes()
	if err != nil {
		t.objs.Config.Delete(key)
		return fmt.Errorf("attaching probes: %w", err)
	}
	t.traceMode = mode

	var rerr error
	t.reader, rerr = ringbuf.NewReader(t.objs.Events)
	if rerr != nil {
		for _, l := range t.links {
			l.Close()
		}
		t.links = nil
		t.objs.Config.Delete(key)
		return fmt.Errorf("creating ringbuf reader: %w", rerr)
	}

	t.done = make(chan struct{})
	go t.readEvents()

	t.tracing = true
	t.pid = pid
	log.Printf("Tracing started for PID %d using %s mode", pid, mode)
	return nil
}

func (t *Tracer) attachProbes() (TraceMode, error) {
	kv, _ := GetKernelVersion()
	minKprobeKernel := KernelVersion{Major: 5, Minor: 7, Patch: 0}

	if kv.Less(minKprobeKernel) {
		log.Printf("Kernel %s < 5.7, using tracepoint mode", kv.String())
		return t.attachTracepoints()
	}

	log.Println("Attempting kprobe mode (kernel >= 5.7)...")
	if err := t.attachKprobes(); err != nil {
		log.Printf("Kprobe attachment failed: %v, falling back to tracepoint", err)
		for _, l := range t.links {
			l.Close()
		}
		t.links = nil
		return t.attachTracepoints()
	}

	return ModeKprobe, nil
}

func (t *Tracer) attachKprobes() error {
	probes := []struct {
		symbol   string
		program  *ebpf.Program
		isReturn bool
	}{
		{"__x64_sys_read", t.objs.TraceReadKprobeEntry, false},
		{"__x64_sys_read", t.objs.TraceReadKprobeReturn, true},
		{"__x64_sys_write", t.objs.TraceWriteKprobeEntry, false},
		{"__x64_sys_write", t.objs.TraceWriteKprobeReturn, true},
		{"__x64_sys_connect", t.objs.TraceConnectKprobeEntry, false},
		{"__x64_sys_connect", t.objs.TraceConnectKprobeReturn, true},
	}

	var attached []link.Link
	for _, p := range probes {
		var l link.Link
		var err error
		if p.isReturn {
			l, err = link.Kretprobe(p.symbol, p.program, nil)
		} else {
			l, err = link.Kprobe(p.symbol, p.program, nil)
		}
		if err != nil {
			for _, al := range attached {
				al.Close()
			}
			return fmt.Errorf("kprobe on %s: %w", p.symbol, err)
		}
		attached = append(attached, l)
	}
	t.links = attached
	return nil
}

func (t *Tracer) attachTracepoints() (TraceMode, error) {
	tps := []struct {
		group   string
		name    string
		program *ebpf.Program
	}{
		{"syscalls", "sys_enter_read", t.objs.TraceReadTpEntry},
		{"syscalls", "sys_exit_read", t.objs.TraceReadTpExit},
		{"syscalls", "sys_enter_write", t.objs.TraceWriteTpEntry},
		{"syscalls", "sys_exit_write", t.objs.TraceWriteTpExit},
		{"syscalls", "sys_enter_connect", t.objs.TraceConnectTpEntry},
		{"syscalls", "sys_exit_connect", t.objs.TraceConnectTpExit},
	}

	var attached []link.Link
	for _, tp := range tps {
		l, err := link.Tracepoint(tp.group, tp.name, tp.program, nil)
		if err != nil {
			for _, al := range attached {
				al.Close()
			}
			return "", fmt.Errorf("tracepoint %s/%s: %w", tp.group, tp.name, err)
		}
		attached = append(attached, l)
	}
	t.links = attached
	return ModeTracepoint, nil
}

func (t *Tracer) StopTrace() error {
	t.mu.Lock()

	if !t.tracing {
		t.mu.Unlock()
		return fmt.Errorf("not currently tracing")
	}

	reader := t.reader
	t.reader = nil
	links := t.links
	t.links = nil
	pid := t.pid
	mode := t.traceMode
	done := t.done

	t.tracing = false
	t.pid = 0
	t.traceMode = ""

	key := uint32(0)
	t.objs.Config.Delete(key)
	t.mu.Unlock()

	if reader != nil {
		if err := reader.Close(); err != nil {
			log.Printf("Warning: error closing ringbuf reader: %v", err)
		}
	}

	<-done

	for i, l := range links {
		if err := l.Close(); err != nil {
			log.Printf("Warning: error closing link %d: %v", i, err)
		}
	}

	log.Printf("Tracing stopped for PID %d (mode: %s)", pid, mode)
	return nil
}

func (t *Tracer) IsTracing() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.tracing
}

func (t *Tracer) TargetPID() uint32 {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.pid
}

func (t *Tracer) TraceMode() TraceMode {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.traceMode
}

func (t *Tracer) Close() {
	t.mu.Lock()
	tracing := t.tracing
	reader := t.reader
	links := t.links
	done := t.done
	t.reader = nil
	t.links = nil
	t.tracing = false
	t.mu.Unlock()

	if tracing {
		if reader != nil {
			if err := reader.Close(); err != nil {
				log.Printf("Warning: error closing reader during shutdown: %v", err)
			}
		}
		if done != nil {
			<-done
		}
	}

	for i, l := range links {
		if err := l.Close(); err != nil {
			log.Printf("Warning: error closing link %d during shutdown: %v", i, err)
		}
	}

	time.Sleep(10 * time.Millisecond)

	if err := t.objs.Close(); err != nil {
		log.Printf("Warning: error closing eBPF objects: %v", err)
	}

	log.Println("Tracer resources cleaned up successfully")
}

func (t *Tracer) readEvents() {
	defer close(t.done)

	batch := make([]*store.TraceEvent, 0, 256)
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()

	for {
		record, err := t.reader.Read()
		if err != nil {
			if err == ringbuf.ErrClosed {
				t.flushBatch(batch)
				return
			}
			log.Printf("Reading ringbuf event: %v", err)
			runtime.Gosched()
			continue
		}

		var raw bpfEvent
		if err := binary.Read(bytes.NewReader(record.RawSample), binary.LittleEndian, &raw); err != nil {
			log.Printf("Parsing ringbuf event: %v", err)
			continue
		}

		event := convertEvent(&raw)
		batch = append(batch, event)

		if len(batch) >= 256 {
			t.flushBatch(batch)
			batch = batch[:0]
		}

		select {
		case <-ticker.C:
			if len(batch) > 0 {
				t.flushBatch(batch)
				batch = batch[:0]
			}
		default:
		}
	}
}

func (t *Tracer) flushBatch(events []*store.TraceEvent) {
	for _, e := range events {
		if err := t.store.Insert(e); err != nil {
			log.Printf("Inserting trace event: %v", err)
		}
	}
}

func convertEvent(raw *bpfEvent) *store.TraceEvent {
	return &store.TraceEvent{
		PID:         raw.Pid,
		TID:         raw.Tid,
		Comm:        strings.TrimRight(string(raw.Comm[:]), "\x00"),
		TimestampNs: raw.TimestampNs,
		DurationNs:  raw.DurationNs,
		Syscall:     strings.TrimRight(string(raw.Syscall[:]), "\x00"),
		FD:          raw.Fd,
		Size:        raw.Size,
		Ret:         raw.Ret,
	}
}
