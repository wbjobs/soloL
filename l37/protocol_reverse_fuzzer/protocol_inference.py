import numpy as np
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass, field
from collections import Counter
import math
import warnings

warnings.filterwarnings('ignore')


@dataclass
class Field:
    name: str
    offset: int
    length: int
    field_type: str
    entropy: float
    values: List[bytes] = field(default_factory=list)
    description: str = ""
    is_fixed: bool = False
    is_length: bool = False
    is_checksum: bool = False

    def to_dict(self) -> Dict:
        return {
            "name": self.name,
            "offset": self.offset,
            "length": self.length,
            "type": self.field_type,
            "entropy": round(self.entropy, 4),
            "is_fixed": self.is_fixed,
            "is_length": self.is_length,
            "is_checksum": self.is_checksum,
            "unique_values": len(set(self.values)),
            "sample_values": [v.hex() for v in self.values[:5]]
        }


def calculate_byte_entropy(values: List[int]) -> float:
    if not values:
        return 0.0

    counts = Counter(values)
    total = len(values)
    entropy = 0.0

    for count in counts.values():
        if count > 0:
            p = count / total
            entropy -= p * math.log2(p)

    return entropy


def sliding_window_entropy(data: bytes, window_size: int = 4) -> np.ndarray:
    n = len(data)
    entropies = np.zeros(n)

    for i in range(n):
        start = max(0, i - window_size // 2)
        end = min(n, i + window_size // 2 + 1)
        window = list(data[start:end])
        entropies[i] = calculate_byte_entropy(window)

    return entropies


def multiple_sequence_alignment(packets: List[bytes]) -> np.ndarray:
    if not packets:
        return np.array([])

    max_len = max(len(p) for p in packets)
    n = len(packets)
    aligned = np.full((n, max_len), -1, dtype=int)

    for i, pkt in enumerate(packets):
        for j, b in enumerate(pkt):
            aligned[i, j] = b

    return aligned


def calculate_position_entropies(aligned: np.ndarray) -> np.ndarray:
    if aligned.size == 0:
        return np.array([])

    n_positions = aligned.shape[1]
    entropies = np.zeros(n_positions)

    for pos in range(n_positions):
        values = aligned[:, pos]
        valid_values = values[values != -1]
        if len(valid_values) > 0:
            entropies[pos] = calculate_byte_entropy(valid_values.tolist())
        else:
            entropies[pos] = 0.0

    return entropies


def detect_boundaries_from_entropy(entropies: np.ndarray,
                                    threshold: float = 0.5,
                                    min_field_length: int = 1,
                                    max_field_length: int = 64) -> List[Tuple[int, int]]:
    if len(entropies) == 0:
        return []

    boundaries = []
    n = len(entropies)
    i = 0

    while i < n:
        if np.isnan(entropies[i]):
            i += 1
            continue

        current_entropy = entropies[i]
        j = i + 1

        while j < n and not np.isnan(entropies[j]):
            diff = abs(entropies[j] - current_entropy)
            if diff > threshold:
                break

            field_len = j - i + 1
            if field_len >= max_field_length:
                break

            j += 1

        field_len = j - i
        if field_len >= min_field_length:
            boundaries.append((i, field_len))

        i = j

    return boundaries


def analyze_field_type(aligned: np.ndarray, offset: int, length: int,
                        entropies: np.ndarray) -> Tuple[str, bool, bool, bool]:
    if aligned.size == 0 or offset >= aligned.shape[1]:
        return "unknown", False, False, False

    values = []
    for row in range(aligned.shape[0]):
        field_bytes = []
        for pos in range(offset, min(offset + length, aligned.shape[1])):
            if aligned[row, pos] != -1:
                field_bytes.append(aligned[row, pos])
        if field_bytes:
            values.append(bytes(field_bytes))

    if not values:
        return "unknown", False, False, False

    unique_values = set(values)
    is_fixed = len(unique_values) == 1

    avg_entropy = np.mean(entropies[offset:offset + length])

    field_type = "unknown"
    is_length = False
    is_checksum = False

    if is_fixed:
        field_type = "constant"
    elif avg_entropy < 0.3:
        field_type = "low_entropy"
        if all(len(v) in [1, 2, 4, 8] for v in values):
            numeric_values = []
            for v in values:
                try:
                    if len(v) == 1:
                        numeric_values.append(int.from_bytes(v, 'big'))
                    elif len(v) == 2:
                        numeric_values.append(int.from_bytes(v, 'big'))
                    elif len(v) == 4:
                        numeric_values.append(int.from_bytes(v, 'big'))
                except:
                    pass

            if numeric_values:
                total_packets = aligned.shape[0]
                if all(nv <= total_packets * 2 for nv in numeric_values):
                    if any(nv > 0 for nv in numeric_values):
                        is_length = True
                        field_type = "length"

    elif avg_entropy > 6.0:
        field_type = "encrypted_or_compressed"
        if length in [2, 4]:
            is_checksum = True
            field_type = "checksum"
    elif avg_entropy > 4.0:
        field_type = "high_entropy_data"
    else:
        is_ascii = True
        for v in values:
            for b in v:
                if not (32 <= b < 127 or b in [9, 10, 13]):
                    is_ascii = False
                    break
            if not is_ascii:
                break

        if is_ascii:
            field_type = "ascii_string"
        else:
            field_type = "binary_data"

    return field_type, is_fixed, is_length, is_checksum


def infer_field_names(fields: List[Field]) -> None:
    type_counters = {}
    for field in fields:
        prefix = field.field_type
        if prefix not in type_counters:
            type_counters[prefix] = 0
        type_counters[prefix] += 1

        if field.is_fixed:
            name = f"fixed_{field.offset:04x}"
        elif field.is_length:
            name = f"length_{field.offset:04x}"
        elif field.is_checksum:
            name = f"checksum_{field.offset:04x}"
        else:
            name = f"{prefix}_{type_counters[prefix]:02d}"

        field.name = name


class ProtocolInference:
    def __init__(self, entropy_threshold: float = 0.5,
                 min_field_length: int = 1,
                 max_field_length: int = 64,
                 skip_encrypted: bool = True,
                 encryption_threshold: float = 0.65):
        self.entropy_threshold = entropy_threshold
        self.min_field_length = min_field_length
        self.max_field_length = max_field_length
        self.skip_encrypted = skip_encrypted
        self.encryption_threshold = encryption_threshold
        self.fields: List[Field] = []
        self.aligned_packets: np.ndarray = np.array([])
        self.position_entropies: np.ndarray = np.array([])
        self._encryption_warnings: List[Dict] = []
        self._encrypted_clusters: List[int] = []

    def check_encryption(self, packets: List[bytes]) -> Dict:
        from .encryption_detector import EncryptionDetector
        detector = EncryptionDetector()
        result = detector.check_cluster(packets)
        return result.to_dict()

    def get_encryption_warnings(self) -> List[Dict]:
        return self._encryption_warnings

    def infer(self, packets: List[bytes], cluster_id: int = 0) -> List[Field]:
        self.fields = []
        self._encryption_warnings = []

        if len(packets) == 0:
            return self.fields

        if self.skip_encrypted:
            from .encryption_detector import EncryptionDetector
            detector = EncryptionDetector()
            enc_result = detector.check_cluster(packets)

            if enc_result.is_encrypted:
                warning = {
                    "cluster_id": cluster_id,
                    "encryption_score": enc_result.score,
                    "confidence": enc_result.confidence.value,
                    "recommendation": enc_result.recommendation,
                    "details": enc_result.details
                }
                self._encryption_warnings.append(warning)
                self._encrypted_clusters.append(cluster_id)

                tls_info = detector.detect_tls_handshake(
                    packets[0] if packets else b""
                )
                if tls_info:
                    warning["tls_detected"] = tls_info

                print(f"  [!] Cluster {cluster_id}: Encrypted traffic detected "
                      f"(score={enc_result.score:.3f}, "
                      f"confidence={enc_result.confidence.value})")
                print(f"      {enc_result.recommendation}")
                print(f"      Skipping protocol inference for this cluster.")

                encrypted_field = Field(
                    name="encrypted_payload",
                    offset=0,
                    length=max(len(p) for p in packets) if packets else 0,
                    field_type="encrypted",
                    entropy=8.0,
                    values=[b"[ENCRYPTED]"],
                    description=enc_result.recommendation,
                    is_fixed=False,
                    is_length=False,
                    is_checksum=False
                )
                self.fields.append(encrypted_field)
                return self.fields

        if len(packets) == 1:
            return self._infer_single_packet(packets[0])

        self.aligned_packets = multiple_sequence_alignment(packets)
        self.position_entropies = calculate_position_entropies(self.aligned_packets)

        boundaries = detect_boundaries_from_entropy(
            self.position_entropies,
            threshold=self.entropy_threshold,
            min_field_length=self.min_field_length,
            max_field_length=self.max_field_length
        )

        for offset, length in boundaries:
            field_type, is_fixed, is_length, is_checksum = analyze_field_type(
                self.aligned_packets, offset, length, self.position_entropies
            )

            avg_entropy = np.mean(self.position_entropies[offset:offset + length])

            values = []
            for row in range(self.aligned_packets.shape[0]):
                field_bytes = []
                for pos in range(offset, min(offset + length, self.aligned_packets.shape[1])):
                    if self.aligned_packets[row, pos] != -1:
                        field_bytes.append(self.aligned_packets[row, pos])
                if field_bytes:
                    values.append(bytes(field_bytes))

            field = Field(
                name=f"field_{offset:04x}",
                offset=offset,
                length=length,
                field_type=field_type,
                entropy=avg_entropy,
                values=values,
                is_fixed=is_fixed,
                is_length=is_length,
                is_checksum=is_checksum
            )

            if field_type == "low_entropy" and not is_fixed and not is_length:
                sub_fields = self._attempt_subfield_division(offset, length)
                if sub_fields and len(sub_fields) > 1:
                    self.fields.extend(sub_fields)
                    continue

            self.fields.append(field)

        infer_field_names(self.fields)
        self._refine_length_fields()

        return self.fields

    def _infer_single_packet(self, packet: bytes) -> List[Field]:
        entropies = sliding_window_entropy(packet, window_size=4)

        boundaries = detect_boundaries_from_entropy(
            entropies,
            threshold=self.entropy_threshold,
            min_field_length=self.min_field_length,
            max_field_length=self.max_field_length
        )

        for offset, length in boundaries:
            field_bytes = packet[offset:offset + length]
            avg_entropy = np.mean(entropies[offset:offset + length])

            is_ascii = all(32 <= b < 127 or b in [9, 10, 13] for b in field_bytes)

            if is_ascii:
                field_type = "ascii_string"
            elif length in [1, 2, 4, 8] and len(set(field_bytes)) == 1:
                field_type = "constant"
            elif avg_entropy > 6.0:
                field_type = "high_entropy_data"
            else:
                field_type = "binary_data"

            field = Field(
                name=f"field_{offset:04x}",
                offset=offset,
                length=length,
                field_type=field_type,
                entropy=avg_entropy,
                values=[field_bytes],
                is_fixed=len(set(field_bytes)) == 1
            )
            self.fields.append(field)

        infer_field_names(self.fields)
        return self.fields

    def _attempt_subfield_division(self, offset: int, length: int) -> List[Field]:
        if length < 4:
            return []

        sub_entropies = self.position_entropies[offset:offset + length]
        local_maxima = []

        for i in range(2, length - 2):
            if (sub_entropies[i] > sub_entropies[i - 1] and
                sub_entropies[i] > sub_entropies[i + 1] and
                sub_entropies[i] > self.entropy_threshold * 1.5):
                local_maxima.append(i)

        if not local_maxima or len(local_maxima) >= length // 2:
            return []

        sub_fields = []
        current_offset = offset

        for boundary in sorted(local_maxima):
            sub_length = offset + boundary - current_offset
            if sub_length >= self.min_field_length:
                field_type, is_fixed, is_length, is_checksum = analyze_field_type(
                    self.aligned_packets, current_offset, sub_length, self.position_entropies
                )

                avg_entropy = np.mean(
                    self.position_entropies[current_offset:current_offset + sub_length]
                )

                values = []
                for row in range(self.aligned_packets.shape[0]):
                    field_bytes = []
                    for pos in range(current_offset,
                                     min(current_offset + sub_length,
                                         self.aligned_packets.shape[1])):
                        if self.aligned_packets[row, pos] != -1:
                            field_bytes.append(self.aligned_packets[row, pos])
                    if field_bytes:
                        values.append(bytes(field_bytes))

                field = Field(
                    name=f"field_{current_offset:04x}",
                    offset=current_offset,
                    length=sub_length,
                    field_type=field_type,
                    entropy=avg_entropy,
                    values=values,
                    is_fixed=is_fixed,
                    is_length=is_length,
                    is_checksum=is_checksum
                )
                sub_fields.append(field)

            current_offset = offset + boundary

        if current_offset < offset + length:
            sub_length = offset + length - current_offset
            if sub_length >= self.min_field_length:
                field_type, is_fixed, is_length, is_checksum = analyze_field_type(
                    self.aligned_packets, current_offset, sub_length, self.position_entropies
                )

                avg_entropy = np.mean(
                    self.position_entropies[current_offset:current_offset + sub_length]
                )

                values = []
                for row in range(self.aligned_packets.shape[0]):
                    field_bytes = []
                    for pos in range(current_offset,
                                     min(current_offset + sub_length,
                                         self.aligned_packets.shape[1])):
                        if self.aligned_packets[row, pos] != -1:
                            field_bytes.append(self.aligned_packets[row, pos])
                    if field_bytes:
                        values.append(bytes(field_bytes))

                field = Field(
                    name=f"field_{current_offset:04x}",
                    offset=current_offset,
                    length=sub_length,
                    field_type=field_type,
                    entropy=avg_entropy,
                    values=values,
                    is_fixed=is_fixed,
                    is_length=is_length,
                    is_checksum=is_checksum
                )
                sub_fields.append(field)

        return sub_fields

    def _refine_length_fields(self) -> None:
        for i, field in enumerate(self.fields):
            if field.is_length and i + 1 < len(self.fields):
                next_field = self.fields[i + 1]
                numeric_values = []
                for v in field.values:
                    try:
                        if len(v) == 1:
                            numeric_values.append(int.from_bytes(v, 'big'))
                        elif len(v) == 2:
                            numeric_values.append(int.from_bytes(v, 'big'))
                        elif len(v) == 4:
                            numeric_values.append(int.from_bytes(v, 'big'))
                    except:
                        pass

                if numeric_values:
                    avg_length_val = np.mean(numeric_values)
                    if abs(avg_length_val - next_field.length) <= 4:
                        field.description = f"Specifies length of {next_field.name}"
                        next_field.description = f"Length specified by {field.name}"

    def get_entropy_profile(self) -> Dict:
        if self.position_entropies.size == 0:
            return {}

        return {
            "positions": list(range(len(self.position_entropies))),
            "entropies": [round(e, 4) for e in self.position_entropies.tolist()],
            "average_entropy": round(np.mean(self.position_entropies), 4),
            "max_entropy": round(np.max(self.position_entropies), 4),
            "min_entropy": round(np.min(self.position_entropies), 4)
        }

    def get_fields_summary(self) -> List[Dict]:
        return [field.to_dict() for field in self.fields]

    def visualize_fields(self, representative_packet: bytes) -> str:
        if not self.fields:
            return "No fields inferred"

        hex_str = representative_packet.hex()
        visualization = []
        current_pos = 0

        for field in sorted(self.fields, key=lambda f: f.offset):
            if field.offset > current_pos:
                gap_hex = hex_str[current_pos * 2:field.offset * 2]
                visualization.append(f"[GAP: {gap_hex}]")

            field_hex = hex_str[field.offset * 2:(field.offset + field.length) * 2]
            marker = ""
            if field.is_fixed:
                marker = "[FIXED]"
            elif field.is_length:
                marker = "[LEN]"
            elif field.is_checksum:
                marker = "[CHK]"

            visualization.append(
                f"[{field.name}@{field.offset}:{field.length}{marker}] {field_hex}"
            )
            current_pos = field.offset + field.length

        if current_pos < len(representative_packet):
            gap_hex = hex_str[current_pos * 2:]
            visualization.append(f"[TRAILER: {gap_hex}]")

        return "\n".join(visualization)
