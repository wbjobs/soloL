import io
import numpy as np
from scipy import sparse
from scipy.io import mmread, mminfo
from typing import Tuple, Dict, Optional, List, Union
from pathlib import Path
from ..config import settings
from ..storage.file_manager import file_manager
from ..utils.matrix_utils import (
    compute_matrix_stats,
    estimate_condition_number,
    estimate_condition_number_lanczos,
    generate_heatmap_data,
)
from ..db.models import MatrixInfo
from ..db.redis import redis_client
import uuid
from datetime import datetime
import tarfile
import zipfile
import json


class MatrixParser:
    @staticmethod
    def _validate_matrix(A: sparse.spmatrix) -> None:
        rows, cols = A.shape

        if rows > settings.max_matrix_size or cols > settings.max_matrix_size:
            raise ValueError(
                f"Matrix size {rows}x{cols} exceeds maximum allowed size "
                f"{settings.max_matrix_size}x{settings.max_matrix_size}"
            )

        if A.nnz == 0:
            raise ValueError("Matrix has no non-zero elements")

        if not sparse.isspmatrix_csr(A):
            pass

    @staticmethod
    def _detect_format(content: bytes, filename: str) -> str:
        if filename.endswith(".npz"):
            return "npz"
        if filename.endswith(".zip"):
            return "zip"
        if filename.endswith(".tar.gz") or filename.endswith(".tgz"):
            return "tar"
        return "mtx"

    @staticmethod
    def _parse_mtx_file(content: bytes, filename: str) -> Tuple[sparse.csr_matrix, Optional[List[np.ndarray]], Dict]:
        try:
            file_obj = io.BytesIO(content)
            info = mminfo(file_obj)
            file_obj.seek(0)

            if len(info) >= 5 and info[2] == "dense":
                data = np.loadtxt(file_obj, skiprows=1 if content.startswith(b"%") else 0)
                if data.ndim == 2 and data.shape[1] > 1 and data.shape[1] <= 1000:
                    n = data.shape[0]
                    num_rhs = data.shape[1] - 1
                    A = sparse.diags(data[:, 0])
                    b_vectors = [data[:, i + 1] for i in range(num_rhs)]
                    MatrixParser._validate_matrix(A)
                    stats = compute_matrix_stats(A)
                    return A, b_vectors, stats

            matrix = mmread(file_obj)
        except Exception as e:
            raise ValueError(f"Failed to parse Matrix Market format: {e}")

        if not sparse.issparse(matrix):
            if np.prod(matrix.shape) > 10_000_000:
                raise ValueError(
                    "Dense matrices are not supported for large sizes. "
                    "Please provide a sparse matrix."
                )
            matrix = sparse.csr_matrix(matrix)
        else:
            matrix = matrix.tocsr()

        MatrixParser._validate_matrix(matrix)

        stats = compute_matrix_stats(matrix)
        return matrix, None, stats

    @staticmethod
    def _parse_npz_file(content: bytes, filename: str) -> Tuple[sparse.csr_matrix, Optional[List[np.ndarray]], Dict]:
        try:
            file_obj = io.BytesIO(content)
            data = np.load(file_obj, allow_pickle=True)

            if "A" not in data:
                raise ValueError("NPZ file must contain 'A' array")

            A = data["A"]
            if sparse.issparse(A):
                A = A.tocsr()
            elif isinstance(A, np.ndarray):
                if A.ndim == 2:
                    if A.shape[0] * A.shape[1] > 10_000_000:
                        raise ValueError("Dense matrix too large")
                    A = sparse.csr_matrix(A)
                else:
                    raise ValueError("'A' must be a 2D matrix")

            MatrixParser._validate_matrix(A)
            stats = compute_matrix_stats(A)

            b_vectors = None
            if "b" in data:
                b = data["b"]
                if b.ndim == 1:
                    b_vectors = [b]
                elif b.ndim == 2:
                    b_vectors = [b[:, i] for i in range(b.shape[1])]
                b_vectors = b_vectors[:1000]

            if "rhs" in data and b_vectors is None:
                rhs = data["rhs"]
                if rhs.ndim == 1:
                    b_vectors = [rhs]
                elif rhs.ndim == 2:
                    b_vectors = [rhs[:, i] for i in range(rhs.shape[1])]
                b_vectors = b_vectors[:1000]

            return A, b_vectors, stats

        except Exception as e:
            raise ValueError(f"Failed to parse NPZ format: {e}")

    @staticmethod
    def _parse_archive(content: bytes, filename: str) -> Tuple[sparse.csr_matrix, Optional[List[np.ndarray]], Dict]:
        b_vectors = None

        if filename.endswith(".zip"):
            try:
                file_obj = io.BytesIO(content)
                with zipfile.ZipFile(file_obj, "r") as zf:
                    names = zf.namelist()
                    a_names = [n for n in names if n.lower().endswith((".mtx", ".npz")) and "a." in n.lower()]
                    if not a_names:
                        a_names = [n for n in names if n.lower().endswith((".mtx", ".npz"))]
                    if not a_names:
                        raise ValueError("No matrix file found in archive")

                    a_content = zf.read(a_names[0])
                    if a_names[0].endswith(".npz"):
                        A, b_from_npz, stats = MatrixParser._parse_npz_file(a_content, a_names[0])
                        if b_from_npz:
                            b_vectors = b_from_npz
                    else:
                        A, b_from_mtx, stats = MatrixParser._parse_mtx_file(a_content, a_names[0])
                        if b_from_mtx:
                            b_vectors = b_from_mtx

                    if b_vectors is None:
                        b_names = [n for n in names if "b." in n.lower() or "rhs" in n.lower()]
                        if b_names:
                            b_vectors = []
                            for b_name in b_names[:1000]:
                                b_content = zf.read(b_name)
                                try:
                                    if b_name.lower().endswith(".mtx"):
                                        b_file = io.BytesIO(b_content)
                                        b_info = mminfo(b_file)
                                        b_file.seek(0)
                                        b_data = mmread(b_file)
                                        if sparse.issparse(b_data):
                                            b_data = b_data.toarray()
                                        b_data = np.asarray(b_data).squeeze()
                                        if b_data.ndim == 1:
                                            b_vectors.append(b_data)
                                        elif b_data.ndim == 2:
                                            if b_data.shape[1] == 1:
                                                b_vectors.append(b_data.flatten())
                                            else:
                                                for i in range(min(b_data.shape[1], 1000)):
                                                    b_vectors.append(b_data[:, i])
                                    else:
                                        b_data = np.loadtxt(io.BytesIO(b_content))
                                        if b_data.ndim == 1:
                                            b_vectors.append(b_data)
                                        elif b_data.ndim == 2 and b_data.shape[1] == 1:
                                            b_vectors.append(b_data.flatten())
                                except Exception:
                                    continue

                    return A, b_vectors, stats

            except Exception as e:
                raise ValueError(f"Failed to parse ZIP archive: {e}")

        elif filename.endswith((".tar.gz", ".tgz")):
            try:
                file_obj = io.BytesIO(content)
                with tarfile.open(fileobj=file_obj, mode="r:gz") as tf:
                    members = tf.getmembers()
                    a_members = [m for m in members if m.isfile() and m.name.lower().endswith((".mtx", ".npz")) and "a." in m.name.lower()]
                    if not a_members:
                        a_members = [m for m in members if m.isfile() and m.name.lower().endswith((".mtx", ".npz"))]
                    if not a_members:
                        raise ValueError("No matrix file found in archive")

                    f = tf.extractfile(a_members[0])
                    a_content = f.read() if f else b""
                    if a_members[0].name.endswith(".npz"):
                        A, b_from_npz, stats = MatrixParser._parse_npz_file(a_content, a_members[0].name)
                        if b_from_npz:
                            b_vectors = b_from_npz
                    else:
                        A, b_from_mtx, stats = MatrixParser._parse_mtx_file(a_content, a_members[0].name)
                        if b_from_mtx:
                            b_vectors = b_from_mtx

                    if b_vectors is None:
                        b_members = [m for m in members if m.isfile() and ("b." in m.name.lower() or "rhs" in m.name.lower())]
                        if b_members:
                            b_vectors = []
                            for b_mem in b_members[:1000]:
                                f = tf.extractfile(b_mem)
                                if f:
                                    b_content = f.read()
                                    try:
                                        b_name = b_mem.name
                                        if b_name.lower().endswith(".mtx"):
                                            b_file = io.BytesIO(b_content)
                                            b_info = mminfo(b_file)
                                            b_file.seek(0)
                                            b_data = mmread(b_file)
                                            if sparse.issparse(b_data):
                                                b_data = b_data.toarray()
                                            b_data = np.asarray(b_data).squeeze()
                                            if b_data.ndim == 1:
                                                b_vectors.append(b_data)
                                            elif b_data.ndim == 2:
                                                if b_data.shape[1] == 1:
                                                    b_vectors.append(b_data.flatten())
                                                else:
                                                    for i in range(min(b_data.shape[1], 1000)):
                                                        b_vectors.append(b_data[:, i])
                                        else:
                                            b_data = np.loadtxt(io.BytesIO(b_content))
                                            if b_data.ndim == 1:
                                                b_vectors.append(b_data)
                                            elif b_data.ndim == 2 and b_data.shape[1] == 1:
                                                b_vectors.append(b_data.flatten())
                                    except Exception:
                                        continue

                    return A, b_vectors, stats

            except Exception as e:
                raise ValueError(f"Failed to parse TAR archive: {e}")

        raise ValueError("Unsupported archive format")

    @staticmethod
    def parse_matrix_content(
        content: bytes, filename: str
    ) -> Tuple[sparse.csr_matrix, Optional[List[np.ndarray]], Dict]:
        fmt = MatrixParser._detect_format(content, filename)

        if fmt == "npz":
            return MatrixParser._parse_npz_file(content, filename)
        elif fmt in ("zip", "tar"):
            return MatrixParser._parse_archive(content, filename)
        else:
            return MatrixParser._parse_mtx_file(content, filename)

    @staticmethod
    def process_upload(content: bytes, filename: str) -> MatrixInfo:
        matrix_id = str(uuid.uuid4())

        file_path, file_hash = file_manager.save_uploaded_file(
            content, filename, matrix_id
        )

        matrix, b_vectors, stats = MatrixParser.parse_matrix_content(content, filename)

        try:
            cond_info = estimate_condition_number_lanczos(matrix, k=20, max_iter=50)
            if cond_info:
                stats["condition_number"] = cond_info["condition_number"]
                stats["condition_info"] = cond_info
            else:
                cond = estimate_condition_number(matrix)
                stats["condition_number"] = cond
                stats["condition_info"] = None
        except Exception:
            stats["condition_number"] = None
            stats["condition_info"] = None

        num_rhs = len(b_vectors) if b_vectors else 1

        matrix_info = MatrixInfo(
            matrix_id=matrix_id,
            filename=filename,
            shape=matrix.shape,
            nnz=matrix.nnz,
            sparsity=stats["sparsity"],
            condition_number=stats.get("condition_number"),
            condition_info=stats.get("condition_info"),
            num_rhs=num_rhs,
            uploaded_at=datetime.now(),
            file_path=str(file_path),
            file_hash=file_hash,
        )

        redis_client.save_matrix_info(matrix_info)
        file_manager.save_stats(matrix_id, stats)

        if b_vectors:
            file_manager.save_rhs_vectors(matrix_id, b_vectors)

        try:
            heatmap = generate_heatmap_data(matrix, num_bins=100, max_points=5000)
            stats["heatmap"] = heatmap
        except Exception:
            stats["heatmap"] = None

        if stats.get("heatmap"):
            stats["heatmap"]["matrix_id"] = matrix_id
            redis_client.save_heatmap_data(matrix_id, stats["heatmap"])

        matrix_stats = {
            "matrix_id": matrix_id,
            "shape": stats["shape"],
            "nnz": stats["nnz"],
            "sparsity": stats["sparsity"],
            "condition_number": stats.get("condition_number"),
            "condition_info": stats.get("condition_info"),
            "row_nonzero_stats": stats["row_nonzero_stats"],
            "col_nonzero_stats": stats["col_nonzero_stats"],
            "num_rhs": num_rhs,
        }
        redis_client.save_matrix_stats(matrix_id, matrix_stats)

        return matrix_info

    @staticmethod
    def get_matrix_info(matrix_id: str) -> Optional[MatrixInfo]:
        return redis_client.get_matrix_info(matrix_id)

    @staticmethod
    def load_matrix(matrix_id: str) -> Optional[sparse.csr_matrix]:
        return file_manager.load_matrix(matrix_id)

    @staticmethod
    def load_rhs_vector(matrix_id: str, rhs_index: int = 0) -> Optional[np.ndarray]:
        return file_manager.load_rhs_vector(matrix_id, rhs_index)

    @staticmethod
    def get_num_rhs(matrix_id: str) -> int:
        info = MatrixParser.get_matrix_info(matrix_id)
        return info.num_rhs if info else 1


matrix_parser = MatrixParser()
