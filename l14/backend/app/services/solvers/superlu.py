import numpy as np
from scipy import sparse
from scipy.sparse.linalg import splu, spilu, LinearOperator
from numpy.linalg import norm
from typing import Callable, Optional, Tuple, List
import time
from .base import SolverCallback

SUPERLU_SIZE_THRESHOLD = 100_000
SUPERLU_NNZ_THRESHOLD = 10_000_000


class SuperLUSolver(SolverCallback):
    def __init__(self, A: sparse.csr_matrix, b: np.ndarray, tol: float, max_iter: int):
        super().__init__(A, b, tol, max_iter)
        self._use_ilu = False
        self._fallback_iterative = False
        self._preconditioner_type = "none"

    def _estimate_lu_memory(self) -> int:
        n = self.A.shape[0]
        nnz = self.A.nnz
        avg_fill = 10.0
        return int(n * n * 8 * 0.01 + nnz * avg_fill * 8)

    def solve(self, callback: Optional[Callable[[int, float], None]] = None,
              time_limit: float = 300.0) -> Tuple[np.ndarray, dict]:
        if callback:
            self.set_callback(callback)

        start_time = time.time()
        self.residuals = []
        self.converged = False

        b_norm = norm(self.b) if norm(self.b) > 0 else 1.0
        initial_residual = float(norm(self.b) / b_norm)
        self.residuals.append(initial_residual)
        self._notify(0, initial_residual)

        n = self.A.shape[0]
        nnz = self.A.nnz
        need_fallback = n > SUPERLU_SIZE_THRESHOLD or nnz > SUPERLU_NNZ_THRESHOLD

        try:
            if need_fallback:
                x, result = self._solve_iterative_fallback(start_time, time_limit, b_norm, callback)
                return x, result

            A_csc = self.A.tocsc()

            elapsed = time.time() - start_time
            if elapsed > time_limit:
                raise TimeoutError("SuperLU solver exceeded time limit during conversion")

            try:
                lu = splu(A_csc)
                self._use_ilu = False
            except Exception:
                try:
                    ilu = spilu(A_csc, drop_tol=self.tol * 0.1, fill_factor=10)
                    self._use_ilu = True
                    lu = ilu
                except Exception as e:
                    raise RuntimeError(f"Matrix factorization failed: {e}")

            elapsed = time.time() - start_time
            if elapsed > time_limit:
                raise TimeoutError("SuperLU solver exceeded time limit during factorization")

            self._notify(1, initial_residual * 0.5)

            x = lu.solve(self.b)
            self.iterations = 1

            final_residual = self._record_residual(x)
            self.residuals.append(final_residual)
            self._notify(2, final_residual)

            if final_residual < self.tol:
                self.converged = True

            self.solve_time = time.time() - start_time

        except TimeoutError:
            self.solve_time = time.time() - start_time
            x = np.zeros_like(self.b)
            self.residuals.append(initial_residual)

        except RuntimeError:
            self.solve_time = time.time() - start_time
            x, iter_result = self._solve_iterative_fallback(start_time, time_limit, b_norm, callback)
            return x, iter_result

        except Exception as e:
            self.solve_time = time.time() - start_time
            x = np.zeros_like(self.b)
            self.residuals.append(initial_residual)
            raise

        result = {
            "solver": "superlu",
            "solve_time": self.solve_time,
            "iterations": self.iterations,
            "final_residual": self.residuals[-1] if self.residuals else float("inf"),
            "converged": self.converged,
            "residuals": self.residuals,
            "use_ilu": self._use_ilu,
            "preconditioner": self._preconditioner_type,
        }

        return x, result

    def _solve_iterative_fallback(
        self,
        start_time: float,
        time_limit: float,
        b_norm: float,
        callback: Optional[Callable[[int, float], None]],
    ) -> Tuple[np.ndarray, dict]:
        from scipy.sparse.linalg import gmres as scipy_gmres, cg as scipy_cg

        self._fallback_iterative = True
        self._iteration_count = 0

        M = None
        try:
            A_csc = self.A.tocsc()
            ilu = spilu(A_csc, drop_tol=1e-4, fill_factor=10)
            M = LinearOperator((self.A.shape[0], self.A.shape[0]), matvec=ilu.solve)
            self._preconditioner_type = "ilu"
        except Exception:
            try:
                diag = self.A.diagonal()
                diag_inv = np.where(np.abs(diag) > 1e-12, 1.0 / diag, 1.0)
                M = LinearOperator((self.A.shape[0], self.A.shape[0]), matvec=lambda x: x * diag_inv)
                self._preconditioner_type = "jacobi"
            except Exception:
                pass

        is_spd = self.A.shape[0] == self.A.shape[1]
        if is_spd:
            from ...utils.matrix_utils import is_symmetric as check_symmetric
            try:
                is_spd = check_symmetric(self.A)
            except Exception:
                is_spd = False

        max_iter = min(self.max_iter * 2, 5000)

        def iter_callback(xk_or_rk):
            elapsed = time.time() - start_time
            if elapsed > time_limit:
                raise TimeoutError("Iterative fallback exceeded time limit")

            self._iteration_count += 1
            self.iterations = self._iteration_count

            if isinstance(xk_or_rk, np.ndarray):
                residual = self._record_residual(xk_or_rk)
            else:
                residual = float(xk_or_rk / b_norm) if b_norm > 0 else float(xk_or_rk)
                self.residuals.append(residual)

            if callback:
                callback(self._iteration_count, residual)
            self._notify(self._iteration_count, residual)

            if residual < self.tol:
                self.converged = True
                raise StopIteration

        try:
            if is_spd:
                x, info = scipy_cg(
                    self.A, self.b, M=M, tol=self.tol,
                    maxiter=max_iter, callback=iter_callback,
                )
            else:
                x, info = scipy_gmres(
                    self.A, self.b, M=M, tol=self.tol,
                    maxiter=max_iter, restart=30,
                    callback=iter_callback, callback_type="pr_norm",
                )

            if info == 0:
                self.converged = True

            final_residual = self._record_residual(x)
            if len(self.residuals) == 0 or self.residuals[-1] != final_residual:
                self.residuals.append(final_residual)

        except StopIteration:
            x = np.zeros_like(self.b)
        except TimeoutError:
            x = np.zeros_like(self.b)
        except Exception:
            x = np.zeros_like(self.b)

        self.solve_time = time.time() - start_time

        result = {
            "solver": "superlu_iterative",
            "solve_time": self.solve_time,
            "iterations": self.iterations,
            "final_residual": self.residuals[-1] if self.residuals else float("inf"),
            "converged": self.converged,
            "residuals": self.residuals,
            "use_ilu": self._use_ilu,
            "fallback": True,
            "preconditioner": self._preconditioner_type,
            "note": f"Matrix too large ({self.A.shape[0]}x{self.A.shape[1]}, nnz={self.A.nnz}), "
                    f"fell back to iterative solver with sparse preconditioner",
        }

        return x, result


def solve_superlu(
    A: sparse.csr_matrix,
    b: np.ndarray,
    tol: float = 1e-6,
    max_iter: int = 1,
    callback: Optional[Callable[[int, float], None]] = None,
    time_limit: float = 300.0,
) -> Tuple[np.ndarray, dict]:
    solver = SuperLUSolver(A, b, tol, max_iter)
    return solver.solve(callback=callback, time_limit=time_limit)
