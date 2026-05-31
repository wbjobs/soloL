import hashlib
import struct
import json
import os
import time
from typing import List, Dict, Set, Tuple, Optional, Callable
from dataclasses import dataclass, field
from enum import Enum
from collections import defaultdict
import numpy as np


class CoverageSource(Enum):
    RESPONSE_BASED = "response_based"
    QEMU_INSTRUMENTATION = "qemu_instrumentation"
    EXTERNAL_FEEDBACK = "external_feedback"
    HYBRID = "hybrid"


@dataclass
class BasicBlock:
    block_id: int
    address: int
    size: int
    hit_count: int = 0
    first_seen: float = 0.0
    last_seen: float = 0.0
    parent_blocks: Set[int] = field(default_factory=set)
    child_blocks: Set[int] = field(default_factory=set)

    def to_dict(self) -> Dict:
        return {
            "block_id": self.block_id,
            "address": hex(self.address),
            "size": self.size,
            "hit_count": self.hit_count,
            "first_seen": self.first_seen,
            "last_seen": self.last_seen,
            "parent_count": len(self.parent_blocks),
            "child_count": len(self.child_blocks)
        }


@dataclass
class Edge:
    source_id: int
    target_id: int
    hit_count: int = 0

    def edge_hash(self) -> int:
        return hash((self.source_id, self.target_id))


@dataclass
class CoverageMap:
    blocks: Dict[int, BasicBlock] = field(default_factory=dict)
    edges: Dict[int, Edge] = field(default_factory=dict)
    total_executions: int = 0

    def add_block(self, block_id: int, address: int = 0, size: int = 0) -> BasicBlock:
        if block_id not in self.blocks:
            self.blocks[block_id] = BasicBlock(
                block_id=block_id,
                address=address,
                size=size,
                first_seen=time.time()
            )
        block = self.blocks[block_id]
        block.hit_count += 1
        block.last_seen = time.time()
        return block

    def add_edge(self, source_id: int, target_id: int) -> Edge:
        edge_hash = hash((source_id, target_id))
        if edge_hash not in self.edges:
            self.edges[edge_hash] = Edge(
                source_id=source_id,
                target_id=target_id
            )
            if source_id in self.blocks:
                self.blocks[source_id].child_blocks.add(target_id)
            if target_id in self.blocks:
                self.blocks[target_id].parent_blocks.add(source_id)

        self.edges[edge_hash].hit_count += 1
        return self.edges[edge_hash]

    def get_coverage_stats(self) -> Dict:
        block_counts = defaultdict(int)
        for block in self.blocks.values():
            bucket = min(block.hit_count, 256)
            block_counts[bucket] += 1

        return {
            "total_blocks": len(self.blocks),
            "total_edges": len(self.edges),
            "total_executions": self.total_executions,
            "block_hit_distribution": dict(block_counts),
            "max_hit_count": max((b.hit_count for b in self.blocks.values()), default=0),
            "avg_hit_count": np.mean([b.hit_count for b in self.blocks.values()])
            if self.blocks else 0
        }


@dataclass
class SeedEntry:
    data: bytes
    coverage_map: CoverageMap
    fitness_score: float = 0.0
    execution_time: float = 0.0
    source: str = "initial"
    parent_id: Optional[int] = None
    timestamp: float = 0.0

    def compute_fitness(self, global_coverage: CoverageMap) -> float:
        new_blocks = len(set(self.coverage_map.blocks.keys()) -
                         set(global_coverage.blocks.keys()))
        new_edges = len(set(self.coverage_map.edges.keys()) -
                        set(global_coverage.edges.keys()))

        rare_blocks = sum(1 for b in self.coverage_map.blocks.values()
                          if b.hit_count <= 2)

        self.fitness_score = (
            new_blocks * 10.0 +
            new_edges * 5.0 +
            rare_blocks * 2.0 +
            (1.0 / max(self.execution_time, 0.001))
        )

        return self.fitness_score


