import socket
import struct
import random
import time
import threading
from typing import List, Dict, Optional, Tuple, Callable
from dataclasses import dataclass, field
from enum import Enum
import numpy as np

from .protocol_description import MessageType
from .protocol_inference import Field


class MutationStrategy(Enum):
    BIT_FLIP = "bit_flip"
    BOUNDARY_VALUE = "boundary_value"
    RANDOM_BYTES = "random_bytes"
    ARITHMETIC = "arithmetic"
    INTERESTING_VALUES = "interesting_values"
    BLOCK_OPERATION = "block_operation"


class FuzzingPhase(Enum):
    INIT = "init"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    ERROR = "error"


@dataclass
class FuzzCase:
    case_id: int
    original_data: bytes
    mutated_data: bytes
    mutation_strategy: MutationStrategy
    mutation_details: Dict = field(default_factory=dict)
    message_type: str = ""
    sent_at: Optional[float] = None
    response: bytes = b""
    response_time: float = 0.0
    has_crashed: bool = False
    crash_details: Optional[str] = None

    def to_dict(self) -> Dict:
        return {
            "case_id": self.case_id,
            "message_type": self.message_type,
            "original_hex": self.original_data.hex(),
            "mutated_hex": self.mutated_data.hex(),
            "mutation_strategy": self.mutation_strategy.value,
            "mutation_details": self.mutation_details,
            "sent_at": self.sent_at,
            "response_hex": self.response.hex(),
            "response_time": self.response_time,
            "has_crashed": self.has_crashed,
            "crash_details": self.crash_details
        }


