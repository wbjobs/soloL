import numpy as np
from scipy import sparse
from typing import Dict, Tuple, Optional, List


class SparseQuantumState:
    __slots__ = ['n_qubits', 'size', 'state_vector', '_density_matrix_cache', '_cache_valid']

    def __init__(self, n_qubits: int = 1):
        if n_qubits < 1 or n_qubits > 5:
            raise ValueError("Number of qubits must be between 1 and 5")
        self.n_qubits = n_qubits
        self.size = 2 ** n_qubits
        self.state_vector = np.zeros(self.size, dtype=np.complex128)
        self.state_vector[0] = 1.0
        self._density_matrix_cache = None
        self._cache_valid = False

    @classmethod
    def from_state_vector(cls, state_vector: np.ndarray) -> 'SparseQuantumState':
        state_vector = np.asarray(state_vector, dtype=np.complex128)
        size = state_vector.shape[0]
        n_qubits = int(np.log2(size))
        if 2 ** n_qubits != size:
            raise ValueError("State vector size must be a power of 2")
        if n_qubits > 5:
            raise ValueError("Maximum 5 qubits supported")
        qs = cls(n_qubits)
        qs.state_vector = state_vector / np.linalg.norm(state_vector)
        qs._cache_valid = False
        return qs

    @classmethod
    def from_bloch_sphere(cls, theta: float, phi: float) -> 'SparseQuantumState':
        qs = cls(1)
        qs.state_vector[0] = np.cos(theta / 2)
        qs.state_vector[1] = np.sin(theta / 2) * np.exp(1j * phi)
        qs._cache_valid = False
        return qs

    def _invalidate_cache(self):
        self._density_matrix_cache = None
        self._cache_valid = False

    def apply_single_qubit_gate_direct(self, gate_2x2: np.ndarray, target: int):
        n = self.n_qubits
        dim = self.size
        high = 2 ** (n - 1 - target)
        low = 2 ** target
        g00, g01 = gate_2x2[0, 0], gate_2x2[0, 1]
        g10, g11 = gate_2x2[1, 0], gate_2x2[1, 1]
        new_sv = np.zeros(dim, dtype=np.complex128)
        for i in range(high):
            for j in range(low):
                idx0 = i * 2 * low + j
                idx1 = i * 2 * low + low + j
                a = self.state_vector[idx0]
                b = self.state_vector[idx1]
                new_sv[idx0] = g00 * a + g01 * b
                new_sv[idx1] = g10 * a + g11 * b
        self.state_vector = new_sv
        self._invalidate_cache()

    def apply_cnot_direct(self, control: int, target: int):
        n = self.n_qubits
        if control >= n or target >= n:
            raise ValueError("Control/target qubit index out of range")
        if control == target:
            raise ValueError("Control and target qubits must be different")
        dim = self.size
        new_sv = self.state_vector.copy()
        for i in range(dim):
            if (i >> (n - 1 - control)) & 1:
                j = i ^ (1 << (n - 1 - target))
                new_sv[j] = self.state_vector[i]
        changed = np.where(new_sv != self.state_vector)[0]
        for idx in changed:
            self.state_vector[idx] = new_sv[idx]
        self._invalidate_cache()

    @staticmethod
    def _build_sparse_single_gate(gate_2x2: np.ndarray, target: int, n_qubits: int) -> sparse.csr_matrix:
        size = 2 ** n_qubits
        rows, cols, vals = [], [], []
        low = 2 ** target
        high = 2 ** (n_qubits - 1 - target)
        for i in range(high):
            for j in range(low):
                idx0 = i * 2 * low + j
                idx1 = i * 2 * low + low + j
                rows.extend([idx0, idx0, idx1, idx1])
                cols.extend([idx0, idx1, idx0, idx1])
                vals.extend([gate_2x2[0, 0], gate_2x2[0, 1],
                             gate_2x2[1, 0], gate_2x2[1, 1]])
        return sparse.csr_matrix((vals, (rows, cols)), shape=(size, size), dtype=np.complex128)

    @staticmethod
    def _build_sparse_cnot(control: int, target: int, n_qubits: int) -> sparse.csr_matrix:
        size = 2 ** n_qubits
        rows, cols, vals = [], [], []
        for i in range(size):
            if (i >> (n_qubits - 1 - control)) & 1:
                j = i ^ (1 << (n_qubits - 1 - target))
                rows.append(j)
                cols.append(i)
                vals.append(1.0 + 0j)
            else:
                rows.append(i)
                cols.append(i)
                vals.append(1.0 + 0j)
        return sparse.csr_matrix((vals, (rows, cols)), shape=(size, size), dtype=np.complex128)

    def apply_gate_sparse(self, gate: sparse.csr_matrix):
        self.state_vector = gate.dot(self.state_vector)
        self._invalidate_cache()

    def apply_hadamard(self, target: int):
        H = np.array([[1, 1], [1, -1]], dtype=np.complex128) / np.sqrt(2)
        self.apply_single_qubit_gate_direct(H, target)

    def apply_cnot(self, control: int, target: int):
        self.apply_cnot_direct(control, target)

    def apply_x(self, target: int):
        X = np.array([[0, 1], [1, 0]], dtype=np.complex128)
        self.apply_single_qubit_gate_direct(X, target)

    def apply_y(self, target: int):
        Y = np.array([[0, -1j], [1j, 0]], dtype=np.complex128)
        self.apply_single_qubit_gate_direct(Y, target)

    def apply_z(self, target: int):
        Z = np.array([[1, 0], [0, -1]], dtype=np.complex128)
        self.apply_single_qubit_gate_direct(Z, target)

    def density_matrix_sparse(self) -> sparse.csr_matrix:
        if self._cache_valid and self._density_matrix_cache is not None:
            return self._density_matrix_cache
        n = self.size
        threshold = 0.1
        rows, cols, vals = [], [], []
        for i in range(n):
            for j in range(n):
                val = self.state_vector[i] * np.conj(self.state_vector[j])
                if abs(val) > threshold * 1e-15:
                    rows.append(i)
                    cols.append(j)
                    vals.append(val)
        dm = sparse.csr_matrix((vals, (rows, cols)), shape=(n, n), dtype=np.complex128)
        self._density_matrix_cache = dm
        self._cache_valid = True
        return dm

    def density_matrix(self) -> np.ndarray:
        return np.outer(self.state_vector, np.conj(self.state_vector))

    def reduced_density_matrix(self, qubit_index: int) -> np.ndarray:
        if self.n_qubits == 1:
            return self.density_matrix()
        n = self.n_qubits
        sv = self.state_vector
        low = 2 ** qubit_index
        high = 2 ** (n - 1 - qubit_index)
        reduced = np.zeros((2, 2), dtype=np.complex128)
        for i in range(high):
            for j in range(low):
                idx0 = i * 2 * low + j
                idx1 = i * 2 * low + low + j
                reduced[0, 0] += sv[idx0] * np.conj(sv[idx0])
                reduced[0, 1] += sv[idx0] * np.conj(sv[idx1])
                reduced[1, 0] += sv[idx1] * np.conj(sv[idx0])
                reduced[1, 1] += sv[idx1] * np.conj(sv[idx1])
        return reduced

    def to_bloch_sphere(self, qubit_index: int = 0) -> Tuple[float, float, float]:
        if self.n_qubits == 1:
            alpha = self.state_vector[0]
            beta = self.state_vector[1]
        else:
            rho = self.reduced_density_matrix(qubit_index)
            alpha = np.sqrt(np.clip(rho[0, 0].real, 0, 1))
            if abs(alpha) > 1e-10:
                beta = rho[0, 1] / alpha
            else:
                beta = 1.0 + 0j
        alpha_mag = np.abs(alpha)
        if alpha_mag < 1e-10:
            theta = np.pi
            phi = np.angle(beta)
        else:
            theta = 2 * np.arccos(min(1.0, alpha_mag))
            phi = np.angle(beta / alpha)
        x = np.sin(theta) * np.cos(phi)
        y = np.sin(theta) * np.sin(phi)
        z = np.cos(theta)
        return float(x), float(y), float(z)

    def to_quaternion(self, qubit_index: int = 0) -> np.ndarray:
        x, y, z = self.to_bloch_sphere(qubit_index)
        theta = np.arccos(np.clip(z, -1.0, 1.0))
        phi = np.arctan2(y, x)
        w = np.cos(theta / 2)
        qx = np.sin(theta / 2) * np.cos(phi)
        qy = np.sin(theta / 2) * np.sin(phi)
        qz = 0.0
        norm = np.sqrt(w * w + qx * qx + qy * qy + qz * qz)
        if norm < 1e-15:
            return np.array([1.0, 0.0, 0.0, 0.0], dtype=np.float64)
        return np.array([w / norm, qx / norm, qy / norm, qz / norm], dtype=np.float64)

    @staticmethod
    def quaternion_to_bloch(q: np.ndarray) -> Tuple[float, float, float]:
        norm = np.sqrt(q[0] ** 2 + q[1] ** 2 + q[2] ** 2 + q[3] ** 2)
        if norm < 1e-15:
            return 0.0, 0.0, 1.0
        w = q[0] / norm
        qx = q[1] / norm
        qy = q[2] / norm
        theta = 2 * np.arccos(np.clip(abs(w), 0.0, 1.0))
        sin_half = np.sqrt(qx * qx + qy * qy)
        if sin_half < 1e-10:
            z = 1.0 if w >= 0 else -1.0
            return 0.0, 0.0, z
        phi = np.arctan2(qy, qx)
        x = np.sin(theta) * np.cos(phi)
        y = np.sin(theta) * np.sin(phi)
        z = np.cos(theta)
        return float(x), float(y), float(z)

    @staticmethod
    def quaternion_slerp(q1: np.ndarray, q2: np.ndarray, t: float) -> np.ndarray:
        n1 = np.sqrt(q1[0] ** 2 + q1[1] ** 2 + q1[2] ** 2 + q1[3] ** 2)
        n2 = np.sqrt(q2[0] ** 2 + q2[1] ** 2 + q2[2] ** 2 + q2[3] ** 2)
        if n1 < 1e-15 or n2 < 1e-15:
            return q1.copy()
        q1n = q1 / n1
        q2n = q2 / n2
        dot = q1n[0] * q2n[0] + q1n[1] * q2n[1] + q1n[2] * q2n[2] + q1n[3] * q2n[3]
        if dot < 0.0:
            q2n = -q2n
            dot = -dot
        dot = min(dot, 1.0)
        if dot > 0.9995:
            result = q1n + t * (q2n - q1n)
            rn = np.sqrt(result[0] ** 2 + result[1] ** 2 + result[2] ** 2 + result[3] ** 2)
            return result / rn
        theta_0 = np.arccos(dot)
        sin_theta_0 = np.sin(theta_0)
        theta = theta_0 * t
        sin_theta = np.sin(theta)
        s0 = np.cos(theta) - dot * sin_theta / sin_theta_0
        s1 = sin_theta / sin_theta_0
        result = s0 * q1n + s1 * q2n
        rn = np.sqrt(result[0] ** 2 + result[1] ** 2 + result[2] ** 2 + result[3] ** 2)
        return result / rn

    def memory_stats(self) -> Dict[str, float]:
        sv_bytes = self.state_vector.nbytes
        dm_dense = self.size * self.size * 16
        dm_sparse_obj = self.density_matrix_sparse()
        dm_sparse_bytes = dm_sparse_obj.data.nbytes + dm_sparse_obj.indices.nbytes + dm_sparse_obj.indptr.nbytes
        nnz = dm_sparse_obj.nnz
        total_dense = self.size * self.size
        sparsity = 1.0 - nnz / total_dense if total_dense > 0 else 0.0
        compression_ratio = (1.0 - dm_sparse_bytes / dm_dense) * 100 if dm_dense > 0 else 0.0
        gate_dense = self.size * self.size * 16
        gate_nnz = 2 * self.size
        gate_sparse_bytes = gate_nnz * 16 + gate_nnz * 4 + (self.size + 1) * 4
        gate_compression = (1.0 - gate_sparse_bytes / gate_dense) * 100 if gate_dense > 0 else 0.0
        return {
            'n_qubits': self.n_qubits,
            'state_vector_bytes': sv_bytes,
            'density_matrix_dense_bytes': dm_dense,
            'density_matrix_sparse_bytes': dm_sparse_bytes,
            'density_matrix_compression_ratio': compression_ratio,
            'density_matrix_sparsity': sparsity * 100,
            'density_matrix_nnz': nnz,
            'gate_matrix_dense_bytes': gate_dense,
            'gate_matrix_sparse_bytes': gate_sparse_bytes,
            'gate_matrix_compression_ratio': gate_compression,
            'gate_matrix_sparsity': (1.0 - gate_nnz / (self.size * self.size)) * 100
        }


def create_bell_state_sparse(bell_type: str = "phi+") -> SparseQuantumState:
    qs = SparseQuantumState(2)
    qs.apply_hadamard(0)
    qs.apply_cnot(0, 1)
    if bell_type == "phi-":
        qs.apply_z(0)
    elif bell_type == "psi+":
        qs.apply_x(1)
    elif bell_type == "psi-":
        qs.apply_z(0)
        qs.apply_x(1)
    return qs


def create_ghz_state_sparse(n_qubits: int = 3) -> SparseQuantumState:
    if n_qubits < 2 or n_qubits > 5:
        raise ValueError("GHZ state requires 2-5 qubits")
    qs = SparseQuantumState(n_qubits)
    qs.apply_hadamard(0)
    for i in range(1, n_qubits):
        qs.apply_cnot(0, i)
    return qs