class ResponseCoverageTracker:
    def __init__(self):
        self._response_hashes: Set[str] = set()
        self._response_categories: Dict[str, int] = defaultdict(int)
        self._response_patterns: Dict[str, List[bytes]] = defaultdict(list)

    def _categorize_response(self, response: bytes, error: Optional[str] = None) -> str:
        if error:
            if "timeout" in error.lower():
                return "timeout"
            elif "reset" in error.lower() or "aborted" in error.lower():
                return "connection_error"
            elif "refused" in error.lower():
                return "connection_refused"
            return f"error_{hashlib.md5(error.encode()).hexdigest()[:8]}"

        if not response:
            return "no_response"

        length_bucket = min(len(response), 4096)
        first_byte = response[0] if response else 0

        structure_hash = self._compute_structure_hash(response)

        return f"resp_L{length_bucket}_B{first_byte:02x}_{structure_hash}"

    def _compute_structure_hash(self, data: bytes) -> str:
        if not data:
            return "empty"

        features = []

        if len(data) >= 4:
            features.append(struct.unpack('>I', data[:4])[0] & 0xFF00)

        byte_classes = set()
        for b in data[:64]:
            if b == 0:
                byte_classes.add('z')
            elif 32 <= b < 127:
                byte_classes.add('p')
            elif b == 0x0a or b == 0x0d:
                byte_classes.add('n')
            else:
                byte_classes.add('b')
        features.append(''.join(sorted(byte_classes)))

        return hashlib.md5(str(features).encode()).hexdigest()[:8]

    def track_response(self, input_data: bytes, response: bytes,
                       error: Optional[str] = None) -> Tuple[bool, str]:
        category = self._categorize_response(response, error)
        is_new = category not in self._response_categories

        self._response_categories[category] += 1
        self._response_patterns[category].append(input_data)

        resp_hash = hashlib.sha256(response or error.encode() if error else b"").hexdigest()[:16]
        is_new_hash = resp_hash not in self._response_hashes
        self._response_hashes.add(resp_hash)

        return is_new or is_new_hash, category

    def get_stats(self) -> Dict:
        return {
            "unique_responses": len(self._response_hashes),
            "response_categories": dict(self._response_categories),
            "total_categories": len(self._response_categories)
        }


class QEMUInstrumentationInterface:
    def __init__(self, binary_path: Optional[str] = None,
                 shared_memory_path: str = "/tmp/afl_coverage"):
        self.binary_path = binary_path
        self.shared_memory_path = shared_memory_path
        self._coverage_shm: Optional[bytearray] = None
        self._is_attached = False
        self._block_map: Dict[int, BasicBlock] = {}

    def is_available(self) -> bool:
        if self.binary_path and os.path.exists(self.binary_path):
            return True

        try:
            import subprocess
            result = subprocess.run(
                ["qemu-gnu", "--version"],
                capture_output=True, timeout=2
            )
            return result.returncode == 0
        except Exception:
            return False

    def attach_to_process(self, pid: Optional[int] = None) -> bool:
        if not self.is_available():
            return False

        try:
            shm_size = 1 << 16
            self._coverage_shm = bytearray(shm_size)
            self._is_attached = True
            return True
        except Exception:
            return False

    def read_coverage(self) -> CoverageMap:
        coverage = CoverageMap()

        if self._coverage_shm:
            for addr, count in enumerate(self._coverage_shm):
                if count > 0:
                    coverage.add_block(addr, address=addr, size=1)
                    coverage.blocks[addr].hit_count = count

        return coverage

    def reset_coverage(self) -> None:
        if self._coverage_shm:
            for i in range(len(self._coverage_shm)):
                self._coverage_shm[i] = 0

    def detach(self) -> None:
        self._is_attached = False
        self._coverage_shm = None

    def get_block_info(self, block_id: int) -> Optional[BasicBlock]:
        return self._block_map.get(block_id)


