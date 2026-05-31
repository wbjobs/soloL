from typing import Tuple, Optional
import os
from Bio import SeqIO


def parse_fasta(file_path: str) -> Tuple[Optional[str], Optional[str], int]:
    try:
        with open(file_path, "r") as f:
            for record in SeqIO.parse(f, "fasta"):
                sequence = str(record.seq).upper()
                return record.id, record.description, len(sequence)
    except Exception as e:
        return None, None, 0
    return None, None, 0


def read_sequence(file_path: str) -> Optional[str]:
    try:
        with open(file_path, "r") as f:
            for record in SeqIO.parse(f, "fasta"):
                return str(record.seq).upper()
    except Exception:
        return None
    return None


def validate_fasta_content(content: bytes) -> bool:
    try:
        text = content.decode("utf-8", errors="ignore")
        lines = text.strip().split("\n")
        if not lines or not lines[0].startswith(">"):
            return False
        has_sequence = False
        for line in lines[1:]:
            if line.strip() and not line.startswith(">"):
                has_sequence = True
                break
        return has_sequence
    except Exception:
        return False
