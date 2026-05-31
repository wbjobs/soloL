from typing import List, Dict, Any, Optional
from io import StringIO
import csv


def export_to_csv(
    aligned_seq1: str,
    aligned_seq2: str,
    difference_sites: List[Dict],
    metadata: Dict[str, Any]
) -> str:
    output = StringIO()
    writer = csv.writer(output)

    writer.writerow(["# 基因序列比对结果 - CSV导出"])
    writer.writerow([])
    writer.writerow(["=== 基本信息 ==="])
    for key, value in metadata.items():
        writer.writerow([key, value])
    writer.writerow([])

    writer.writerow(["=== 差异位点详情 ==="])
    writer.writerow([
        "位置",
        "序列1碱基",
        "序列2碱基",
        "差异类型",
        "注释"
    ])

    for site in difference_sites:
        diff_type = site.get("type", "")
        type_zh = "错配" if diff_type == "mismatch" else "空位" if diff_type == "gap" else diff_type
        base1 = site.get("base1", "")
        base2 = site.get("base2", "")

        note = ""
        if diff_type == "mismatch":
            note = f"{base1} → {base2}"
        elif diff_type == "gap":
            if base1 == "-":
                note = f"序列1缺失 {base2}"
            else:
                note = f"序列2缺失 {base1}"

        writer.writerow([
            site.get("position", ""),
            base1,
            base2,
            type_zh,
            note
        ])

    writer.writerow([])
    writer.writerow(["=== 比对序列 ==="])
    writer.writerow(["序列1:", aligned_seq1])
    writer.writerow(["序列2:", aligned_seq2])

    writer.writerow([])
    writer.writerow(["=== 序列比对图示 ==="])
    match_line = "".join(
        "|" if a == b and a != "-" and b != "-"
        else "." if a != "-" and b != "-"
        else " "
        for a, b in zip(aligned_seq1, aligned_seq2)
    )
    writer.writerow(["seq1:", aligned_seq1])
    writer.writerow(["     ", match_line])
    writer.writerow(["seq2:", aligned_seq2])

    return output.getvalue()


def export_to_phylip(
    aligned_seq1: str,
    aligned_seq2: str,
    seq1_name: str = "Sequence1",
    seq2_name: str = "Sequence2",
    metadata: Optional[Dict[str, Any]] = None
) -> str:
    lines = []

    lines.append("  2  " + str(len(aligned_seq1)))

    if metadata:
        lines.append("")
        lines.append("# 比对参数:")
        for key, value in metadata.items():
            if isinstance(value, float):
                lines.append(f"# {key}: {value:.4f}")
            else:
                lines.append(f"# {key}: {value}")
        lines.append("")

    max_name_len = max(len(seq1_name), len(seq2_name), 10)

    seq1_name_padded = seq1_name.ljust(max_name_len)
    seq2_name_padded = seq2_name.ljust(max_name_len)

    block_size = 60
    for i in range(0, len(aligned_seq1), block_size):
        if i > 0:
            lines.append("")

        block_end = min(i + block_size, len(aligned_seq1))

        lines.append(f"{seq1_name_padded} {aligned_seq1[i:block_end]}")
        lines.append(f"{seq2_name_padded} {aligned_seq2[i:block_end]}")

    return "\n".join(lines)


def export_difference_sites_to_bed(
    difference_sites: List[Dict],
    seq_name: str = "alignment",
    window_size: int = 1
) -> str:
    lines = []
    lines.append('track name="DifferenceSites" description="序列差异位点" useScore=1')

    for site in difference_sites:
        pos = site.get("position", 0)
        diff_type = site.get("type", "")

        score = 1000 if diff_type == "mismatch" else 500
        strand = "+"
        color = "255,0,0" if diff_type == "mismatch" else "255,165,0"

        lines.append(
            f"{seq_name}\t{pos}\t{pos + window_size}\t{diff_type}\t"
            f"{score}\t{strand}\t{pos}\t{pos + window_size}\t{color}"
        )

    return "\n".join(lines)


def generate_consensus_sequence(
    aligned_seq1: str,
    aligned_seq2: str,
    threshold: float = 0.5
) -> str:
    consensus = []
    iupac_codes = {
        ('A', 'G'): 'R', ('G', 'A'): 'R',
        ('C', 'T'): 'Y', ('T', 'C'): 'Y',
        ('G', 'C'): 'S', ('C', 'G'): 'S',
        ('A', 'T'): 'W', ('T', 'A'): 'W',
        ('G', 'T'): 'K', ('T', 'G'): 'K',
        ('A', 'C'): 'M', ('C', 'A'): 'M',
    }

    for a, b in zip(aligned_seq1, aligned_seq2):
        if a == b:
            consensus.append(a if a != '-' else '')
        elif a == '-':
            consensus.append(b.lower())
        elif b == '-':
            consensus.append(a.lower())
        else:
            code = iupac_codes.get((a, b), 'N')
            consensus.append(code)

    return ''.join(consensus)


def calculate_similarity_windows(
    aligned_seq1: str,
    aligned_seq2: str,
    window_size: int = 100,
    step_size: int = 50
) -> List[Dict]:
    windows = []
    seq_len = len(aligned_seq1)

    for i in range(0, seq_len - window_size + 1, step_size):
        window1 = aligned_seq1[i:i + window_size]
        window2 = aligned_seq2[i:i + window_size]

        matches = sum(1 for a, b in zip(window1, window2) if a == b and a != '-')
        non_gaps = sum(1 for a, b in zip(window1, window2) if a != '-' and b != '-')

        identity = (matches / non_gaps * 100) if non_gaps > 0 else 0

        windows.append({
            "start": i,
            "end": i + window_size,
            "identity": round(identity, 2),
            "matches": matches,
            "non_gaps": non_gaps
        })

    return windows