class ExternalCoverageFeedback:
    def __init__(self, feedback_file: Optional[str] = None):
        self.feedback_file = feedback_file
        self._pending_feedback: List[Dict] = []

    def write_feedback(self, input_data: bytes, coverage_info: Dict) -> None:
        entry = {
            "input_hash": hashlib.sha256(input_data).hexdigest()[:16],
            "input_length": len(input_data),
            "coverage": coverage_info,
            "timestamp": time.time()
        }

        self._pending_feedback.append(entry)

        if self.feedback_file:
            try:
                with open(self.feedback_file, 'a') as f:
                    f.write(json.dumps(entry) + "\n")
            except Exception:
                pass

    def read_feedback(self) -> List[Dict]:
        feedback = list(self._pending_feedback)
        self._pending_feedback.clear()

        if self.feedback_file and os.path.exists(self.feedback_file):
            try:
                with open(self.feedback_file, 'r') as f:
                    for line in f:
                        try:
                            entry = json.loads(line.strip())
                            feedback.append(entry)
                        except json.JSONDecodeError:
                            continue
            except Exception:
                pass

        return feedback

    def coverage_from_feedback(self, feedback: List[Dict]) -> CoverageMap:
        coverage = CoverageMap()

        for entry in feedback:
            cov_info = entry.get("coverage", {})
            blocks = cov_info.get("blocks", [])
            edges = cov_info.get("edges", [])

            for block_info in blocks:
                block_id = block_info.get("id", 0)
                address = block_info.get("address", 0)
                size = block_info.get("size", 0)
                coverage.add_block(block_id, address=address, size=size)

            for edge_info in edges:
                source = edge_info.get("source", 0)
                target = edge_info.get("target", 0)
                coverage.add_edge(source, target)

        return coverage


