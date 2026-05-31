import numpy as np
from typing import Dict, List, Tuple, Optional, Callable
from dataclasses import dataclass


@dataclass
class AlignmentResult:
    aligned_seq1: str
    aligned_seq2: str
    score: float
    start_pos1: int
    start_pos2: int
    end_pos1: int
    end_pos2: int
    match_count: int
    mismatch_count: int
    gap_count: int
    identity_percentage: float
    difference_sites: List[Dict]


class SmithWaterman:
    def __init__(
        self,
        match_score: int = 2,
        mismatch_penalty: int = -1,
        gap_penalty: int = -2,
        progress_callback: Optional[Callable[[float, str], None]] = None
    ):
        self.match_score = match_score
        self.mismatch_penalty = mismatch_penalty
        self.gap_penalty = gap_penalty
        self.progress_callback = progress_callback

    def _score(self, a: str, b: str) -> int:
        return self.match_score if a == b else self.mismatch_penalty

    def _find_max_position(self, score_matrix: np.ndarray) -> Tuple[int, int, float]:
        max_idx = np.unravel_index(np.argmax(score_matrix), score_matrix.shape)
        max_score = score_matrix[max_idx]
        return max_idx[0], max_idx[1], max_score

    def _backtrack(
        self,
        score_matrix: np.ndarray,
        seq1: str,
        seq2: str,
        start_i: int,
        start_j: int
    ) -> Tuple[str, str, int, int, int, int]:
        aligned1 = []
        aligned2 = []
        i, j = start_i, start_j

        while i > 0 and j > 0 and score_matrix[i][j] > 0:
            current_score = score_matrix[i][j]
            diagonal = score_matrix[i - 1][j - 1]
            up = score_matrix[i - 1][j]
            left = score_matrix[i][j - 1]

            if current_score == diagonal + self._score(seq1[i - 1], seq2[j - 1]):
                aligned1.append(seq1[i - 1])
                aligned2.append(seq2[j - 1])
                i -= 1
                j -= 1
            elif current_score == up + self.gap_penalty:
                aligned1.append(seq1[i - 1])
                aligned2.append("-")
                i -= 1
            else:
                aligned1.append("-")
                aligned2.append(seq2[j - 1])
                j -= 1

        aligned1.reverse()
        aligned2.reverse()

        return (
            "".join(aligned1),
            "".join(aligned2),
            i,
            j,
            start_i,
            start_j
        )

    def _analyze_alignment(
        self,
        aligned_seq1: str,
        aligned_seq2: str
    ) -> Tuple[int, int, int, float, List[Dict]]:
        match_count = 0
        mismatch_count = 0
        gap_count = 0
        difference_sites = []

        for pos, (a, b) in enumerate(zip(aligned_seq1, aligned_seq2)):
            if a == "-" or b == "-":
                gap_count += 1
                difference_sites.append({
                    "position": pos,
                    "base1": a,
                    "base2": b,
                    "type": "gap"
                })
            elif a != b:
                mismatch_count += 1
                difference_sites.append({
                    "position": pos,
                    "base1": a,
                    "base2": b,
                    "type": "mismatch"
                })
            else:
                match_count += 1

        total_length = len(aligned_seq1)
        identity_percentage = (match_count / total_length * 100) if total_length > 0 else 0

        return match_count, mismatch_count, gap_count, identity_percentage, difference_sites

    def align(self, seq1: str, seq2: str) -> AlignmentResult:
        len1 = len(seq1)
        len2 = len(seq2)

        if self.progress_callback:
            self.progress_callback(0.05, "初始化计分矩阵")

        score_matrix = np.zeros((len1 + 1, len2 + 1), dtype=np.float32)

        total_cells = len1 * len2
        cells_processed = 0
        last_progress = 0.05

        for i in range(1, len1 + 1):
            for j in range(1, len2 + 1):
                match = score_matrix[i - 1][j - 1] + self._score(seq1[i - 1], seq2[j - 1])
                delete = score_matrix[i - 1][j] + self.gap_penalty
                insert = score_matrix[i][j - 1] + self.gap_penalty
                score_matrix[i][j] = max(0, match, delete, insert)

                cells_processed += 1
                if self.progress_callback and cells_processed % 10000 == 0:
                    progress = 0.05 + (cells_processed / total_cells) * 0.85
                    if progress - last_progress > 0.01:
                        self.progress_callback(progress, "计算计分矩阵")
                        last_progress = progress

        if self.progress_callback:
            self.progress_callback(0.92, "回溯最优路径")

        max_i, max_j, max_score = self._find_max_position(score_matrix)

        if max_score == 0:
            return AlignmentResult(
                aligned_seq1="",
                aligned_seq2="",
                score=0,
                start_pos1=0,
                start_pos2=0,
                end_pos1=0,
                end_pos2=0,
                match_count=0,
                mismatch_count=0,
                gap_count=0,
                identity_percentage=0,
                difference_sites=[]
            )

        aligned_seq1, aligned_seq2, start_i, start_j, end_i, end_j = self._backtrack(
            score_matrix, seq1, seq2, max_i, max_j
        )

        if self.progress_callback:
            self.progress_callback(0.97, "分析比对结果")

        match_count, mismatch_count, gap_count, identity_percentage, difference_sites = self._analyze_alignment(
            aligned_seq1, aligned_seq2
        )

        if self.progress_callback:
            self.progress_callback(1.0, "比对完成")

        return AlignmentResult(
            aligned_seq1=aligned_seq1,
            aligned_seq2=aligned_seq2,
            score=float(max_score),
            start_pos1=start_i,
            start_pos2=start_j,
            end_pos1=end_i,
            end_pos2=end_j,
            match_count=match_count,
            mismatch_count=mismatch_count,
            gap_count=gap_count,
            identity_percentage=identity_percentage,
            difference_sites=difference_sites
        )
