#include <linux/ptrace.h>
#include <linux/sched.h>

struct event {
    u32 pid;
    u32 tid;
    char comm[16];
    u64 timestamp_ns;
    u64 duration_ns;
    char syscall[16];
    u64 fd;
    u64 size;
    s64 ret;
};

struct entry_data {
    u64 timestamp_ns;
    char syscall[16];
    u64 fd;
    u64 size;
};

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 10240);
    __type(key, u64);
    __type(value, struct entry_data);
} active_calls SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 1 << 24);
} events SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_ARRAY);
    __uint(max_entries, 1);
    __type(key, u32);
    __type(value, u32);
} config SEC(".maps");

static __always_inline u32 get_target_pid(void)
{
    u32 key = 0;
    u32 *val = bpf_map_lookup_elem(&config, &key);
    if (!val)
        return 0;
    return *val;
}

static __always_inline void emit_event(void *ctx, u64 pid_tgid,
                                        struct entry_data *entry, s64 ret)
{
    struct event *e;
    e = bpf_ringbuf_reserve(&events, sizeof(struct event), 0);
    if (!e)
        return;

    e->pid = pid_tgid >> 32;
    e->tid = (u32)pid_tgid;
    bpf_get_current_comm(&e->comm, sizeof(e->comm));
    e->timestamp_ns = entry->timestamp_ns;
    e->duration_ns = bpf_ktime_get_ns() - entry->timestamp_ns;
    __builtin_memcpy(e->syscall, entry->syscall, sizeof(e->syscall));
    e->fd = entry->fd;
    e->size = entry->size;
    e->ret = ret;

    bpf_ringbuf_submit(e, 0);
}

SEC("kprobe/__x64_sys_read")
int trace_read_kprobe_entry(struct pt_regs *ctx)
{
    u32 target_pid = get_target_pid();
    if (target_pid == 0)
        return 0;

    u64 pid_tgid = bpf_get_current_pid_tgid();
    u32 pid = pid_tgid >> 32;
    if (pid != target_pid)
        return 0;

    struct entry_data entry = {};
    entry.timestamp_ns = bpf_ktime_get_ns();
    __builtin_memcpy(entry.syscall, "read", 5);
    entry.fd = PT_REGS_PARM1(ctx);
    entry.size = PT_REGS_PARM3(ctx);

    bpf_map_update_elem(&active_calls, &pid_tgid, &entry, BPF_ANY);
    return 0;
}

SEC("kretprobe/__x64_sys_read")
int trace_read_kprobe_return(struct pt_regs *ctx)
{
    u64 pid_tgid = bpf_get_current_pid_tgid();
    struct entry_data *entry = bpf_map_lookup_elem(&active_calls, &pid_tgid);
    if (!entry)
        return 0;

    emit_event(ctx, pid_tgid, entry, PT_REGS_RC(ctx));
    bpf_map_delete_elem(&active_calls, &pid_tgid);
    return 0;
}

SEC("kprobe/__x64_sys_write")
int trace_write_kprobe_entry(struct pt_regs *ctx)
{
    u32 target_pid = get_target_pid();
    if (target_pid == 0)
        return 0;

    u64 pid_tgid = bpf_get_current_pid_tgid();
    u32 pid = pid_tgid >> 32;
    if (pid != target_pid)
        return 0;

    struct entry_data entry = {};
    entry.timestamp_ns = bpf_ktime_get_ns();
    __builtin_memcpy(entry.syscall, "write", 6);
    entry.fd = PT_REGS_PARM1(ctx);
    entry.size = PT_REGS_PARM3(ctx);

    bpf_map_update_elem(&active_calls, &pid_tgid, &entry, BPF_ANY);
    return 0;
}

SEC("kretprobe/__x64_sys_write")
int trace_write_kprobe_return(struct pt_regs *ctx)
{
    u64 pid_tgid = bpf_get_current_pid_tgid();
    struct entry_data *entry = bpf_map_lookup_elem(&active_calls, &pid_tgid);
    if (!entry)
        return 0;

    emit_event(ctx, pid_tgid, entry, PT_REGS_RC(ctx));
    bpf_map_delete_elem(&active_calls, &pid_tgid);
    return 0;
}

SEC("kprobe/__x64_sys_connect")
int trace_connect_kprobe_entry(struct pt_regs *ctx)
{
    u32 target_pid = get_target_pid();
    if (target_pid == 0)
        return 0;

    u64 pid_tgid = bpf_get_current_pid_tgid();
    u32 pid = pid_tgid >> 32;
    if (pid != target_pid)
        return 0;

    struct entry_data entry = {};
    entry.timestamp_ns = bpf_ktime_get_ns();
    __builtin_memcpy(entry.syscall, "connect", 8);
    entry.fd = PT_REGS_PARM1(ctx);
    entry.size = PT_REGS_PARM3(ctx);

    bpf_map_update_elem(&active_calls, &pid_tgid, &entry, BPF_ANY);
    return 0;
}

