import math
from typing import List, Dict, Tuple
import numpy as np


def hilbert_index_to_xyz(index: int, order: int, size: float = 1.0) -> Tuple[float, float, float]:
    n = 2 ** order
    x, y, z = 0, 0, 0

    for s in range(order - 1, -1, -1):
        rx = (index >> (3 * s + 2)) & 1
        ry = (index >> (3 * s + 1)) & 1
        rz = index >> (3 * s) & 1

        n = 2 ** (s + 1)

        if rx == 0 and ry == 0 and rz == 0:
            x, y, z = z, x, y
        elif rx == 0 and ry == 0 and rz == 1:
            x, y, z = x, y, z
        elif rx == 0 and ry == 1 and rz == 0:
            x, y, z = x, n - 1 - z, n - 1 - y
        elif rx == 0 and ry == 1 and rz == 1:
            x, y, z = n - 1 - z, n - 1 - x, y
        elif rx == 1 and ry == 0 and rz == 0:
            x, y, z = y, z, x
        elif rx == 1 and ry == 0 and rz == 1:
            x, y, z = z, n - 1 - y, n - 1 - x
        elif rx == 1 and ry == 1 and rz == 0:
            x, y, z = n - 1 - y, z, n - 1 - x
        elif rx == 1 and ry == 1 and rz == 1:
            x, y, z = n - 1 - z, n - 1 - y, n - 1 - x

        if rx == 0:
            if ry == 0:
                x, y = y, x
            else:
                x = n - 1 - x
                y = n - 1 - y

        if ry == 0:
            if rz == 0:
                y, z = z, y
            else:
                y = n - 1 - y
                z = n - 1 - z

    scale = size / (2 ** order)
    return (x * scale, y * scale, z * scale)


def calculate_similarity_window(
    aligned_seq1: str,
    aligned_seq2: str,
    window_size: int = 50,
    step_size: int = 10
) -> List[Dict]:
    seq_len = len(aligned_seq1)
    similarity_data = []

    for i in range(0, seq_len, step_size):
        window_end = min(i + window_size, seq_len)
        window1 = aligned_seq1[i:window_end]
        window2 = aligned_seq2[i:window_end]

        if len(window1) == 0:
            break

        matches = sum(1 for a, b in zip(window1, window2) if a == b and a != "-")
        gaps = sum(1 for a, b in zip(window1, window2) if a == "-" or b == "-")
        valid_positions = len(window1) - gaps

        if valid_positions > 0:
            similarity = matches / valid_positions * 100
        else:
            similarity = 0

        similarity_data.append({
            "index": i,
            "start": i,
            "end": window_end,
            "similarity": similarity,
            "gap_count": gaps,
            "match_count": matches
        })

    return similarity_data


def get_color(similarity: float) -> Tuple[int, int, int]:
    if similarity >= 90:
        return (0, 200, 0)
    elif similarity >= 70:
        return (100, 200, 0)
    elif similarity >= 50:
        return (200, 200, 0)
    elif similarity >= 30:
        return (200, 100, 0)
    else:
        return (200, 0, 0)


def generate_hilbert_3d_data(
    aligned_seq1: str,
    aligned_seq2: str,
    window_size: int = 50,
    step_size: int = 10
) -> List[Dict]:
    similarity_windows = calculate_similarity_window(
        aligned_seq1, aligned_seq2, window_size, step_size
    )

    num_points = len(similarity_windows)
    if num_points == 0:
        return []

    order = max(2, math.ceil(math.log2(math.ceil(num_points ** (1/3)))))
    total_points = 2 ** (3 * order)

    hilbert_data = []
    cube_size = 10.0

    for i, window in enumerate(similarity_windows):
        x, y, z = hilbert_index_to_xyz(i, order, cube_size)
        r, g, b = get_color(window["similarity"])

        hilbert_data.append({
            "index": i,
            "sequence_index": window["index"],
            "x": round(x, 4),
            "y": round(y, 4),
            "z": round(z, 4),
            "similarity": round(window["similarity"], 2),
            "color": f"rgb({r}, {g}, {b})",
            "color_rgb": [r, g, b],
            "start": window["start"],
            "end": window["end"],
            "gap_count": window["gap_count"],
            "match_count": window["match_count"]
        })

    return hilbert_data
