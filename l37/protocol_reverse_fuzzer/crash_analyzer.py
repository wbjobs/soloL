import os
import json
import hashlib
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass, field
from datetime import datetime
from collections import defaultdict
import numpy as np

from .fuzzer import FuzzCase, MutationStrategy


@dataclass
class CrashSample:
    crash_id: str
    crash_time: datetime
    mutated_data: bytes
    original_data: bytes
    mutation_strategy: str
    mutation_details: Dict
    message_type: str
    crash_details: str
    response: bytes = b""
    response_time: float = 0.0
    preceding_packets: List[bytes] = field(default_factory=list)
    categorization: str = "unknown"
    reproducible: Optional[bool] = None

    def to_dict(self) -> Dict:
        return {
            "crash_id": self.crash_id,
            "crash_time": self.crash_time.isoformat(),
            "mutated_hex": self.mutated_data.hex(),
            "original_hex": self.original_data.hex(),
            "mutation_strategy": self.mutation_strategy,
            "mutation_details": self.mutation_details,
            "message_type": self.message_type,
            "crash_details": self.crash_details,
            "response_hex": self.response.hex(),
            "response_time": self.response_time,
            "preceding_packets_hex": [p.hex() for p in self.preceding_packets],
            "categorization": self.categorization,
            "reproducible": self.reproducible
        }

    def to_readable_format(self) -> str:
        lines = [f"Crash ID: {self.crash_id}"]
        lines.append(f"Time: {self.crash_time.isoformat()}")
        lines.append(f"Type: {self.categorization}")
        lines.append(f"Message: {self.message_type}")
        lines.append(f"Strategy: {self.mutation_strategy}")
        lines.append(f"Details: {self.crash_details}")
        lines.append("")
        lines.append("Original packet:")
        lines.append(f"  HEX: {self._format_hex(self.original_data)}")
        lines.append(f"  ASCII: {self._format_ascii(self.original_data)}")
        lines.append("")
        lines.append("Mutated (crash) packet:")
        lines.append(f"  HEX: {self._format_hex(self.mutated_data)}")
        lines.append(f"  ASCII: {self._format_ascii(self.mutated_data)}")
        lines.append("")
        lines.append("Mutation details:")
        for key, value in self.mutation_details.items():
            lines.append(f"  {key}: {value}")

        if self.preceding_packets:
            lines.append("")
            lines.append("Preceding packets (crash sequence):")
            for i, pkt in enumerate(self.preceding_packets):
                lines.append(f"  [{i}] HEX: {self._format_hex(pkt, 48)}")

        return "\n".join(lines)

    def _format_hex(self, data: bytes, max_len: int = 64) -> str:
        hex_str = data.hex()
        if len(hex_str) > max_len:
            hex_str = hex_str[:max_len] + "..."
        return hex_str

    def _format_ascii(self, data: bytes) -> str:
        result = []
        for b in data:
            if 32 <= b < 127:
                result.append(chr(b))
            else:
                result.append('.')
        return ''.join(result)