SEC("kretprobe/__x64_sys_connect")
int trace_connect_kprobe_return(struct pt_regs *ctx)
{
    u64 pid_tgid = bpf_get_current_pid_tgid();
    struct entry_data *entry = bpf_map_lookup_elem(&active_calls, &pid_tgid);
    if (!entry)
        return 0;

    emit_event(ctx, pid_tgid, entry, PT_REGS_RC(ctx));
    bpf_map_delete_elem(&active_calls, &pid_tgid);
    return 0;
}

struct sys_enter_args {
    u16 common_type;
    u8 common_flags;
    u8 common_preempt_count;
    s32 common_pid;
    s32 __syscall_nr;
    u64 fd;
    u64 buf;
    u64 count;
};

struct sys_exit_args {
    u16 common_type;
    u8 common_flags;
    u8 common_preempt_count;
    s32 common_pid;
    s32 __syscall_nr;
    s64 ret;
};

SEC("tracepoint/syscalls/sys_enter_read")
int trace_read_tp_entry(struct sys_enter_args *ctx)
{
    u32 target_pid = get_target_pid();
    if (target_pid == 0)
        return 0;

    u64 pid_tgid = bpf_get_current_pid_tgid();
    u32 pid = pid_tgid >> 32;
    if (pid != target_pid)
        return 0;

    struct entry_data entry = {};
    entry.timestamp_ns = bpf_ktime_get_ns();
    __builtin_memcpy(entry.syscall, "read", 5);
    entry.fd = ctx->fd;
    entry.size = ctx->count;

    bpf_map_update_elem(&active_calls, &pid_tgid, &entry, BPF_ANY);
    return 0;
}

SEC("tracepoint/syscalls/sys_exit_read")
int trace_read_tp_exit(struct sys_exit_args *ctx)
{
    u64 pid_tgid = bpf_get_current_pid_tgid();
    struct entry_data *entry = bpf_map_lookup_elem(&active_calls, &pid_tgid);
    if (!entry)
        return 0;

    emit_event(ctx, pid_tgid, entry, ctx->ret);
    bpf_map_delete_elem(&active_calls, &pid_tgid);
    return 0;
}

SEC("tracepoint/syscalls/sys_enter_write")
int trace_write_tp_entry(struct sys_enter_args *ctx)
{
    u32 target_pid = get_target_pid();
    if (target_pid == 0)
        return 0;

    u64 pid_tgid = bpf_get_current_pid_tgid();
    u32 pid = pid_tgid >> 32;
    if (pid != target_pid)
        return 0;

    struct entry_data entry = {};
    entry.timestamp_ns = bpf_ktime_get_ns();
    __builtin_memcpy(entry.syscall, "write", 6);
    entry.fd = ctx->fd;
    entry.size = ctx->count;

    bpf_map_update_elem(&active_calls, &pid_tgid, &entry, BPF_ANY);
    return 0;
}

SEC("tracepoint/syscalls/sys_exit_write")
int trace_write_tp_exit(struct sys_exit_args *ctx)
{
    u64 pid_tgid = bpf_get_current_pid_tgid();
    struct entry_data *entry = bpf_map_lookup_elem(&active_calls, &pid_tgid);
    if (!entry)
        return 0;

    emit_event(ctx, pid_tgid, entry, ctx->ret);
    bpf_map_delete_elem(&active_calls, &pid_tgid);
    return 0;
}

struct sys_enter_connect_args {
    u16 common_type;
    u8 common_flags;
    u8 common_preempt_count;
    s32 common_pid;
    s32 __syscall_nr;
    u64 fd;
    u64 uservaddr;
    u64 addrlen;
};

SEC("tracepoint/syscalls/sys_enter_connect")
int trace_connect_tp_entry(struct sys_enter_connect_args *ctx)
{
    u32 target_pid = get_target_pid();
    if (target_pid == 0)
        return 0;

    u64 pid_tgid = bpf_get_current_pid_tgid();
    u32 pid = pid_tgid >> 32;
    if (pid != target_pid)
        return 0;

    struct entry_data entry = {};
    entry.timestamp_ns = bpf_ktime_get_ns();
    __builtin_memcpy(entry.syscall, "connect", 8);
    entry.fd = ctx->fd;
    entry.size = ctx->addrlen;

    bpf_map_update_elem(&active_calls, &pid_tgid, &entry, BPF_ANY);
    return 0;
}

SEC("tracepoint/syscalls/sys_exit_connect")
int trace_connect_tp_exit(struct sys_exit_args *ctx)
{
    u64 pid_tgid = bpf_get_current_pid_tgid();
    struct entry_data *entry = bpf_map_lookup_elem(&active_calls, &pid_tgid);
    if (!entry)
        return 0;

    emit_event(ctx, pid_tgid, entry, ctx->ret);
    bpf_map_delete_elem(&active_calls, &pid_tgid);
    return 0;
}

char LICENSE[] SEC("license") = "GPL";