class Mutator:
    def __init__(self, seed: Optional[int] = None):
        if seed is not None:
            random.seed(seed)
            np.random.seed(seed)

        self.interesting_values = [
            0x00, 0x01, 0x7F, 0x80, 0xFF,
            0x0000, 0x0001, 0x7FFF, 0x8000, 0xFFFF,
            0x00000000, 0x00000001, 0x7FFFFFFF, 0x80000000, 0xFFFFFFFF,
            -1, 0, 1, 16, 32, 64, 100, 127, 128, 255, 256, 512, 1024,
            4096, 8192, 16384, 32767, 32768, 65535, 65536
        ]

    def bit_flip(self, data: bytes, bit_position: Optional[int] = None,
                  num_bits: int = 1) -> Tuple[bytes, Dict]:
        if not data:
            return data, {}

        byte_len = len(data)
        total_bits = byte_len * 8

        if bit_position is None:
            bit_position = random.randint(0, total_bits - 1)

        details = {"start_bit": bit_position, "num_bits": num_bits, "flipped_bits": []}

        byte_list = bytearray(data)
        for i in range(min(num_bits, total_bits - bit_position)):
            current_bit = bit_position + i
            byte_idx = current_bit // 8
            bit_idx = current_bit % 8

            if byte_idx < len(byte_list):
                details["flipped_bits"].append(current_bit)
                byte_list[byte_idx] ^= (1 << bit_idx)

        return bytes(byte_list), details

    def boundary_value(self, data: bytes, offset: int, length: int,
                        is_signed: bool = False) -> Tuple[bytes, Dict]:
        if not data or offset >= len(data):
            return data, {}

        length = min(length, len(data) - offset, 8)

        if is_signed:
            if length == 1:
                boundaries = [0x7F, 0x80, 0x00, 0x01, 0xFF, -1]
            elif length == 2:
                boundaries = [0x7FFF, 0x8000, 0x0000, 0x0001, 0xFFFF, -1]
            elif length == 4:
                boundaries = [0x7FFFFFFF, 0x80000000, 0x00000000, 0x00000001,
                              0xFFFFFFFF, -1]
            else:
                boundaries = [0, 1, -1]
        else:
            if length == 1:
                boundaries = [0x00, 0x01, 0xFE, 0xFF, 0x7F, 0x80]
            elif length == 2:
                boundaries = [0x0000, 0x0001, 0xFFFE, 0xFFFF, 0x7FFF, 0x8000]
            elif length == 4:
                boundaries = [0x00000000, 0x00000001, 0xFFFFFFFE, 0xFFFFFFFF,
                              0x7FFFFFFF, 0x80000000]
            else:
                boundaries = [0, 1]

        value = random.choice(boundaries)

        details = {
            "offset": offset,
            "length": length,
            "is_signed": is_signed,
            "boundary_value": value
        }

        byte_list = bytearray(data)
        try:
            if length == 1:
                byte_list[offset] = value & 0xFF
            elif length == 2:
                struct.pack_into('>H', byte_list, offset, value & 0xFFFF)
            elif length == 4:
                struct.pack_into('>I', byte_list, offset, value & 0xFFFFFFFF)
            elif length == 8:
                struct.pack_into('>Q', byte_list, offset, value & 0xFFFFFFFFFFFFFFFF)
        except Exception as e:
            details["error"] = str(e)

        return bytes(byte_list), details

    def random_bytes(self, data: bytes, offset: Optional[int] = None,
                     length: Optional[int] = None) -> Tuple[bytes, Dict]:
        if not data:
            return data, {}

        if offset is None:
            offset = random.randint(0, len(data) - 1)
        if length is None:
            max_len = min(len(data) - offset, random.randint(1, 16))
            length = random.randint(1, max(max_len, 1))

        length = min(length, len(data) - offset)

        details = {
            "offset": offset,
            "length": length,
            "original_bytes": data[offset:offset + length].hex()
        }

        byte_list = bytearray(data)
        random_data = bytes([random.randint(0, 255) for _ in range(length)])
        byte_list[offset:offset + length] = random_data
        details["new_bytes"] = random_data.hex()

        return bytes(byte_list), details

    def arithmetic(self, data: bytes, offset: int, length: int,
                   is_signed: bool = False) -> Tuple[bytes, Dict]:
        if not data or offset >= len(data):
            return data, {}

        length = min(length, len(data) - offset, 4)
        delta = random.choice([-128, -64, -32, -16, -8, -4, -2, -1,
                               1, 2, 4, 8, 16, 32, 64, 128])

        details = {
            "offset": offset,
            "length": length,
            "delta": delta,
            "is_signed": is_signed
        }

        byte_list = bytearray(data)
        try:
            if length == 1:
                if is_signed:
                    val = struct.unpack_from('>b', byte_list, offset)[0]
                    val += delta
                    struct.pack_into('>b', byte_list, offset,
                                     max(-128, min(127, val)))
                else:
                    val = byte_list[offset]
                    val += delta
                    byte_list[offset] = val & 0xFF
            elif length == 2:
                if is_signed:
                    val = struct.unpack_from('>h', byte_list, offset)[0]
                    val += delta
                    struct.pack_into('>h', byte_list, offset,
                                     max(-32768, min(32767, val)))
                else:
                    val = struct.unpack_from('>H', byte_list, offset)[0]
                    val += delta
                    struct.pack_into('>H', byte_list, offset, val & 0xFFFF)
            elif length == 4:
                if is_signed:
                    val = struct.unpack_from('>i', byte_list, offset)[0]
                    val += delta
                    struct.pack_into('>i', byte_list, offset,
                                     max(-2147483648, min(2147483647, val)))
                else:
                    val = struct.unpack_from('>I', byte_list, offset)[0]
                    val += delta
                    struct.pack_into('>I', byte_list, offset, val & 0xFFFFFFFF)
        except Exception as e:
            details["error"] = str(e)

        return bytes(byte_list), details

    def interesting_value(self, data: bytes, offset: int,
                           length: int) -> Tuple[bytes, Dict]:
        if not data or offset >= len(data):
            return data, {}

        length = min(length, len(data) - offset, 4)

        suitable_values = [v for v in self.interesting_values
                           if abs(v).bit_length() <= length * 8]
        if not suitable_values:
            suitable_values = [0, 1, -1]

        value = random.choice(suitable_values)

        details = {
            "offset": offset,
            "length": length,
            "value": value
        }

        byte_list = bytearray(data)
        try:
            if length == 1:
                byte_list[offset] = value & 0xFF
            elif length == 2:
                struct.pack_into('>H', byte_list, offset, value & 0xFFFF)
            elif length == 4:
                struct.pack_into('>I', byte_list, offset, value & 0xFFFFFFFF)
        except Exception as e:
            details["error"] = str(e)

        return bytes(byte_list), details

    def block_operation(self, data: bytes, operation: str = "duplicate",
                         offset: Optional[int] = None,
                         length: Optional[int] = None) -> Tuple[bytes, Dict]:
        if not data:
            return data, {}

        if offset is None:
            offset = random.randint(0, len(data) - 1)
        if length is None:
            length = random.randint(1, min(32, len(data) - offset))

        length = min(length, len(data) - offset)

        details = {
            "operation": operation,
            "offset": offset,
            "length": length
        }

        block = data[offset:offset + length]
        byte_list = bytearray(data)

        if operation == "duplicate":
            insert_pos = random.randint(0, len(byte_list))
            byte_list[insert_pos:insert_pos] = block
            details["insert_position"] = insert_pos
        elif operation == "delete":
            del byte_list[offset:offset + length]
        elif operation == "overwrite":
            target_offset = random.randint(0, len(byte_list) - length)
            byte_list[target_offset:target_offset + length] = block
            details["target_offset"] = target_offset

        return bytes(byte_list), details

    def mutate_field(self, data: bytes, field: Field,
                      strategy: MutationStrategy) -> Tuple[bytes, Dict]:
        if field.is_fixed:
            return data, {"skipped": "fixed field"}

        offset = field.offset
        length = field.length

        if offset >= len(data):
            return data, {"skipped": "offset out of range"}

        length = min(length, len(data) - offset)

        if strategy == MutationStrategy.BIT_FLIP:
            bit_offset = offset * 8
            return self.bit_flip(data, bit_offset, num_bits=min(length * 8, 32))

        elif strategy == MutationStrategy.BOUNDARY_VALUE:
            return self.boundary_value(data, offset, length,
                                        is_signed=(field.field_type == "length"))

        elif strategy == MutationStrategy.RANDOM_BYTES:
            return self.random_bytes(data, offset, length)

        elif strategy == MutationStrategy.ARITHMETIC:
            return self.arithmetic(data, offset, length,
                                    is_signed=(field.field_type == "length"))

        elif strategy == MutationStrategy.INTERESTING_VALUES:
            return self.interesting_value(data, offset, length)

        elif strategy == MutationStrategy.BLOCK_OPERATION:
            return self.block_operation(data, offset=offset, length=length)

        else:
            return self.random_bytes(data, offset, length)

    def mutate_random(self, data: bytes,
                       strategy: Optional[MutationStrategy] = None
                       ) -> Tuple[bytes, Dict, MutationStrategy]:
        if strategy is None:
            strategy = random.choice(list(MutationStrategy))

        if strategy == MutationStrategy.BIT_FLIP:
            mutated, details = self.bit_flip(data)
        elif strategy == MutationStrategy.BOUNDARY_VALUE:
            offset = random.randint(0, max(0, len(data) - 1))
            length = random.choice([1, 2, 4])
            mutated, details = self.boundary_value(data, offset, length)
        elif strategy == MutationStrategy.RANDOM_BYTES:
            mutated, details = self.random_bytes(data)
        elif strategy == MutationStrategy.ARITHMETIC:
            offset = random.randint(0, max(0, len(data) - 1))
            length = random.choice([1, 2, 4])
            mutated, details = self.arithmetic(data, offset, length)
        elif strategy == MutationStrategy.INTERESTING_VALUES:
            offset = random.randint(0, max(0, len(data) - 1))
            length = random.choice([1, 2, 4])
            mutated, details = self.interesting_value(data, offset, length)
        elif strategy == MutationStrategy.BLOCK_OPERATION:
            op = random.choice(["duplicate", "delete", "overwrite"])
            mutated, details = self.block_operation(data, operation=op)
        else:
            mutated, details = self.random_bytes(data)

        return mutated, details, strategy


