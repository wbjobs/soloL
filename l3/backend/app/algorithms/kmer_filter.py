from typing import Dict, List, Tuple, Optional
from collections import defaultdict
import numpy as np


class KMerIndex:
    def __init__(self, k: int = 15):
        self.k = k
        self.index: Dict[str, List[int]] = defaultdict(list)

    def build(self, sequence: str) -> None:
        self.sequence = sequence
        self.index.clear()
        seq_len = len(sequence)

        for i in range(seq_len - self.k + 1):
            kmer = sequence[i:i + self.k]
            self.index[kmer].append(i)

    def query(self, kmer: str) -> List[int]:
        return self.index.get(kmer, [])

    def get_kmer(self, sequence: str, position: int) -> Optional[str]:
        if position + self.k > len(sequence):
            return None
        return sequence[position:position + self.k]


class KMerFilter:
    def __init__(self, k: int = 15, min_matches: int = 3, window_size: int = 200):
        self.k = k
        self.min_matches = min_matches
        self.window_size = window_size
        self.kmer_index = KMerIndex(k)

    def find_candidate_regions(
        self,
        seq1: str,
        seq2: str,
        progress_callback: Optional[callable] = None
    ) -> List[Tuple[int, int, int, int]]:
        if progress_callback:
            progress_callback(0.0, "构建k-mer索引")

        self.kmer_index.build(seq1)

        if progress_callback:
            progress_callback(0.1, "扫描k-mer匹配")

        len1 = len(seq1)
        len2 = len(seq2)

        match_grid = np.zeros((len1, len2), dtype=np.uint8)

        total_kmers = len2 - self.k + 1
        processed = 0

        for j in range(len2 - self.k + 1):
            kmer = seq2[j:j + self.k]
            positions = self.kmer_index.query(kmer)

            for i in positions:
                if i < len1 and j < len2:
                    match_grid[i, j] = 1

            processed += 1
            if progress_callback and processed % 10000 == 0:
                progress = 0.1 + (processed / total_kmers) * 0.3
                progress_callback(progress, f"扫描k-mer匹配 {processed}/{total_kmers}")

        if progress_callback:
            progress_callback(0.4, "检测候选区域")

        candidate_regions = self._detect_candidate_regions(match_grid, len1, len2)

        if progress_callback:
            progress_callback(0.5, f"找到 {len(candidate_regions)} 个候选区域")

        return candidate_regions

    def _detect_candidate_regions(
        self,
        match_grid: np.ndarray,
        len1: int,
        len2: int
    ) -> List[Tuple[int, int, int, int]]:
        regions = []
        visited = np.zeros((len1, len2), dtype=bool)

        for i in range(len1):
            for j in range(len2):
                if match_grid[i, j] == 1 and not visited[i, j]:
                    region = self._flood_fill(match_grid, visited, i, j, len1, len2)
                    if region is not None:
                        regions.append(region)

        return self._merge_overlapping_regions(regions)

    def _flood_fill(
        self,
        match_grid: np.ndarray,
        visited: np.ndarray,
        start_i: int,
        start_j: int,
        len1: int,
        len2: int
    ) -> Optional[Tuple[int, int, int, int]]:
        stack = [(start_i, start_j)]
        min_i, max_i = start_i, start_i
        min_j, max_j = start_j, start_j
        match_count = 0

        while stack:
            i, j = stack.pop()

            if i < 0 or i >= len1 or j < 0 or j >= len2:
                continue
            if visited[i, j] or match_grid[i, j] == 0:
                continue

            visited[i, j] = True
            match_count += 1

            min_i = min(min_i, i)
            max_i = max(max_i, i)
            min_j = min(min_j, j)
            max_j = max(max_j, j)

            for di in [-1, 0, 1]:
                for dj in [-1, 0, 1]:
                    if di == 0 and dj == 0:
                        continue
                    stack.append((i + di, j + dj))

        if match_count >= self.min_matches:
            padding = self.k * 2
            start1 = max(0, min_i - padding)
            end1 = min(len1, max_i + self.k + padding)
            start2 = max(0, min_j - padding)
            end2 = min(len2, max_j + self.k + padding)

            return (start1, end1, start2, end2)

        return None

    def _merge_overlapping_regions(
        self,
        regions: List[Tuple[int, int, int, int]]
    ) -> List[Tuple[int, int, int, int]]:
        if not regions:
            return []

        regions.sort(key=lambda x: (x[0], x[2]))

        merged = [regions[0]]

        for current in regions[1:]:
            last = merged[-1]

            overlap1 = current[0] <= last[1]
            overlap2 = current[2] <= last[3]

            if overlap1 or overlap2:
                new_start1 = min(last[0], current[0])
                new_end1 = max(last[1], current[1])
                new_start2 = min(last[2], current[2])
                new_end2 = max(last[3], current[3])
                merged[-1] = (new_start1, new_end1, new_start2, new_end2)
            else:
                merged.append(current)

        return merged

    def calculate_estimated_speedup(
        self,
        len1: int,
        len2: int,
        regions: List[Tuple[int, int, int, int]]
    ) -> float:
        full_complexity = len1 * len2

        filtered_complexity = 0
        for start1, end1, start2, end2 in regions:
            filtered_complexity += (end1 - start1) * (end2 - start2)

        if filtered_complexity == 0:
            return float('inf')

        return full_complexity / filtered_complexity