class CrashAnalyzer:
    def __init__(self, output_dir: str = "crash_samples"):
        self.output_dir = output_dir
        self.crashes: Dict[str, CrashSample] = {}
        self._ensure_output_dir()

    def _ensure_output_dir(self) -> None:
        if not os.path.exists(self.output_dir):
            os.makedirs(self.output_dir)

    def _generate_crash_id(self, data: bytes, details: str) -> str:
        content = data + details.encode('utf-8')
        hash_obj = hashlib.sha256(content)
        return hash_obj.hexdigest()[:16]

    def analyze_crash(self, fuzz_case: FuzzCase,
                      preceding_cases: List[FuzzCase] = None) -> CrashSample:
        crash_id = self._generate_crash_id(fuzz_case.mutated_data,
                                            fuzz_case.crash_details or "")

        preceding_packets = []
        if preceding_cases:
            preceding_packets = [c.mutated_data for c in preceding_cases[-5:]]

        sample = CrashSample(
            crash_id=crash_id,
            crash_time=datetime.fromtimestamp(fuzz_case.sent_at)
            if fuzz_case.sent_at else datetime.now(),
            mutated_data=fuzz_case.mutated_data,
            original_data=fuzz_case.original_data,
            mutation_strategy=fuzz_case.mutation_strategy.value,
            mutation_details=fuzz_case.mutation_details,
            message_type=fuzz_case.message_type,
            crash_details=fuzz_case.crash_details or "Unknown crash",
            response=fuzz_case.response,
            response_time=fuzz_case.response_time,
            preceding_packets=preceding_packets
        )

        sample.categorization = self._categorize_crash(sample)

        if crash_id not in self.crashes:
            self.crashes[crash_id] = sample
            self._save_crash_sample(sample)

        return sample

    def _categorize_crash(self, sample: CrashSample) -> str:
        details = sample.crash_details.lower()

        if any(kw in details for kw in ["connection reset", "connection aborted",
                                         "broken pipe", "reset by peer"]):
            return "network_crash"
        elif "timeout" in details:
            return "timeout_crash"
        elif any(kw in details for kw in ["segfault", "segmentation fault",
                                           "access violation"]):
            return "memory_corruption"
        elif any(kw in details for kw in ["buffer overflow", "stack overflow",
                                           "heap corruption"]):
            return "buffer_overflow"
        elif any(kw in details for kw in ["crash signature", "exception",
                                           "panic"]):
            return "application_error"
        elif "null" in details:
            return "null_pointer"
        elif "division" in details and "zero" in details:
            return "division_by_zero"
        else:
            return "unknown"

    def _save_crash_sample(self, sample: CrashSample) -> None:
        crash_dir = os.path.join(self.output_dir, sample.categorization)
        if not os.path.exists(crash_dir):
            os.makedirs(crash_dir)

        json_path = os.path.join(crash_dir, f"{sample.crash_id}.json")
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(sample.to_dict(), f, indent=2, ensure_ascii=False)

        txt_path = os.path.join(crash_dir, f"{sample.crash_id}.txt")
        with open(txt_path, 'w', encoding='utf-8') as f:
            f.write(sample.to_readable_format())

        bin_path = os.path.join(crash_dir, f"{sample.crash_id}.bin")
        with open(bin_path, 'wb') as f:
            f.write(sample.mutated_data)

        seq_path = os.path.join(crash_dir, f"{sample.crash_id}_sequence.bin")
        with open(seq_path, 'wb') as f:
            for i, pkt in enumerate(sample.preceding_packets):
                f.write(f"--- Packet {i} ---\n".encode())
                f.write(pkt)
                f.write(b"\n")
            f.write(f"--- Crash Packet ---\n".encode())
            f.write(sample.mutated_data)

    def get_crashes_by_category(self, category: Optional[str] = None) -> List[CrashSample]:
        if category:
            return [c for c in self.crashes.values() if c.categorization == category]
        return list(self.crashes.values())

    def get_crash_statistics(self) -> Dict:
        stats = {
            "total_crashes": len(self.crashes),
            "by_category": defaultdict(int),
            "by_strategy": defaultdict(int),
            "by_message_type": defaultdict(int),
            "unique_crash_inputs": len({c.mutated_data for c in self.crashes.values()})
        }

        for crash in self.crashes.values():
            stats["by_category"][crash.categorization] += 1
            stats["by_strategy"][crash.mutation_strategy] += 1
            stats["by_message_type"][crash.message_type] += 1

        stats["by_category"] = dict(stats["by_category"])
        stats["by_strategy"] = dict(stats["by_strategy"])
        stats["by_message_type"] = dict(stats["by_message_type"])

        return stats

    def analyze_mutation_effectiveness(self) -> Dict:
        strategy_stats = defaultdict(lambda: {"crashes": 0, "total_cases": 0,
                                              "crash_rate": 0.0})

        for crash in self.crashes.values():
            strategy_stats[crash.mutation_strategy]["crashes"] += 1

        return {
            "by_strategy": dict(strategy_stats),
            "most_effective": max(strategy_stats.items(),
                                   key=lambda x: x[1]["crashes"])[0]
            if strategy_stats else None
        }

    def find_minimal_crash(self, crash_id: str) -> Optional[CrashSample]:
        if crash_id not in self.crashes:
            return None

        original = self.crashes[crash_id]
        minimal = CrashSample(
            crash_id=f"minimal_{crash_id}",
            crash_time=datetime.now(),
            mutated_data=original.mutated_data,
            original_data=original.original_data,
            mutation_strategy="minimization",
            mutation_details={"original_crash": crash_id},
            message_type=original.message_type,
            crash_details=original.crash_details,
            response=original.response,
            response_time=original.response_time,
            preceding_packets=original.preceding_packets,
            categorization=original.categorization
        )

        data = bytearray(original.mutated_data)
        reduced = True

        while reduced:
            reduced = False
            for i in reversed(range(len(data))):
                test_data = bytes(data[:i] + data[i + 1:])
                if self._is_still_crash(test_data, original):
                    data = bytearray(test_data)
                    reduced = True
                    break

        if len(data) < len(original.mutated_data):
            minimal.mutated_data = bytes(data)
            minimal.mutation_details["reduced_length"] = len(data)
            minimal.mutation_details["original_length"] = len(original.mutated_data)
            return minimal

        return None

    def _is_still_crash(self, test_data: bytes, original: CrashSample) -> bool:
        return hash(test_data) in {hash(c.mutated_data) for c in self.crashes.values()}

    def load_crashes_from_dir(self, directory: Optional[str] = None) -> List[CrashSample]:
        target_dir = directory or self.output_dir
        if not os.path.exists(target_dir):
            return []

        loaded = []
        for root, dirs, files in os.walk(target_dir):
            for file in files:
                if file.endswith('.json'):
                    try:
                        with open(os.path.join(root, file), 'r', encoding='utf-8') as f:
                            data = json.load(f)

                        sample = CrashSample(
                            crash_id=data["crash_id"],
                            crash_time=datetime.fromisoformat(data["crash_time"]),
                            mutated_data=bytes.fromhex(data["mutated_hex"]),
                            original_data=bytes.fromhex(data["original_hex"]),
                            mutation_strategy=data["mutation_strategy"],
                            mutation_details=data["mutation_details"],
                            message_type=data["message_type"],
                            crash_details=data["crash_details"],
                            response=bytes.fromhex(data["response_hex"]),
                            response_time=data["response_time"],
                            preceding_packets=[bytes.fromhex(p)
                                               for p in data["preceding_packets_hex"]],
                            categorization=data["categorization"],
                            reproducible=data.get("reproducible")
                        )
                        self.crashes[sample.crash_id] = sample
                        loaded.append(sample)
                    except Exception as e:
                        print(f"Error loading crash {file}: {e}")

        return loaded

    def generate_crash_report(self, output_file: str = "crash_report.md") -> str:
        stats = self.get_crash_statistics()

        lines = ["# Crash Analysis Report"]
        lines.append("")
        lines.append(f"Generated: {datetime.now().isoformat()}")
        lines.append(f"Total unique crashes: {stats['total_crashes']}")
        lines.append(f"Unique crash inputs: {stats['unique_crash_inputs']}")
        lines.append("")

        lines.append("## By Category")
        for category, count in sorted(stats["by_category"].items(),
                                       key=lambda x: -x[1]):
            lines.append(f"- {category}: {count}")
        lines.append("")

        lines.append("## By Mutation Strategy")
        for strategy, count in sorted(stats["by_strategy"].items(),
                                       key=lambda x: -x[1]):
            lines.append(f"- {strategy}: {count}")
        lines.append("")

        lines.append("## By Message Type")
        for msg_type, count in sorted(stats["by_message_type"].items(),
                                       key=lambda x: -x[1]):
            lines.append(f"- {msg_type}: {count}")
        lines.append("")

        lines.append("## Crash Samples")
        for crash_id, sample in sorted(self.crashes.items()):
            lines.append(f"### {sample.categorization} - {crash_id}")
            lines.append("")
            lines.append(f"**Time**: {sample.crash_time.isoformat()}")
            lines.append(f"**Message**: {sample.message_type}")
            lines.append(f"**Strategy**: {sample.mutation_strategy}")
            lines.append(f"**Details**: {sample.crash_details}")
            lines.append("")
            lines.append("```")
            lines.append(sample.to_readable_format())
            lines.append("```")
            lines.append("")

        report = "\n".join(lines)

        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(report)

        return report

    def visualize_packet_difference(self, crash_id: str) -> str:
        if crash_id not in self.crashes:
            return "Crash not found"

        sample = self.crashes[crash_id]
        original = sample.original_data
        mutated = sample.mutated_data

        max_len = max(len(original), len(mutated))
        min_len = min(len(original), len(mutated))

        lines = [f"Packet difference for crash {crash_id}"]
        lines.append("=" * 80)

        hex_orig = original.hex()
        hex_mut = mutated.hex()

        lines.append(f"Original ({len(original)} bytes):")
        lines.append(f"  {self._format_hex_line(original, 0)}")
        lines.append("")
        lines.append(f"Mutated ({len(mutated)} bytes):")
        lines.append(f"  {self._format_hex_line(mutated, 0)}")
        lines.append("")
        lines.append("Difference map (X = different, . = same):")

        diff_map = []
        for i in range(max_len):
            if i >= min_len:
                diff_map.append('+')
            elif original[i] != mutated[i]:
                diff_map.append('X')
            else:
                diff_map.append('.')

        for i in range(0, len(diff_map), 32):
            chunk = diff_map[i:i + 32]
            lines.append(f"  {i:04x}: {''.join(chunk)}")

        changes = sum(1 for c in diff_map if c in ['X', '+'])
        lines.append("")
        lines.append(f"Total changes: {changes} bytes "
                     f"({changes / max_len * 100:.1f}%)")

        return "\n".join(lines)

    def _format_hex_line(self, data: bytes, start: int) -> str:
        parts = []
        for i in range(0, min(32, len(data) - start), 2):
            byte_pair = data[start + i:start + i + 2]
            parts.append(byte_pair.hex())
        return ' '.join(parts)

    def get_crash_sequence(self, crash_id: str) -> List[Dict]:
        if crash_id not in self.crashes:
            return []

        sample = self.crashes[crash_id]
        sequence = []

        for i, pkt in enumerate(sample.preceding_packets):
            sequence.append({
                "position": i,
                "type": "preceding",
                "hex": pkt.hex(),
                "ascii": self._bytes_to_ascii(pkt)
            })

        sequence.append({
            "position": len(sample.preceding_packets),
            "type": "crash",
            "hex": sample.mutated_data.hex(),
            "ascii": self._bytes_to_ascii(sample.mutated_data),
            "crash_details": sample.crash_details
        })

        return sequence

    def _bytes_to_ascii(self, data: bytes) -> str:
        result = []
        for b in data:
            if 32 <= b < 127:
                result.append(chr(b))
            else:
                result.append('.')
        return ''.join(result)

    def get_crash_heatmap_data(self) -> Dict:
        if not self.crashes:
            return {}

        all_data = [c.mutated_data for c in self.crashes.values()]
        max_len = max(len(d) for d in all_data)

        heatmap = np.zeros((max_len, 256), dtype=int)

        for data in all_data:
            for pos, byte_val in enumerate(data):
                if pos < max_len:
                    heatmap[pos, byte_val] += 1

        return {
            "positions": list(range(max_len)),
            "byte_values": list(range(256)),
            "heatmap": heatmap.tolist(),
            "hot_positions": [int(i) for i in np.where(heatmap.sum(axis=1) > 0)[0]]
        }
