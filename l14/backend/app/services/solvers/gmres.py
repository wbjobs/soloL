import numpy as np
from scipy import sparse
from scipy.sparse.linalg import gmres as scipy_gmres, spilu, LinearOperator
from numpy.linalg import norm
from typing import Callable, Optional, Tuple, List
import time
from .base import SolverCallback


class GMRESSolver(SolverCallback):
    def __init__(self, A: sparse.csr_matrix, b: np.ndarray, tol: float, max_iter: int):
        super().__init__(A, b, tol, max_iter)
        self._iteration_count = 0
        self._restart = min(30, max_iter)
        self._preconditioner_type = "none"

    def _iter_callback(self, xk: np.ndarray) -> None:
        self._iteration_count += 1
        self.iterations = self._iteration_count

        residual = self._record_residual(xk)
        self._notify(self._iteration_count, residual)

        if residual < self.tol:
            self.converged = True
            raise StopIteration

    def _build_ilu_preconditioner(self) -> Optional[LinearOperator]:
        n = self.A.shape[0]
        try:
            A_csc = self.A.tocsc()
            ilu = spilu(A_csc, drop_tol=1e-4, fill_factor=10)
            M = LinearOperator((n, n), matvec=ilu.solve)
            self._preconditioner_type = "ilu"
            return M
        except Exception:
            pass

        try:
            diag = self.A.diagonal()
            diag_inv = np.where(np.abs(diag) > 1e-12, 1.0 / diag, 1.0)
            M = LinearOperator((n, n), matvec=lambda x: x * diag_inv)
            self._preconditioner_type = "jacobi"
            return M
        except Exception:
            return None

    def solve(self, callback: Optional[Callable[[int, float], None]] = None,
              time_limit: float = 300.0, use_preconditioner: bool = True) -> Tuple[np.ndarray, dict]:
        if callback:
            self.set_callback(callback)

        start_time = time.time()
        self._iteration_count = 0
        self.residuals = []
        self.converged = False
        self._preconditioner_type = "none"

        b_norm = norm(self.b) if norm(self.b) > 0 else 1.0
        initial_residual = float(norm(self.b) / b_norm)
        self.residuals.append(initial_residual)
        self._notify(0, initial_residual)

        M = None
        if use_preconditioner:
            M = self._build_ilu_preconditioner()

        x = np.zeros_like(self.b)

        try:
            def scipy_callback(rk: float) -> None:
                elapsed = time.time() - start_time
                if elapsed > time_limit:
                    raise TimeoutError(f"GMRES solver exceeded time limit of {time_limit}s")

                self._iteration_count += 1
                self.iterations = self._iteration_count

                scaled_residual = rk / b_norm if b_norm > 0 else rk
                self.residuals.append(float(scaled_residual))
                self._notify(self._iteration_count, float(scaled_residual))

                if scaled_residual < self.tol:
                    self.converged = True
                    raise StopIteration

            x, info = scipy_gmres(
                self.A,
                self.b,
                M=M,
                tol=self.tol,
                maxiter=self.max_iter,
                restart=self._restart,
                callback=scipy_callback,
                callback_type="pr_norm",
            )

            self.solve_time = time.time() - start_time

            if not self.converged and len(self.residuals) > 1:
                final_residual = self._record_residual(x)
                self.residuals[-1] = final_residual
                if final_residual < self.tol:
                    self.converged = True

            if info == 0:
                self.converged = True

        except StopIteration:
            self.solve_time = time.time() - start_time

        except TimeoutError:
            self.solve_time = time.time() - start_time
            x = np.zeros_like(self.b)

        except Exception as e:
            self.solve_time = time.time() - start_time
            x = np.zeros_like(self.b)
            raise

        result = {
            "solver": "gmres",
            "solve_time": self.solve_time,
            "iterations": self.iterations,
            "final_residual": self.residuals[-1] if self.residuals else float("inf"),
            "converged": self.converged,
            "residuals": self.residuals,
            "preconditioner": self._preconditioner_type,
        }

        return x, result


def solve_gmres(
    A: sparse.csr_matrix,
    b: np.ndarray,
    tol: float = 1e-6,
    max_iter: int = 1000,
    callback: Optional[Callable[[int, float], None]] = None,
    time_limit: float = 300.0,
    use_preconditioner: bool = True,
) -> Tuple[np.ndarray, dict]:
    solver = GMRESSolver(A, b, tol, max_iter)
    return solver.solve(callback=callback, time_limit=time_limit, use_preconditioner=use_preconditioner)
