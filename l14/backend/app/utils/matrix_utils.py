import numpy as np
from scipy import sparse
from numpy.linalg import norm
from typing import Tuple, Dict, List, Optional
import math


def estimate_condition_number_lanczos(
    A: sparse.csr_matrix,
    k: int = 20,
    max_iter: int = 50,
    tol: float = 1e-6,
) -> Optional[Dict]:
    if A.shape[0] != A.shape[1]:
        return None

    n = A.shape[0]
    if n < 2:
        return None

    try:
        is_sym = is_symmetric(A)

        if is_sym:
            return _lanczos_symmetric(A, k=k, max_iter=max_iter, tol=tol)
        else:
            return _lanczos_nonsymmetric(A, k=k, max_iter=max_iter, tol=tol)

    except Exception:
        return None


def _lanczos_symmetric(
    A: sparse.csr_matrix,
    k: int = 20,
    max_iter: int = 50,
    tol: float = 1e-6,
) -> Dict:
    n = A.shape[0]
    k = min(k, n - 1)

    alpha = np.zeros(k)
    beta = np.zeros(k + 1)
    v_prev = np.zeros(n)
    v_curr = np.random.randn(n)
    v_curr /= norm(v_curr)

    for j in range(k):
        w = A @ v_curr - beta[j] * v_prev
        alpha[j] = np.dot(v_curr, w)
        w -= alpha[j] * v_curr

        for reorth in range(2):
            for i in range(j):
                pass
            v_prev = v_curr

        beta[j + 1] = norm(w)

        if beta[j + 1] < tol:
            if j < k - 1:
                v_prev = v_curr
                v_curr = np.random.randn(n)
                v_curr = v_curr - v_curr @ v_prev * v_prev
                v_curr /= norm(v_curr)
                continue
            break

        v_prev = v_curr
        v_curr = w / beta[j + 1]

    T_size = min(j + 1, k)
    T = np.diag(alpha[:T_size]) + np.diag(beta[1:T_size], -1) + np.diag(beta[1:T_size], 1)

    eigvals = np.linalg.eigvalsh(T)

    lambda_max = float(np.max(eigvals))
    lambda_min = float(np.min(eigvals))

    condition_number = float("inf") if abs(lambda_min) < 1e-15 else abs(lambda_max) / abs(lambda_min)

    warning = None
    if condition_number > 1e15:
        warning = "矩阵条件数极高，数值求解可能不稳定。建议使用更高精度算法或添加预条件器。"
    elif condition_number > 1e10:
        warning = "矩阵条件数较大 (>1e10)，求解结果可能存在较大误差，建议使用双精度计算。"

    return {
        "lambda_max": lambda_max,
        "lambda_min": lambda_min,
        "condition_number": condition_number,
        "algorithm": "lanczos_symmetric",
        "iterations": T_size,
        "is_ill_conditioned": condition_number > 1e10,
        "warning": warning,
    }


def _lanczos_nonsymmetric(
    A: sparse.csr_matrix,
    k: int = 20,
    max_iter: int = 50,
    tol: float = 1e-6,
) -> Dict:
    from scipy.sparse.linalg import eigs

    lambda_max = eigs(A, k=1, which="LM", return_eigenvectors=False, maxiter=1000, tol=1e-4)
    lambda_min = eigs(A, k=1, which="SM", return_eigenvectors=False, maxiter=1000, tol=1e-4)

    max_abs = float(abs(lambda_max[0]))
    min_abs = float(abs(lambda_min[0]))

    condition_number = float("inf") if min_abs < 1e-15 else max_abs / min_abs

    warning = None
    if condition_number > 1e15:
        warning = "矩阵条件数极高，数值求解可能不稳定。建议使用更高精度算法或添加预条件器。"
    elif condition_number > 1e10:
        warning = "矩阵条件数较大 (>1e10)，求解结果可能存在较大误差，建议使用双精度计算。"

    return {
        "lambda_max": max_abs,
        "lambda_min": min_abs,
        "condition_number": condition_number,
        "algorithm": "arnoldi",
        "iterations": k,
        "is_ill_conditioned": condition_number > 1e10,
        "warning": warning,
    }


def estimate_condition_number(A: sparse.csr_matrix, sample_size: int = 100) -> Optional[float]:
    result = estimate_condition_number_lanczos(A, k=20, max_iter=50)
    if result:
        return result["condition_number"]

    try:
        if A.shape[0] != A.shape[1]:
            return None

        n = A.shape[0]
        if n <= sample_size:
            try:
                M = A.todense()
                return float(np.linalg.cond(M))
            except (np.linalg.LinAlgError, MemoryError):
                pass

        try:
            from scipy.sparse.linalg import eigs

            lambda_max = eigs(A, k=1, which="LM", return_eigenvectors=False, maxiter=1000)
            lambda_min = eigs(A, k=1, which="SM", return_eigenvectors=False, maxiter=1000)

            max_abs = abs(lambda_max[0])
            min_abs = abs(lambda_min[0])

            if min_abs < 1e-15:
                return float("inf")

            return float(max_abs / min_abs)
        except Exception:
            return None
    except Exception:
        return None


