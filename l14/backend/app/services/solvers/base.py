import numpy as np
from scipy import sparse
from numpy.linalg import norm
from typing import Callable, Optional, Tuple, List
from abc import ABC, abstractmethod
import time


class SolverCallback:
    def __init__(self, A: sparse.csr_matrix, b: np.ndarray, tol: float, max_iter: int):
        self.A = A
        self.b = b
        self.tol = tol
        self.max_iter = max_iter
        self.residuals: List[float] = []
        self.iterations = 0
        self.solve_time = 0.0
        self.converged = False
        self._callback: Optional[Callable[[int, float], None]] = None

    def set_callback(self, callback: Callable[[int, float], None]) -> None:
        self._callback = callback

    def _record_residual(self, x: np.ndarray) -> float:
        r = self.b - self.A.dot(x)
        b_norm = norm(self.b) if norm(self.b) > 0 else 1.0
        residual = float(norm(r) / b_norm)
        self.residuals.append(residual)
        return residual

    def _notify(self, iteration: int, residual: float) -> None:
        if self._callback:
            try:
                self._callback(iteration, residual)
            except Exception:
                pass

    @abstractmethod
    def solve(self) -> Tuple[np.ndarray]:
        pass
