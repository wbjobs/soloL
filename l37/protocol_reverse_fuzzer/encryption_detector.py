import math
import struct
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass, field
from enum import Enum
from collections import Counter
import numpy as np


class EncryptionConfidence(Enum):
    NONE = "none"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    VERY_HIGH = "very_high"


@dataclass
class EncryptionCheckResult:
    is_encrypted: bool
    confidence: EncryptionConfidence
    score: float
    details: Dict = field(default_factory=dict)
    recommendation: str = ""

    def to_dict(self) -> Dict:
        return {
            "is_encrypted": self.is_encrypted,
            "confidence": self.confidence.value,
            "score": round(self.score, 4),
            "details": {k: round(v, 4) if isinstance(v, float) else v
                        for k, v in self.details.items()},
            "recommendation": self.recommendation
        }


def chi_square_test(data: bytes) -> float:
    if not data:
        return 0.0

    observed = Counter(data)
    expected = len(data) / 256.0

    chi_sq = 0.0
    for byte_val in range(256):
        obs = observed.get(byte_val, 0)
        chi_sq += (obs - expected) ** 2 / expected if expected > 0 else 0

    return chi_sq


def chi_square_p_value(chi_sq: float, df: int = 255) -> float:
    if df <= 0:
        return 1.0

    try:
        from scipy.stats import chi2
        return chi2.sf(chi_sq, df)
    except ImportError:
        pass

    x = chi_sq / 2.0
    k = df / 2.0

    if x < k + 1:
        result = 1.0
        term = 1.0
        for i in range(1, int(k)):
            term *= x / i
            result += term
        result *= math.exp(-x)
    else:
        result = 0.0
        term = 1.0
        for i in range(1, int(k)):
            term *= (x - k + i) / i
            result += term
        result *= math.exp(-x + k * math.log(x) - _log_gamma(k))

    return max(0.0, min(1.0, result))


def _log_gamma(x: float) -> float:
    coefficients = [
        76.18009172947146,
        -86.50532032941677,
        24.01409824083091,
        -1.231739572450155,
        0.1208650973866179e-2,
        -0.5395239384953e-5
    ]

    y = x
    tmp = x + 5.5
    tmp -= (x + 0.5) * math.log(tmp)
    ser = 1.000000000190015

    for c in coefficients:
        y += 1
        ser += c / y

    return -tmp + math.log(2.5066282746310005 * ser / x)