class CoverageGuidedFuzzer:
    def __init__(self, coverage_source: CoverageSource = CoverageSource.HYBRID,
                 binary_path: Optional[str] = None,
                 feedback_file: Optional[str] = None,
                 seed: Optional[int] = None):
        self.coverage_source = coverage_source
        self.global_coverage = CoverageMap()
        self.seed_corpus: List[SeedEntry] = []
        self.favored_seeds: List[SeedEntry] = []

        self.response_tracker = ResponseCoverageTracker()
        self.qemu_interface = QEMUInstrumentationInterface(binary_path=binary_path)
        self.external_feedback = ExternalCoverageFeedback(feedback_file=feedback_file)

        self._rng = np.random.RandomState(seed)
        self._case_count = 0
        self._new_coverage_count = 0
        self._total_new_blocks = 0
        self._total_new_edges = 0

        self._energy_map: Dict[int, float] = defaultdict(lambda: 1.0)

        self._mutation_history: List[Dict] = []

        if seed is not None:
            import random
            random.seed(seed)

    def add_seed(self, data: bytes, source: str = "initial") -> SeedEntry:
        seed_entry = SeedEntry(
            data=data,
            coverage_map=CoverageMap(),
            source=source,
            timestamp=time.time()
        )
        self.seed_corpus.append(seed_entry)
        return seed_entry

    def select_seed(self) -> Optional[SeedEntry]:
        if not self.seed_corpus:
            return None

        if self.favored_seeds and self._rng.random() < 0.7:
            pool = self.favored_seeds
        else:
            pool = self.seed_corpus

        energies = np.array([self._energy_map[i] for i in range(len(pool))])
        total_energy = energies.sum()

        if total_energy <= 0:
            return self._rng.choice(pool)

        probabilities = energies / total_energy
        idx = self._rng.choice(len(pool), p=probabilities)
        return pool[idx]

    def update_coverage(self, input_data: bytes, response: bytes,
                        error: Optional[str] = None,
                        execution_time: float = 0.0) -> Dict:
        self._case_count += 1

        prev_blocks = len(self.global_coverage.blocks)
        prev_edges = len(self.global_coverage.edges)

        is_new_response, response_category = self.response_tracker.track_response(
            input_data, response, error
        )

        new_coverage = CoverageMap()

        if self.coverage_source in [CoverageSource.RESPONSE_BASED, CoverageSource.HYBRID]:
            response_blocks = self._derive_blocks_from_response(
                input_data, response, error, response_category
            )
            for block_id, block_info in response_blocks.items():
                new_coverage.add_block(
                    block_id,
                    address=block_info.get("address", 0),
                    size=block_info.get("size", 0)
                )

        if self.coverage_source in [CoverageSource.QEMU_INSTRUMENTATION, CoverageSource.HYBRID]:
            if self.qemu_interface._is_attached:
                qemu_coverage = self.qemu_interface.read_coverage()
                for block_id, block in qemu_coverage.blocks.items():
                    new_coverage.add_block(block.block_id,
                                           address=block.address,
                                           size=block.size)
                for edge_hash, edge in qemu_coverage.edges.items():
                    new_coverage.add_edge(edge.source_id, edge.target_id)

        if self.coverage_source in [CoverageSource.EXTERNAL_FEEDBACK, CoverageSource.HYBRID]:
            feedback = self.external_feedback.read_feedback()
            if feedback:
                ext_coverage = self.external_feedback.coverage_from_feedback(feedback)
                for block_id, block in ext_coverage.blocks.items():
                    new_coverage.add_block(block.block_id,
                                           address=block.address,
                                           size=block.size)
                for edge_hash, edge in ext_coverage.edges.items():
                    new_coverage.add_edge(edge.source_id, edge.target_id)

        new_blocks = set(new_coverage.blocks.keys()) - set(self.global_coverage.blocks.keys())
        new_edges_set = set(new_coverage.edges.keys()) - set(self.global_coverage.edges.keys())

        for block_id, block in new_coverage.blocks.items():
            if block_id in self.global_coverage.blocks:
                self.global_coverage.blocks[block_id].hit_count += block.hit_count
                self.global_coverage.blocks[block_id].last_seen = time.time()
            else:
                self.global_coverage.blocks[block_id] = BasicBlock(
                    block_id=block.block_id,
                    address=block.address,
                    size=block.size,
                    hit_count=block.hit_count,
                    first_seen=time.time(),
                    last_seen=time.time()
                )

        for edge_hash, edge in new_coverage.edges.items():
            if edge_hash in self.global_coverage.edges:
                self.global_coverage.edges[edge_hash].hit_count += edge.hit_count
            else:
                self.global_coverage.edges[edge_hash] = Edge(
                    source_id=edge.source_id,
                    target_id=edge.target_id,
                    hit_count=edge.hit_count
                )

        self.global_coverage.total_executions += 1

        has_new_coverage = len(new_blocks) > 0 or len(new_edges_set) > 0 or is_new_response

        if has_new_coverage:
            self._new_coverage_count += 1
            self._total_new_blocks += len(new_blocks)
            self._total_new_edges += len(new_edges_set)

            seed_entry = SeedEntry(
                data=input_data,
                coverage_map=new_coverage,
                execution_time=execution_time,
                source="coverage_guided",
                timestamp=time.time()
            )
            seed_entry.compute_fitness(self.global_coverage)

            if seed_entry.fitness_score > 5.0:
                self.favored_seeds.append(seed_entry)
                if len(self.favored_seeds) > 100:
                    self.favored_seeds.sort(key=lambda s: s.fitness_score, reverse=True)
                    self.favored_seeds = self.favored_seeds[:50]

            for block_id in new_blocks:
                self._energy_map[block_id] = 10.0

        for block_id in self.global_coverage.blocks:
            if self._energy_map[block_id] > 1.0:
                self._energy_map[block_id] *= 0.99

        return {
            "has_new_coverage": has_new_coverage,
            "new_blocks": len(new_blocks),
            "new_edges": len(new_edges_set),
            "is_new_response": is_new_response,
            "response_category": response_category,
            "total_blocks": len(self.global_coverage.blocks),
            "total_edges": len(self.global_coverage.edges),
            "new_block_ids": list(new_blocks)[:20],
            "new_edge_count": len(new_edges_set)
        }

    def _derive_blocks_from_response(self, input_data: bytes, response: bytes,
                                      error: Optional[str],
                                      category: str) -> Dict[int, Dict]:
        blocks = {}

        input_hash = hashlib.md5(input_data).hexdigest()
        category_hash = hashlib.md5(category.encode()).hexdigest()

        category_block_id = int(category_hash[:8], 16) & 0xFFFF
        blocks[category_block_id] = {
            "address": category_block_id,
            "size": len(category)
        }

        if response:
            resp_block_id = int(hashlib.md5(response[:64]).hexdigest()[:8], 16) & 0xFFFF
            blocks[resp_block_id] = {
                "address": resp_block_id,
                "size": len(response)
            }

            if len(response) >= 4:
                for offset in range(0, min(len(response), 64), 4):
                    chunk = response[offset:offset + 4]
                    chunk_id = int(hashlib.md5(chunk).hexdigest()[:4], 16) & 0xFFFF
                    blocks[chunk_id] = {
                        "address": chunk_id,
                        "size": 4
                    }

        if error:
            error_block_id = int(hashlib.md5(error.encode()).hexdigest()[:8], 16) & 0xFFFF
            blocks[error_block_id] = {
                "address": error_block_id,
                "size": len(error)
            }

        for i, byte_val in enumerate(input_data[:32]):
            input_block_id = (i << 8) | byte_val
            blocks[input_block_id] = {
                "address": input_block_id,
                "size": 1
            }

        return blocks

    def suggest_mutation_region(self) -> Dict:
        if not self.global_coverage.blocks:
            return {"strategy": "random", "offset": None, "length": None}

        cold_blocks = [
            (bid, b) for bid, b in self.global_coverage.blocks.items()
            if b.hit_count <= 2
        ]

        if cold_blocks and self._rng.random() < 0.6:
            target_block = self._rng.choice(cold_blocks)
            block_id, block = target_block[0], target_block[1]

            related_inputs = [
                s for s in self.seed_corpus + self.favored_seeds
                if block_id in s.coverage_map.blocks
            ]

            if related_inputs:
                best_input = max(related_inputs, key=lambda s: s.fitness_score)
                return {
                    "strategy": "target_cold_block",
                    "block_id": block_id,
                    "base_data": best_input.data,
                    "offset": min(block.address, len(best_input.data) - 1)
                    if best_input.data else 0,
                    "length": block.size or 4
                }
            else:
                return {
                    "strategy": "explore_cold_block",
                    "block_id": block_id,
                    "offset": block.address & 0xFF,
                    "length": block.size or 4
                }

        frontier_edges = [
            (eh, e) for eh, e in self.global_coverage.edges.items()
            if e.hit_count <= 1
        ]

        if frontier_edges and self._rng.random() < 0.4:
            target_edge = self._rng.choice(frontier_edges)
            edge = target_edge[1]

            return {
                "strategy": "explore_frontier_edge",
                "source_block": edge.source_id,
                "target_block": edge.target_id,
                "offset": (edge.source_id + edge.target_id) & 0xFF,
                "length": 4
            }

        hot_blocks = sorted(
            self.global_coverage.blocks.values(),
            key=lambda b: b.hit_count,
            reverse=True
        )[:5]

        if hot_blocks:
            target = self._rng.choice(hot_blocks)
            return {
                "strategy": "mutate_hot_block",
                "block_id": target.block_id,
                "offset": target.address & 0xFF,
                "length": target.size or 4
            }

        return {"strategy": "random", "offset": None, "length": None}

    def get_coverage_report(self) -> Dict:
        stats = self.global_coverage.get_coverage_stats()
        response_stats = self.response_tracker.get_stats()

        return {
            "total_cases": self._case_count,
            "new_coverage_cases": self._new_coverage_count,
            "total_new_blocks": self._total_new_blocks,
            "total_new_edges": self._total_new_edges,
            "coverage_map": stats,
            "response_coverage": response_stats,
            "seed_corpus_size": len(self.seed_corpus),
            "favored_seeds_size": len(self.favored_seeds),
            "coverage_rate": self._new_coverage_count / max(self._case_count, 1),
            "top_blocks": [
                b.to_dict() for b in sorted(
                    self.global_coverage.blocks.values(),
                    key=lambda b: b.hit_count,
                    reverse=True
                )[:20]
            ],
            "cold_blocks": [
                b.to_dict() for b in sorted(
                    [b for b in self.global_coverage.blocks.values() if b.hit_count <= 2],
                    key=lambda b: b.block_id
                )[:20]
            ]
        }

    def export_coverage(self, output_file: str) -> None:
        report = self.get_coverage_report()
        with open(output_file, 'w') as f:
            json.dump(report, f, indent=2, default=str)

    def import_coverage(self, input_file: str) -> None:
        if not os.path.exists(input_file):
            return

        with open(input_file, 'r') as f:
            data = json.load(f)

        for block_data in data.get("top_blocks", []):
            block_id = block_data.get("block_id", 0)
            if block_id not in self.global_coverage.blocks:
                self.global_coverage.add_block(
                    block_id,
                    address=int(block_data.get("address", "0x0"), 16),
                    size=block_data.get("size", 0)
                )
                self.global_coverage.blocks[block_id].hit_count = block_data.get(
                    "hit_count", 1
                )
