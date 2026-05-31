import os
import hashlib
import shutil
import json
from pathlib import Path
from typing import Optional, Tuple, List
from datetime import datetime
import numpy as np
from scipy import sparse
from ..config import settings


class FileManager:
    def __init__(self):
        self.upload_dir = Path(settings.upload_dir).resolve()
        self.result_dir = Path(settings.result_dir).resolve()
        self.upload_dir.mkdir(parents=True, exist_ok=True)
        self.result_dir.mkdir(parents=True, exist_ok=True)

    def _compute_hash(self, file_path: Path) -> str:
        sha256 = hashlib.sha256()
        with open(file_path, "rb") as f:
            for chunk in iter(lambda: f.read(8192), b""):
                sha256.update(chunk)
        return sha256.hexdigest()

    def save_uploaded_file(
        self, file_content: bytes, filename: str, matrix_id: str
    ) -> Tuple[Path, str]:
        matrix_dir = self.upload_dir / matrix_id
        matrix_dir.mkdir(parents=True, exist_ok=True)

        file_path = matrix_dir / "matrix.mtx"
        with open(file_path, "wb") as f:
            f.write(file_content)

        file_hash = self._compute_hash(file_path)
        return file_path, file_hash

    def get_matrix_path(self, matrix_id: str) -> Optional[Path]:
        file_path = self.upload_dir / matrix_id / "matrix.mtx"
        return file_path if file_path.exists() else None

    def load_matrix(self, matrix_id: str) -> Optional[sparse.csr_matrix]:
        file_path = self.get_matrix_path(matrix_id)
        if not file_path:
            return None

        npz_path = self.upload_dir / matrix_id / "matrix.npz"
        if npz_path.exists():
            data = np.load(npz_path, allow_pickle=True)
            return sparse.csr_matrix(
                (data["data"], data["indices"], data["indptr"]),
                shape=tuple(data["shape"]),
            )

        from scipy.io import mmread

        matrix = mmread(str(file_path))
        if not sparse.issparse(matrix):
            matrix = sparse.csr_matrix(matrix)
        else:
            matrix = matrix.tocsr()

        np.savez(
            npz_path,
            data=matrix.data,
            indices=matrix.indices,
            indptr=matrix.indptr,
            shape=matrix.shape,
        )

        return matrix

    def save_rhs_vectors(self, matrix_id: str, rhs_vectors: List[np.ndarray]) -> None:
        matrix_dir = self.upload_dir / matrix_id
        matrix_dir.mkdir(parents=True, exist_ok=True)

        rhs_array = np.column_stack(rhs_vectors)
        np.save(matrix_dir / "rhs_vectors.npy", rhs_array)

        metadata = {
            "num_rhs": len(rhs_vectors),
            "size": len(rhs_vectors[0]) if rhs_vectors else 0,
        }
        with open(matrix_dir / "rhs_metadata.json", "w") as f:
            json.dump(metadata, f, indent=2)

    def load_rhs_vector(self, matrix_id: str, rhs_index: int = 0) -> Optional[np.ndarray]:
        rhs_path = self.upload_dir / matrix_id / "rhs_vectors.npy"
        if not rhs_path.exists():
            return None

        rhs_array = np.load(rhs_path)
        if rhs_index < 0 or rhs_index >= rhs_array.shape[1]:
            return None

        return rhs_array[:, rhs_index]

    def load_all_rhs_vectors(self, matrix_id: str) -> Optional[List[np.ndarray]]:
        rhs_path = self.upload_dir / matrix_id / "rhs_vectors.npy"
        if not rhs_path.exists():
            return None

        rhs_array = np.load(rhs_path)
        return [rhs_array[:, i] for i in range(rhs_array.shape[1])]

    def save_stats(self, matrix_id: str, stats: dict) -> None:
        stats_path = self.upload_dir / matrix_id / "stats.json"
        with open(stats_path, "w") as f:
            json.dump(stats, f, indent=2)

    def load_stats(self, matrix_id: str) -> Optional[dict]:
        stats_path = self.upload_dir / matrix_id / "stats.json"
        if stats_path.exists():
            with open(stats_path, "r") as f:
                return json.load(f)
        return None

    def save_solution(self, task_id: str, solution: np.ndarray, residuals: list, result: dict) -> None:
        task_dir = self.result_dir / task_id
        task_dir.mkdir(parents=True, exist_ok=True)

        np.save(task_dir / "solution.npy", solution)

        with open(task_dir / "residuals.json", "w") as f:
            json.dump(residuals, f)

        with open(task_dir / "result.json", "w") as f:
            json.dump(result, f, indent=2, default=str)

    def load_solution(self, task_id: str) -> Optional[np.ndarray]:
        sol_path = self.result_dir / task_id / "solution.npy"
        if sol_path.exists():
            return np.load(sol_path)
        return None

    def cleanup_old_files(self, max_age_hours: int = 24) -> int:
        cutoff = datetime.now().timestamp() - max_age_hours * 3600
        deleted = 0

        for directory in [self.upload_dir, self.result_dir]:
            for item in directory.iterdir():
                if item.is_dir():
                    if item.stat().st_mtime < cutoff:
                        shutil.rmtree(item)
                        deleted += 1

        return deleted


file_manager = FileManager()