def runs_test(data: bytes) -> Tuple[float, float]:
    if len(data) < 2:
        return 0.0, 1.0

    median_val = sorted(data)[len(data) // 2]

    runs = 1
    for i in range(1, len(data)):
        if (data[i] >= median_val) != (data[i - 1] >= median_val):
            runs += 1

    n1 = sum(1 for b in data if b >= median_val)
    n2 = len(data) - n1

    if n1 == 0 or n2 == 0:
        return 0.0, 0.0

    expected_runs = 1 + (2 * n1 * n2) / (n1 + n2)
    variance_runs = (2 * n1 * n2 * (2 * n1 * n2 - n1 - n2)) / \
                    ((n1 + n2) ** 2 * (n1 + n2 - 1))

    if variance_runs <= 0:
        return float(runs), 1.0

    z_score = (runs - expected_runs) / math.sqrt(variance_runs)

    p_value = 2.0 * (1.0 - _normal_cdf(abs(z_score)))

    return z_score, p_value


def _normal_cdf(x: float) -> float:
    a1 = 0.254829592
    a2 = -0.284496736
    a3 = 1.421413741
    a4 = -1.453152027
    a5 = 1.061405429
    p = 0.3275911

    sign = 1 if x >= 0 else -1
    x = abs(x) / math.sqrt(2.0)

    t = 1.0 / (1.0 + p * x)
    y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * math.exp(-x * x)

    return 0.5 * (1.0 + sign * y)


def byte_frequency_test(data: bytes) -> float:
    if not data:
        return 0.0

    freq = Counter(data)
    total = len(data)

    uniform_diff = 0.0
    for byte_val in range(256):
        expected = 1.0 / 256.0
        actual = freq.get(byte_val, 0) / total
        uniform_diff += abs(actual - expected)

    return uniform_diff / 2.0


def serial_correlation_test(data: bytes) -> float:
    if len(data) < 3:
        return 0.0

    n = len(data)
    mean = sum(data) / n

    numerator = 0.0
    denominator = 0.0

    for i in range(n - 1):
        numerator += (data[i] - mean) * (data[i + 1] - mean)

    for i in range(n):
        denominator += (data[i] - mean) ** 2

    if denominator == 0:
        return 0.0

    correlation = numerator / denominator

    return max(-1.0, min(1.0, correlation))


def entropy_test(data: bytes) -> float:
    if not data:
        return 0.0

    freq = Counter(data)
    total = len(data)

    entropy = 0.0
    for count in freq.values():
        if count > 0:
            p = count / total
            entropy -= p * math.log2(p)

    return entropy


def compression_test(data: bytes) -> float:
    if len(data) < 16:
        return 0.0

    try:
        import zlib
        compressed = zlib.compress(data, 9)
        ratio = len(compressed) / len(data)
        return ratio
    except Exception:
        return 1.0


def monobit_test(data: bytes) -> Tuple[float, float]:
    if not data:
        return 0.0, 1.0

    n = len(data) * 8
    s = 0
    for byte_val in data:
        for bit_pos in range(8):
            if byte_val & (1 << bit_pos):
                s += 1
            else:
                s -= 1

    s_obs = abs(s) / math.sqrt(n)
    p_value = math.erfc(s_obs / math.sqrt(2))

    return s_obs, p_value


def approximate_entropy_test(data: bytes, block_len: int = 2) -> float:
    if len(data) < block_len + 1:
        return 1.0

    n = len(data)

    def count_blocks(m):
        counts = Counter()
        for i in range(n):
            block = 0
            for j in range(m):
                byte_idx = (i + j) % n
                bit_idx = 0
                block = (block << 1) | ((data[byte_idx] >> (7 - bit_idx)) & 1)
            counts[block] += 1
        return counts

    try:
        counts_m = count_blocks(block_len)
        counts_m1 = count_blocks(block_len + 1)

        phi_m = 0.0
        total_m = sum(counts_m.values())
        if total_m > 0:
            for c in counts_m.values():
                if c > 0:
                    phi_m += (c / total_m) * math.log(c / total_m)

        phi_m1 = 0.0
        total_m1 = sum(counts_m1.values())
        if total_m1 > 0:
            for c in counts_m1.values():
                if c > 0:
                    phi_m1 += (c / total_m1) * math.log(c / total_m1)

        ap_en = phi_m - phi_m1
        chi_sq = 2.0 * n * (math.log(2) - ap_en)

        return chi_sq
    except Exception:
        return 0.0


class EncryptionDetector:
    def __init__(self,
                 entropy_threshold: float = 7.5,
                 chi_square_alpha: float = 0.05,
                 correlation_threshold: float = 0.1,
                 compression_threshold: float = 1.0,
                 min_sample_size: int = 64):
        self.entropy_threshold = entropy_threshold
        self.chi_square_alpha = chi_square_alpha
        self.correlation_threshold = correlation_threshold
        self.compression_threshold = compression_threshold
        self.min_sample_size = min_sample_size

    def check_encryption(self, data: bytes) -> EncryptionCheckResult:
        if len(data) < self.min_sample_size:
            return EncryptionCheckResult(
                is_encrypted=False,
                confidence=EncryptionConfidence.NONE,
                score=0.0,
                details={"reason": "insufficient_data", "data_length": len(data)},
                recommendation="Need more data to assess encryption"
            )

        details = {}

        ent = entropy_test(data)
        details["entropy"] = ent
        details["entropy_ratio"] = ent / 8.0

        chi_sq = chi_square_test(data)
        details["chi_square"] = chi_sq
        details["chi_square_df"] = 255

        z_score, runs_p = runs_test(data)
        details["runs_z_score"] = z_score
        details["runs_p_value"] = runs_p

        freq_diff = byte_frequency_test(data)
        details["byte_frequency_diff"] = freq_diff

        correlation = serial_correlation_test(data)
        details["serial_correlation"] = correlation

        comp_ratio = compression_test(data)
        details["compression_ratio"] = comp_ratio

        mono_obs, mono_p = monobit_test(data)
        details["monobit_s_obs"] = mono_obs
        details["monobit_p_value"] = mono_p

        scores = []

        if ent > self.entropy_threshold:
            scores.append(1.0)
        elif ent > 7.0:
            scores.append((ent - 7.0) / (self.entropy_threshold - 7.0))
        else:
            scores.append(0.0)

        if chi_sq < 200:
            scores.append(1.0)
        elif chi_sq < 300:
            scores.append(0.8)
        elif chi_sq < 400:
            scores.append(0.5)
        else:
            scores.append(0.0)

        if freq_diff < 0.05:
            scores.append(1.0)
        elif freq_diff < 0.1:
            scores.append(0.6)
        elif freq_diff < 0.2:
            scores.append(0.3)
        else:
            scores.append(0.0)

        if abs(correlation) < self.correlation_threshold:
            scores.append(1.0)
        elif abs(correlation) < 0.2:
            scores.append(0.5)
        else:
            scores.append(0.0)

        if comp_ratio >= self.compression_threshold:
            scores.append(1.0)
        elif comp_ratio > 0.9:
            scores.append(0.7)
        elif comp_ratio > 0.7:
            scores.append(0.3)
        else:
            scores.append(0.0)

        if mono_p > 0.5:
            scores.append(1.0)
        elif mono_p > 0.1:
            scores.append(0.5)
        else:
            scores.append(0.0)

        if runs_p > 0.3:
            scores.append(0.8)
        elif runs_p > 0.05:
            scores.append(0.3)
        else:
            scores.append(0.0)

        weights = [0.25, 0.20, 0.15, 0.10, 0.15, 0.08, 0.07]
        final_score = sum(s * w for s, w in zip(scores, weights))

        if final_score >= 0.85:
            confidence = EncryptionConfidence.VERY_HIGH
            is_encrypted = True
            recommendation = ("Very likely encrypted traffic. Skip protocol inference or "
                              "provide decryption key. TLS/SSL detected.")
        elif final_score >= 0.65:
            confidence = EncryptionConfidence.HIGH
            is_encrypted = True
            recommendation = ("Likely encrypted traffic. Consider skipping this stream "
                              "or providing decryption key.")
        elif final_score >= 0.45:
            confidence = EncryptionConfidence.MEDIUM
            is_encrypted = True
            recommendation = ("Possibly encrypted or compressed. Partial inference may work. "
                              "Consider providing decryption key.")
        elif final_score >= 0.25:
            confidence = EncryptionConfidence.LOW
            is_encrypted = False
            recommendation = ("Low encryption probability. May contain compressed data "
                              "or high-entropy binary fields. Proceed with caution.")
        else:
            confidence = EncryptionConfidence.NONE
            is_encrypted = False
            recommendation = "Traffic does not appear to be encrypted. Safe to proceed."

        return EncryptionCheckResult(
            is_encrypted=is_encrypted,
            confidence=confidence,
            score=final_score,
            details=details,
            recommendation=recommendation
        )

    def check_packets(self, packets: List[bytes]) -> Dict[int, EncryptionCheckResult]:
        results = {}
        for i, pkt in enumerate(packets):
            results[i] = self.check_encryption(pkt)
        return results

    def check_cluster(self, packets: List[bytes]) -> EncryptionCheckResult:
        if not packets:
            return EncryptionCheckResult(
                is_encrypted=False,
                confidence=EncryptionConfidence.NONE,
                score=0.0,
                details={"reason": "empty_cluster"}
            )

        combined = b"".join(packets)
        result = self.check_encryption(combined)

        individual_results = self.check_packets(packets)
        encrypted_count = sum(1 for r in individual_results.values() if r.is_encrypted)
        encryption_ratio = encrypted_count / len(packets)

        result.details["cluster_size"] = len(packets)
        result.details["encrypted_packet_ratio"] = round(encryption_ratio, 4)

        if encryption_ratio > 0.7 and not result.is_encrypted:
            result.is_encrypted = True
            result.confidence = EncryptionConfidence.MEDIUM
            result.score = max(result.score, 0.5)
            result.recommendation = ("Majority of packets appear encrypted. "
                                     "Consider providing decryption key.")

        return result

    def filter_encrypted(self, packets: List[bytes],
                         skip_encrypted: bool = True
                         ) -> Tuple[List[bytes], List[EncryptionCheckResult]]:
        results = self.check_packets(packets)

        if skip_encrypted:
            filtered = [pkt for pkt, r in zip(packets, results.values())
                        if not r.is_encrypted]
        else:
            filtered = list(packets)

        return filtered, list(results.values())

    def detect_tls_handshake(self, data: bytes) -> Optional[Dict]:
        if len(data) < 5:
            return None

        if data[0] in [0x16, 0x14, 0x15, 0x17]:
            if len(data) >= 2 and data[1] == 0x03:
                version_map = {
                    0x01: "TLS 1.0",
                    0x02: "TLS 1.1",
                    0x03: "TLS 1.2",
                    0x04: "TLS 1.3"
                }
                version = version_map.get(data[2], f"Unknown (0x{data[2]:02x})")
                content_type_map = {
                    0x14: "ChangeCipherSpec",
                    0x15: "Alert",
                    0x16: "Handshake",
                    0x17: "Application Data"
                }
                content_type = content_type_map.get(data[0], "Unknown")
                length = struct.unpack('>H', data[3:5])[0] if len(data) >= 5 else 0

                return {
                    "is_tls": True,
                    "content_type": content_type,
                    "version": version,
                    "length": length,
                    "is_application_data": data[0] == 0x17
                }

        return None