class Fuzzer:
    def __init__(self, target_host: str, target_port: int,
                 protocol: str = "tcp", timeout: float = 5.0,
                 seed: Optional[int] = None,
                 coverage_guided: bool = False,
                 binary_path: Optional[str] = None,
                 feedback_file: Optional[str] = None):
        self.target_host = target_host
        self.target_port = target_port
        self.protocol = protocol.lower()
        self.timeout = timeout
        self.mutator = Mutator(seed=seed)
        self.coverage_guided = coverage_guided

        self.message_templates: List[MessageType] = []
        self.fuzz_cases: List[FuzzCase] = []
        self.crash_cases: List[FuzzCase] = []
        self.phase = FuzzingPhase.INIT

        self.max_cases: int = 1000
        self.cases_per_message: int = 100
        self.delay_between_cases: float = 0.1
        self.connection_keep_alive: bool = False

        self._socket: Optional[socket.socket] = None
        self._stop_event = threading.Event()
        self._fuzz_thread: Optional[threading.Thread] = None

        self.case_callback: Optional[Callable[[FuzzCase], None]] = None
        self.crash_callback: Optional[Callable[[FuzzCase], None]] = None

        self._stats = {
            "total_cases": 0,
            "crashes": 0,
            "timeouts": 0,
            "errors": 0,
            "new_coverage": 0,
            "start_time": None,
            "end_time": None
        }

        if coverage_guided:
            from .coverage_fuzzer import CoverageGuidedFuzzer, CoverageSource
            source = CoverageSource.HYBRID if binary_path else CoverageSource.RESPONSE_BASED
            self._coverage_fuzzer = CoverageGuidedFuzzer(
                coverage_source=source,
                binary_path=binary_path,
                feedback_file=feedback_file,
                seed=seed
            )
        else:
            self._coverage_fuzzer = None

    def load_templates(self, message_types: List[MessageType]) -> None:
        self.message_templates = message_types

    def set_strategy_weights(self, weights: Dict[MutationStrategy, float]) -> None:
        self._strategy_weights = weights

    def _select_strategy(self) -> MutationStrategy:
        if hasattr(self, '_strategy_weights') and self._strategy_weights:
            strategies = list(self._strategy_weights.keys())
            weights = list(self._strategy_weights.values())
            total_weight = sum(weights)
            normalized_weights = [w / total_weight for w in weights]
            return random.choices(strategies, weights=normalized_weights, k=1)[0]
        else:
            return random.choice(list(MutationStrategy))

    def _connect(self) -> bool:
        try:
            if self.protocol == "tcp":
                self._socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                self._socket.settimeout(self.timeout)
                self._socket.connect((self.target_host, self.target_port))
            elif self.protocol == "udp":
                self._socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                self._socket.settimeout(self.timeout)
            return True
        except Exception as e:
            print(f"Connection error: {e}")
            return False

    def _disconnect(self) -> None:
        if self._socket:
            try:
                self._socket.close()
            except Exception:
                pass
            self._socket = None

    def _send_and_receive(self, data: bytes) -> Tuple[bytes, float, Optional[str]]:
        if not self._socket and not self._connect():
            return b"", 0.0, "Connection failed"

        start_time = time.time()
        error = None
        response = b""

        try:
            if self.protocol == "tcp":
                self._socket.sendall(data)
                try:
                    chunks = []
                    while True:
                        chunk = self._socket.recv(4096)
                        if not chunk:
                            break
                        chunks.append(chunk)
                        if len(chunk) < 4096:
                            break
                    response = b"".join(chunks)
                except socket.timeout:
                    error = "Timeout"
                except ConnectionResetError:
                    error = "Connection reset"
                except ConnectionAbortedError:
                    error = "Connection aborted"
                except BrokenPipeError:
                    error = "Broken pipe"

            elif self.protocol == "udp":
                self._socket.sendto(data, (self.target_host, self.target_port))
                try:
                    response, _ = self._socket.recvfrom(4096)
                except socket.timeout:
                    error = "Timeout"

        except Exception as e:
            error = str(e)

        elapsed = time.time() - start_time

        if not self.connection_keep_alive and self.protocol == "tcp":
            self._disconnect()

        return response, elapsed, error

    def _check_crash(self, response: bytes, error: Optional[str],
                      response_time: float) -> Tuple[bool, Optional[str]]:
        if error in ["Connection reset", "Connection aborted", "Broken pipe"]:
            return True, f"Network crash: {error}"

        if error == "Timeout" and response_time >= self.timeout:
            return True, f"Timeout crash: {response_time:.2f}s"

        if response and len(response) > 0:
            crash_signatures = [
                b"crash", b"segfault", b"segmentation fault",
                b"error", b"exception", b"panic",
                b"access violation", b"buffer overflow",
                b"stack overflow", b"heap corruption"
            ]
            resp_lower = response.lower()
            for sig in crash_signatures:
                if sig in resp_lower:
                    return True, f"Crash signature found: {sig.decode('ascii', errors='replace')}"

        return False, None

    def _generate_case(self, case_id: int, message_type: MessageType,
                        strategy: Optional[MutationStrategy] = None) -> FuzzCase:
        original = message_type.representative

        if self.coverage_guided and self._coverage_fuzzer:
            suggestion = self._coverage_fuzzer.suggest_mutation_region()

            if suggestion["strategy"] == "target_cold_block" and suggestion.get("base_data"):
                original = suggestion["base_data"]
                offset = suggestion.get("offset", 0)
                length = suggestion.get("length", 4)
                strategy = random.choice([
                    MutationStrategy.BIT_FLIP,
                    MutationStrategy.BOUNDARY_VALUE,
                    MutationStrategy.RANDOM_BYTES,
                    MutationStrategy.ARITHMETIC
                ])
                if strategy == MutationStrategy.BIT_FLIP:
                    mutated, details = self.mutator.bit_flip(
                        original, offset * 8, num_bits=min(length * 8, 32))
                elif strategy == MutationStrategy.BOUNDARY_VALUE:
                    mutated, details = self.mutator.boundary_value(
                        original, offset, length)
                elif strategy == MutationStrategy.RANDOM_BYTES:
                    mutated, details = self.mutator.random_bytes(
                        original, offset, length)
                else:
                    mutated, details = self.mutator.arithmetic(
                        original, offset, length)
                details["coverage_guided"] = suggestion
            else:
                if message_type.fields:
                    mutable_fields = [f for f in message_type.fields if not f.is_fixed]
                    if mutable_fields:
                        field = random.choice(mutable_fields)
                        if strategy is None:
                            strategy = self._select_strategy()
                        mutated, details = self.mutator.mutate_field(original, field, strategy)
                    else:
                        strategy = self._select_strategy()
                        mutated, details, strategy = self.mutator.mutate_random(original, strategy)
                else:
                    strategy = self._select_strategy()
                    mutated, details, strategy = self.mutator.mutate_random(original, strategy)
                details["coverage_guided"] = suggestion
        else:
            if message_type.fields:
                mutable_fields = [f for f in message_type.fields if not f.is_fixed]
                if mutable_fields:
                    field = random.choice(mutable_fields)
                    if strategy is None:
                        strategy = self._select_strategy()
                    mutated, details = self.mutator.mutate_field(original, field, strategy)
                else:
                    strategy = self._select_strategy()
                    mutated, details, strategy = self.mutator.mutate_random(original, strategy)
            else:
                strategy = self._select_strategy()
                mutated, details, strategy = self.mutator.mutate_random(original, strategy)

        return FuzzCase(
            case_id=case_id,
            original_data=original,
            mutated_data=mutated,
            mutation_strategy=strategy,
            mutation_details=details,
            message_type=message_type.name
        )

    def _run_case(self, case: FuzzCase) -> None:
        case.sent_at = time.time()
        response, elapsed, error = self._send_and_receive(case.mutated_data)
        case.response = response
        case.response_time = elapsed

        has_crashed, crash_details = self._check_crash(response, error, elapsed)
        case.has_crashed = has_crashed
        case.crash_details = crash_details

        self._stats["total_cases"] += 1

        if self.coverage_guided and self._coverage_fuzzer:
            cov_result = self._coverage_fuzzer.update_coverage(
                input_data=case.mutated_data,
                response=response or b"",
                error=error,
                execution_time=elapsed
            )
            if cov_result["has_new_coverage"]:
                self._stats["new_coverage"] += 1

        if has_crashed:
            self._stats["crashes"] += 1
            self.crash_cases.append(case)
            if self.crash_callback:
                self.crash_callback(case)
        elif error == "Timeout":
            self._stats["timeouts"] += 1
        elif error:
            self._stats["errors"] += 1

        self.fuzz_cases.append(case)

        if self.case_callback:
            self.case_callback(case)

    def start(self, max_cases: Optional[int] = None,
              cases_per_message: Optional[int] = None,
              delay: Optional[float] = None) -> None:
        if self.phase == FuzzingPhase.RUNNING:
            return

        if max_cases is not None:
            self.max_cases = max_cases
        if cases_per_message is not None:
            self.cases_per_message = cases_per_message
        if delay is not None:
            self.delay_between_cases = delay

        self.phase = FuzzingPhase.RUNNING
        self._stop_event.clear()
        self._stats["start_time"] = time.time()

        def fuzz_worker():
            case_id = 0
            try:
                while not self._stop_event.is_set() and case_id < self.max_cases:
                    for msg_type in self.message_templates:
                        if self._stop_event.is_set() or case_id >= self.max_cases:
                            break

                        for _ in range(self.cases_per_message):
                            if self._stop_event.is_set() or case_id >= self.max_cases:
                                break

                            case = self._generate_case(case_id, msg_type)
                            self._run_case(case)
                            case_id += 1

                            time.sleep(self.delay_between_cases)

            except Exception as e:
                print(f"Fuzzing error: {e}")
                self.phase = FuzzingPhase.ERROR
            finally:
                self._disconnect()
                if self.phase == FuzzingPhase.RUNNING:
                    self.phase = FuzzingPhase.COMPLETED
                self._stats["end_time"] = time.time()

        self._fuzz_thread = threading.Thread(target=fuzz_worker, daemon=True)
        self._fuzz_thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        if self._fuzz_thread:
            self._fuzz_thread.join(timeout=5)
        self._disconnect()
        if self.phase == FuzzingPhase.RUNNING:
            self.phase = FuzzingPhase.PAUSED

    def wait_for_completion(self) -> None:
        if self._fuzz_thread:
            self._fuzz_thread.join()

    def get_stats(self) -> Dict:
        stats = dict(self._stats)
        if stats["start_time"]:
            elapsed = (stats["end_time"] or time.time()) - stats["start_time"]
            stats["elapsed_time"] = elapsed
            if stats["total_cases"] > 0:
                stats["cases_per_second"] = stats["total_cases"] / elapsed

        stats["phase"] = self.phase.value
        stats["queue_size"] = self.max_cases - self._stats["total_cases"]
        stats["unique_crashes"] = len({c.mutated_data for c in self.crash_cases})
        stats["coverage_guided"] = self.coverage_guided

        return stats

    def get_coverage_report(self) -> Dict:
        if not self._coverage_fuzzer:
            return {"coverage_guided": False}
        return self._coverage_fuzzer.get_coverage_report()

    def export_coverage(self, output_file: str) -> None:
        if self._coverage_fuzzer:
            self._coverage_fuzzer.export_coverage(output_file)

    def get_crash_samples(self, limit: int = 10) -> List[Dict]:
        unique_crashes = {}
        for case in self.crash_cases:
            key = case.mutated_data
            if key not in unique_crashes:
                unique_crashes[key] = case

        return [case.to_dict() for case in
                list(unique_crashes.values())[:limit]]

    def get_crash_sequences(self) -> List[List[Dict]]:
        sequences = []
        for i, crash in enumerate(self.crash_cases[:10]):
            sequence = []
            start_idx = max(0, crash.case_id - 5)
            for case in self.fuzz_cases[start_idx:crash.case_id + 1]:
                sequence.append(case.to_dict())
            sequences.append(sequence)
        return sequences