class HeuristicSmithWaterman:
    def __init__(
        self,
        match_score: int = 2,
        mismatch_penalty: int = -1,
        gap_penalty: int = -2,
        k: int = 15,
        use_heuristic: bool = True,
        progress_callback: Optional[callable] = None
    ):
        from .smith_waterman import SmithWaterman

        self.match_score = match_score
        self.mismatch_penalty = mismatch_penalty
        self.gap_penalty = gap_penalty
        self.k = k
        self.use_heuristic = use_heuristic
        self.progress_callback = progress_callback
        self.sw = SmithWaterman(
            match_score=match_score,
            mismatch_penalty=mismatch_penalty,
            gap_penalty=gap_penalty
        )
        self.kmer_filter = KMerFilter(k=k)

    def align(self, seq1: str, seq2: str):
        from .smith_waterman import AlignmentResult

        len1 = len(seq1)
        len2 = len(seq2)

        if not self.use_heuristic or min(len1, len2) < self.k * 4:
            if self.progress_callback:
                self.progress_callback(0.0, "序列较短，执行完整Smith-Waterman")
            self.sw.progress_callback = self.progress_callback
            return self.sw.align(seq1, seq2)

        if self.progress_callback:
            self.progress_callback(0.0, "启动启发式过滤")

        candidate_regions = self.kmer_filter.find_candidate_regions(
            seq1, seq2,
            progress_callback=self._wrap_progress(0.0, 0.6)
        )

        speedup = self.kmer_filter.calculate_estimated_speedup(len1, len2, candidate_regions)

        if self.progress_callback:
            self.progress_callback(
                0.6,
                f"启发式过滤完成，预估加速比: {speedup:.1f}x"
            )

        if not candidate_regions:
            if self.progress_callback:
                self.progress_callback(0.6, "未找到候选区域，执行全局比对")
            self.sw.progress_callback = self._wrap_progress(0.6, 1.0)
            return self.sw.align(seq1, seq2)

        if self.progress_callback:
            self.progress_callback(0.6, f"对 {len(candidate_regions)} 个候选区域执行精确比对")

        best_result = None
        best_score = -float('inf')

        total_regions = len(candidate_regions)
        for idx, (start1, end1, start2, end2) in enumerate(candidate_regions):
            if self.progress_callback:
                region_progress = 0.6 + (idx / total_regions) * 0.35
                self.progress_callback(
                    region_progress,
                    f"比对区域 {idx + 1}/{total_regions}: "
                    f"seq1[{start1}:{end1}] vs seq2[{start2}:{end2}]"
                )

            sub_seq1 = seq1[start1:end1]
            sub_seq2 = seq2[start2:end2]

            region_result = self.sw.align(sub_seq1, sub_seq2)

            if region_result.score > best_score:
                best_score = region_result.score
                best_result = region_result

                best_result.start_pos1 += start1
                best_result.end_pos1 += start1
                best_result.start_pos2 += start2
                best_result.end_pos2 += start2

                for diff_site in best_result.difference_sites:
                    diff_site["position"] += start1

        if self.progress_callback:
            self.progress_callback(0.98, "分析最终比对结果")

        if best_result is None or best_score == 0:
            if self.progress_callback:
                self.progress_callback(0.6, "候选区域无有效比对，执行全局比对")
            self.sw.progress_callback = self._wrap_progress(0.6, 1.0)
            return self.sw.align(seq1, seq2)

        if self.progress_callback:
            self.progress_callback(1.0, f"比对完成，加速比: {speedup:.1f}x")

        best_result.score = float(best_score)
        return best_result

    def _wrap_progress(self, start: float, end: float):
        if not self.progress_callback:
            return None

        def wrapper(progress: float, stage: str):
            scaled_progress = start + progress * (end - start)
            self.progress_callback(scaled_progress, stage)

        return wrapper
