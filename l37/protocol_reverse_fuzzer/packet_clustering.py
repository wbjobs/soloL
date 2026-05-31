import numpy as np
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass, field
from collections import defaultdict
import warnings

warnings.filterwarnings('ignore')

try:
    from sklearn.cluster import DBSCAN as SklearnDBSCAN
    from sklearn.preprocessing import StandardScaler
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False


@dataclass
class Cluster:
    cluster_id: int
    packets: List[bytes] = field(default_factory=list)
    representative: bytes = b""
    packet_indices: List[int] = field(default_factory=list)

    def add_packet(self, packet: bytes, index: int) -> None:
        self.packets.append(packet)
        self.packet_indices.append(index)
        if len(self.packets) == 1:
            self.representative = packet


def hamming_distance(a: bytes, b: bytes) -> float:
    min_len = min(len(a), len(b))
    max_len = max(len(a), len(b))
    if max_len == 0:
        return 0.0

    distance = sum(1 for i in range(min_len) if a[i] != b[i])
    distance += (max_len - min_len) * 2

    return distance / max_len


def levenshtein_distance(a: bytes, b: bytes) -> float:
    m, n = len(a), len(b)
    max_len = max(m, n)
    if max_len == 0:
        return 0.0

    if m < n:
        return levenshtein_distance(b, a)
    if n == 0:
        return 1.0

    previous_row = list(range(n + 1))
    for i, c1 in enumerate(a):
        current_row = [i + 1]
        for j, c2 in enumerate(b):
            insertions = previous_row[j + 1] + 1
            deletions = current_row[j] + 1
            substitutions = previous_row[j] + (c1 != c2)
            current_row.append(min(insertions, deletions, substitutions))
        previous_row = current_row

    return previous_row[-1] / max_len


def extract_n_gram_features(packet: bytes, n: int = 2) -> np.ndarray:
    if len(packet) < n:
        return np.zeros(256 ** n, dtype=np.float32)

    feature_dim = 256 ** n
    features = np.zeros(feature_dim, dtype=np.float32)

    for i in range(len(packet) - n + 1):
        idx = 0
        for j in range(n):
            idx = idx * 256 + packet[i + j]
        if idx < feature_dim:
            features[idx] += 1

    if np.sum(features) > 0:
        features = features / np.sum(features)

    return features


def extract_length_normalized_features(packet: bytes, max_len: int = 256) -> np.ndarray:
    features = np.zeros(max_len * 257, dtype=np.float32)

    for i, b in enumerate(packet):
        if i >= max_len:
            break
        features[i * 257 + b] = 1.0

    if len(packet) < max_len:
        for i in range(len(packet), max_len):
            features[i * 257 + 256] = 1.0

    return features


def pairwise_distance_matrix(packets: List[bytes], metric: str = "hamming") -> np.ndarray:
    n = len(packets)
    dist_matrix = np.zeros((n, n), dtype=np.float64)

    for i in range(n):
        for j in range(i + 1, n):
            if metric == "hamming":
                d = hamming_distance(packets[i], packets[j])
            elif metric == "levenshtein":
                d = levenshtein_distance(packets[i], packets[j])
            else:
                d = hamming_distance(packets[i], packets[j])

            dist_matrix[i, j] = d
            dist_matrix[j, i] = d

    return dist_matrix


class DBSCAN:
    def __init__(self, eps: float = 0.3, min_samples: int = 3, metric: str = "hamming"):
        self.eps = eps
        self.min_samples = min_samples
        self.metric = metric
        self.labels_: Optional[np.ndarray] = None
        self.core_sample_indices_: List[int] = []

    def fit(self, packets: List[bytes]) -> None:
        n = len(packets)
        if n == 0:
            self.labels_ = np.array([])
            return

        dist_matrix = pairwise_distance_matrix(packets, self.metric)
        self._dbscan_from_matrix(dist_matrix, n)

    def _dbscan_from_matrix(self, dist_matrix: np.ndarray, n: int) -> None:
        labels = np.full(n, -1, dtype=int)
        visited = np.zeros(n, dtype=bool)
        cluster_id = 0

        for i in range(n):
            if visited[i]:
                continue
            visited[i] = True

            neighbors = np.where(dist_matrix[i] <= self.eps)[0]

            if len(neighbors) < self.min_samples:
                labels[i] = -1
            else:
                self.core_sample_indices_.append(i)
                self._expand_cluster(
                    dist_matrix, labels, visited, i, neighbors, cluster_id
                )
                cluster_id += 1

        self.labels_ = labels

    def _expand_cluster(self, dist_matrix: np.ndarray, labels: np.ndarray,
                        visited: np.ndarray, point_idx: int,
                        neighbors: np.ndarray, cluster_id: int) -> None:
        labels[point_idx] = cluster_id

        i = 0
        while i < len(neighbors):
            neighbor = neighbors[i]

            if not visited[neighbor]:
                visited[neighbor] = True
                new_neighbors = np.where(dist_matrix[neighbor] <= self.eps)[0]

                if len(new_neighbors) >= self.min_samples:
                    self.core_sample_indices_.append(neighbor)
                    neighbors = np.concatenate([neighbors, new_neighbors])

            if labels[neighbor] == -1:
                labels[neighbor] = cluster_id

            i += 1