def compute_matrix_stats(A: sparse.csr_matrix) -> Dict:
    rows, cols = A.shape
    nnz = A.nnz
    sparsity = 1.0 - (nnz / (rows * cols)) if rows * cols > 0 else 1.0

    row_nnz = np.diff(A.indptr)
    col_nnz = np.bincount(A.indices, minlength=cols)

    stats = {
        "shape": [rows, cols],
        "nnz": nnz,
        "sparsity": sparsity,
        "row_nonzero_stats": {
            "mean": float(np.mean(row_nnz)),
            "std": float(np.std(row_nnz)),
            "max": int(np.max(row_nnz)) if len(row_nnz) > 0 else 0,
            "min": int(np.min(row_nnz)) if len(row_nnz) > 0 else 0,
        },
        "col_nonzero_stats": {
            "mean": float(np.mean(col_nnz)),
            "std": float(np.std(col_nnz)),
            "max": int(np.max(col_nnz)) if len(col_nnz) > 0 else 0,
            "min": int(np.min(col_nnz)) if len(col_nnz) > 0 else 0,
        },
        "value_stats": {
            "mean": float(np.mean(np.abs(A.data))) if nnz > 0 else 0.0,
            "std": float(np.std(np.abs(A.data))) if nnz > 0 else 0.0,
            "max": float(np.max(np.abs(A.data))) if nnz > 0 else 0.0,
            "min": float(np.min(np.abs(A.data))) if nnz > 0 else 0.0,
        },
    }

    return stats


def generate_heatmap_data(
    A: sparse.csr_matrix,
    num_bins: int = 100,
    max_points: int = 5000,
) -> Dict:
    rows, cols = A.shape

    x_bins = min(num_bins, cols)
    y_bins = min(num_bins, rows)

    x_edges = np.linspace(0, cols, x_bins + 1)
    y_edges = np.linspace(0, rows, y_bins + 1)

    bin_counts = np.zeros((y_bins, x_bins), dtype=np.int32)

    nnz = A.nnz
    if nnz > 5_000_000:
        sample_step = max(1, nnz // 2_000_000)
        sampled_flat_idx = np.arange(0, nnz, sample_step)
        row_ptrs = np.diff(A.indptr)
        cum_ptr = np.cumsum(row_ptrs)
        sampled_row_idx = np.searchsorted(cum_ptr, sampled_flat_idx, side="right")
        sampled_row_idx = np.clip(sampled_row_idx, 0, rows - 1)
        sampled_col_idx = A.indices[sampled_flat_idx]
    else:
        sampled_row_idx = np.repeat(np.arange(rows), np.diff(A.indptr))
        sampled_col_idx = A.indices

    x_idx = np.clip(np.digitize(sampled_col_idx, x_edges[1:-1]), 0, x_bins - 1)
    y_idx = np.clip(np.digitize(sampled_row_idx, y_edges[1:-1]), 0, y_bins - 1)

    np.add.at(bin_counts, (y_idx, x_idx), 1)

    bins = []
    nonzero_mask = bin_counts > 0
    nonzero_y, nonzero_x = np.nonzero(nonzero_mask)
    for i in range(len(nonzero_x)):
        bins.append({
            "x": int(nonzero_x[i]),
            "y": int(nonzero_y[i]),
            "count": int(bin_counts[nonzero_y[i], nonzero_x[i]]),
        })

    sample_points = []
    if A.nnz > 0:
        actual_max = min(max_points, 5000)
        step = max(1, A.nnz // actual_max)
        sampled_indices = np.arange(0, A.nnz, step)[:actual_max]

        if A.nnz > 5_000_000:
            row_ptrs = np.diff(A.indptr)
            cum_ptr = np.cumsum(row_ptrs)
            row_idx = np.searchsorted(cum_ptr, sampled_indices, side="right")
            row_idx = np.clip(row_idx, 0, rows - 1)
        else:
            row_idx_full = np.repeat(np.arange(rows), np.diff(A.indptr))
            row_idx = row_idx_full[sampled_indices]

        for i, idx in enumerate(sampled_indices):
            sample_points.append({
                "x": int(A.indices[idx]),
                "y": int(row_idx[i]),
                "value": float(A.data[idx]),
            })

    return {
        "matrix_id": "",
        "rows": rows,
        "cols": cols,
        "num_bins": num_bins,
        "bins": bins,
        "sample_points": sample_points,
    }


def compute_residual(A: sparse.csr_matrix, x: np.ndarray, b: np.ndarray) -> float:
    r = b - A.dot(x)
    return float(norm(r) / (norm(b) if norm(b) > 0 else 1.0))


def is_symmetric(A: sparse.csr_matrix, tol: float = 1e-8, sample_rows: int = 200) -> bool:
    if A.shape[0] != A.shape[1]:
        return False

    n = A.shape[0]

    if n <= sample_rows:
        diff = A - A.T
        return norm(diff.toarray()) < tol * max(norm(A.toarray()), 1e-10)

    rng = np.random.RandomState(42)
    sample_idx = np.sort(rng.choice(n, size=min(sample_rows, n), replace=False))
    A_sample = A[sample_idx, :][:, sample_idx]
    diff = A_sample - A_sample.T
    return norm(diff.toarray()) < tol * max(norm(A_sample.toarray()), 1e-10)