class PacketClustering:
    def __init__(self, eps: float = 0.3, min_samples: int = 3,
                 metric: str = "hamming", use_sklearn: bool = True):
        self.eps = eps
        self.min_samples = min_samples
        self.metric = metric
        self.use_sklearn = use_sklearn and SKLEARN_AVAILABLE
        self.clusters: Dict[int, Cluster] = {}
        self.labels_: Optional[np.ndarray] = None
        self.packets: List[bytes] = []

    def cluster(self, packets: List[bytes]) -> Dict[int, Cluster]:
        self.packets = packets
        self.clusters = {}

        if len(packets) == 0:
            return self.clusters

        if self.use_sklearn:
            self._cluster_sklearn(packets)
        else:
            self._cluster_custom(packets)

        self._build_clusters(packets)
        return self.clusters

    def _cluster_sklearn(self, packets: List[bytes]) -> None:
        features = []
        for pkt in packets:
            feat = extract_n_gram_features(pkt, n=2)
            features.append(feat)

        X = np.array(features)
        if X.shape[0] > 0 and X.shape[1] > 0:
            scaler = StandardScaler()
            X = scaler.fit_transform(X)

        dbscan = SklearnDBSCAN(eps=self.eps * 10, min_samples=self.min_samples, metric='euclidean')
        self.labels_ = dbscan.fit_predict(X)

    def _cluster_custom(self, packets: List[bytes]) -> None:
        dbscan = DBSCAN(eps=self.eps, min_samples=self.min_samples, metric=self.metric)
        dbscan.fit(packets)
        self.labels_ = dbscan.labels_
        self.core_sample_indices_ = dbscan.core_sample_indices_

    def _build_clusters(self, packets: List[bytes]) -> None:
        if self.labels_ is None:
            return

        for idx, label in enumerate(self.labels_):
            if label not in self.clusters:
                self.clusters[label] = Cluster(cluster_id=label)
            self.clusters[label].add_packet(packets[idx], idx)

        for cluster in self.clusters.values():
            if len(cluster.packets) > 0:
                cluster.representative = self._find_representative(cluster.packets)

    def _find_representative(self, packets: List[bytes]) -> bytes:
        if len(packets) == 0:
            return b""

        best_pkt = packets[0]
        best_score = float('inf')

        for pkt in packets:
            total_dist = 0.0
            for other in packets:
                if self.metric == "hamming":
                    total_dist += hamming_distance(pkt, other)
                else:
                    total_dist += levenshtein_distance(pkt, other)

            if total_dist < best_score:
                best_score = total_dist
                best_pkt = pkt

        return best_pkt

    def get_cluster_summary(self) -> List[Dict]:
        summary = []
        for cluster_id, cluster in sorted(self.clusters.items()):
            avg_len = np.mean([len(p) for p in cluster.packets]) if cluster.packets else 0
            summary.append({
                "cluster_id": cluster_id,
                "is_noise": cluster_id == -1,
                "packet_count": len(cluster.packets),
                "average_length": round(avg_len, 2),
                "representative_hex": cluster.representative[:32].hex(),
                "representative_ascii": self._bytes_to_ascii(cluster.representative[:32])
            })
        return summary

    def _bytes_to_ascii(self, data: bytes) -> str:
        result = []
        for b in data:
            if 32 <= b < 127:
                result.append(chr(b))
            else:
                result.append('.')
        return ''.join(result)

    def get_packets_by_cluster(self, cluster_id: int) -> List[bytes]:
        if cluster_id in self.clusters:
            return self.clusters[cluster_id].packets
        return []

    def auto_tune_eps(self, packets: List[bytes], target_clusters: int = 5) -> float:
        if len(packets) < 2:
            return 0.3

        dist_matrix = pairwise_distance_matrix(packets, self.metric)
        distances = []
        for i in range(len(packets)):
            for j in range(i + 1, len(packets)):
                distances.append(dist_matrix[i, j])

        if not distances:
            return 0.3

        distances.sort()
        k = min(self.min_samples, len(distances) - 1)
        k_distances = []

        for i in range(len(packets)):
            row = dist_matrix[i]
            row_sorted = np.sort(row)
            if k < len(row_sorted):
                k_distances.append(row_sorted[k])

        k_distances.sort()
        if len(k_distances) > 0:
            return np.percentile(k_distances, 70)

        return np.mean(distances)

    def optimize_parameters(self, packets: List[bytes],
                            target_clusters_range: Tuple[int, int] = (3, 10)) -> Dict:
        best_params = {"eps": self.eps, "min_samples": self.min_samples}
        best_score = float('inf')

        eps_candidates = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]
        min_samples_candidates = [2, 3, 4, 5, 6]

        for eps in eps_candidates:
            for min_samples in min_samples_candidates:
                temp_clustering = PacketClustering(
                    eps=eps, min_samples=min_samples,
                    metric=self.metric, use_sklearn=False
                )
                clusters = temp_clustering.cluster(packets)
                num_clusters = len([c for c in clusters if c != -1])

                if target_clusters_range[0] <= num_clusters <= target_clusters_range[1]:
                    noise_count = len(clusters.get(-1, Cluster(-1)).packets)
                    score = noise_count + abs(num_clusters - target_clusters_range[0])

                    if score < best_score:
                        best_score = score
                        best_params = {"eps": eps, "min_samples": min_samples}

        return best_params
