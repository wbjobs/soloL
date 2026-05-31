import numpy as np
from typing import List, Tuple, Optional, Union


def _kron(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    return np.kron(a, b)


def _matmul(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    return a @ b


def _apply_gate(gate: np.ndarray, state: np.ndarray) -> np.ndarray:
    return gate @ state


class QuantumGate:
    H = np.array([[1, 1], [1, -1]], dtype=np.complex128) / np.sqrt(2)
    X = np.array([[0, 1], [1, 0]], dtype=np.complex128)
    Y = np.array([[0, -1j], [1j, 0]], dtype=np.complex128)
    Z = np.array([[1, 0], [0, -1]], dtype=np.complex128)
    I = np.eye(2, dtype=np.complex128)
    S = np.array([[1, 0], [0, 1j]], dtype=np.complex128)
    T = np.array([[1, 0], [0, np.exp(1j * np.pi / 4)]], dtype=np.complex128)

    @staticmethod
    def CNOT(control: int, target: int, n_qubits: int) -> np.ndarray:
        if control >= n_qubits or target >= n_qubits:
            raise ValueError("Control/target qubit index out of range")
        if control == target:
            raise ValueError("Control and target qubits must be different")

        size = 2 ** n_qubits
        cnot = np.zeros((size, size), dtype=np.complex128)

        for i in range(size):
            bits = [(i >> (n_qubits - 1 - q)) & 1 for q in range(n_qubits)]
            if bits[control] == 1:
                bits[target] = 1 - bits[target]
            j = 0
            for b in bits:
                j = (j << 1) | b
            cnot[j, i] = 1.0

        return cnot

    @staticmethod
    def Hadamard(target: int, n_qubits: int) -> np.ndarray:
        if target >= n_qubits:
            raise ValueError("Target qubit index out of range")

        gate = np.array([[1.0 + 0j]], dtype=np.complex128)
        for i in range(n_qubits):
            if i == target:
                gate = _kron(gate, QuantumGate.H)
            else:
                gate = _kron(gate, QuantumGate.I)
        return gate

    @staticmethod
    def apply_single_qubit_gate(single_gate: np.ndarray, target: int, n_qubits: int) -> np.ndarray:
        if target >= n_qubits:
            raise ValueError("Target qubit index out of range")

        gate = np.array([[1.0 + 0j]], dtype=np.complex128)
        for i in range(n_qubits):
            if i == target:
                gate = _kron(gate, single_gate)
            else:
                gate = _kron(gate, QuantumGate.I)
        return gate


class QuantumState:
    def __init__(self, n_qubits: int = 1):
        if n_qubits < 1 or n_qubits > 5:
            raise ValueError("Number of qubits must be between 1 and 5")

        self.n_qubits = n_qubits
        self.size = 2 ** n_qubits
        self.state_vector = np.zeros(self.size, dtype=np.complex128)
        self.state_vector[0] = 1.0

    @classmethod
    def from_state_vector(cls, state_vector: np.ndarray) -> 'QuantumState':
        state_vector = np.asarray(state_vector, dtype=np.complex128)
        size = state_vector.shape[0]
        n_qubits = int(np.log2(size))

        if 2 ** n_qubits != size:
            raise ValueError("State vector size must be a power of 2")
        if n_qubits > 5:
            raise ValueError("Maximum 5 qubits supported")

        qs = cls(n_qubits)
        qs.state_vector = state_vector / np.linalg.norm(state_vector)
        return qs

    @classmethod
    def from_bloch_sphere(cls, theta: float, phi: float) -> 'QuantumState':
        qs = cls(1)
        qs.state_vector[0] = np.cos(theta / 2)
        qs.state_vector[1] = np.sin(theta / 2) * np.exp(1j * phi)
        return qs

    def to_bloch_sphere(self, qubit_index: int = 0) -> Tuple[float, float, float]:
        if self.n_qubits == 1:
            alpha = self.state_vector[0]
            beta = self.state_vector[1]
        else:
            rho = self.reduced_density_matrix(qubit_index)
            alpha = np.sqrt(rho[0, 0])
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

        return x, y, z

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

        return x, y, z

    @staticmethod
    def quaternion_slerp(q1: np.ndarray, q2: np.ndarray, t: float) -> np.ndarray:
        n1 = np.sqrt(q1[0] ** 2 + q1[1] ** 2 + q1[2] ** 2 + q1[3] ** 2)
        n2 = np.sqrt(q2[0] ** 2 + q2[1] ** 2 + q2[2] ** 2 + q2[3] ** 2)
        if n1 < 1e-15 or n2 < 1e-15:
            return q1.copy()
        q1 = q1 / n1
        q2 = q2 / n2

        dot = np.dot(q1, q2)

        if dot < 0.0:
            q2 = -q2
            dot = -dot

        dot = min(dot, 1.0)

        if dot > 0.9995:
            result = q1 + t * (q2 - q1)
            rn = np.sqrt(result[0] ** 2 + result[1] ** 2 + result[2] ** 2 + result[3] ** 2)
            return result / rn

        theta_0 = np.arccos(dot)
        sin_theta_0 = np.sin(theta_0)

        theta = theta_0 * t
        sin_theta = np.sin(theta)

        s0 = np.cos(theta) - dot * sin_theta / sin_theta_0
        s1 = sin_theta / sin_theta_0

        result = s0 * q1 + s1 * q2
        rn = np.sqrt(result[0] ** 2 + result[1] ** 2 + result[2] ** 2 + result[3] ** 2)
        return result / rn

    def density_matrix(self) -> np.ndarray:
        return np.outer(self.state_vector, np.conj(self.state_vector))

    def reduced_density_matrix(self, qubit_index: int) -> np.ndarray:
        if self.n_qubits == 1:
            return self.density_matrix()

        rho = self.density_matrix()
        dim = 2 ** self.n_qubits
        trace_out = 2 ** (self.n_qubits - 1 - qubit_index)
        stride = 2 * trace_out

        reduced = np.zeros((2, 2), dtype=np.complex128)

        for i in range(2):
            for j in range(2):
                val = 0.0 + 0.0
                for k in range(trace_out):
                    for l in range(trace_out):
                        base_i = (i * trace_out + k) + (l // trace_out) * stride
                        base_j = (j * trace_out + k) + (l // trace_out) * stride
                        val += rho[base_i, base_j]
                reduced[i, j] = val

        return reduced

    def apply_gate(self, gate: np.ndarray) -> None:
        if gate.shape != (self.size, self.size):
            raise ValueError(f"Gate size {gate.shape} does not match state size {self.size}")
        self.state_vector = _apply_gate(gate, self.state_vector)

    def apply_hadamard(self, target: int) -> None:
        gate = QuantumGate.Hadamard(target, self.n_qubits)
        self.apply_gate(gate)

    def apply_cnot(self, control: int, target: int) -> None:
        gate = QuantumGate.CNOT(control, target, self.n_qubits)
        self.apply_gate(gate)

    def apply_x(self, target: int) -> None:
        gate = QuantumGate.apply_single_qubit_gate(QuantumGate.X, target, self.n_qubits)
        self.apply_gate(gate)

    def apply_y(self, target: int) -> None:
        gate = QuantumGate.apply_single_qubit_gate(QuantumGate.Y, target, self.n_qubits)
        self.apply_gate(gate)

    def apply_z(self, target: int) -> None:
        gate = QuantumGate.apply_single_qubit_gate(QuantumGate.Z, target, self.n_qubits)
        self.apply_gate(gate)

    def measure(self, shots: int = 1) -> np.ndarray:
        probs = np.abs(self.state_vector) ** 2
        results = np.random.choice(self.size, size=shots, p=probs)

        outcomes = []
        for r in results:
            bits = format(r, f'0{self.n_qubits}b')
            outcomes.append([int(b) for b in bits])

        return np.array(outcomes)

    def __str__(self) -> str:
        state_str = "QuantumState(\n"
        for i, amp in enumerate(self.state_vector):
            bits = format(i, f'0{self.n_qubits}b')
            state_str += f"  |{bits}⟩: {amp.real:.4f} + {amp.imag:.4f}j\n"
        state_str += ")"
        return state_str

    def __repr__(self) -> str:
        return self.__str__()


def create_bell_state(bell_type: str = "phi+") -> QuantumState:
    qs = QuantumState(2)
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


def create_ghz_state(n_qubits: int = 3) -> QuantumState:
    if n_qubits < 2 or n_qubits > 5:
        raise ValueError("GHZ state requires 2-5 qubits")

    qs = QuantumState(n_qubits)
    qs.apply_hadamard(0)

    for i in range(1, n_qubits):
        qs.apply_cnot(0, i)

    return qs


def interpolate_states(qs1: QuantumState, qs2: QuantumState, steps: int = 50,
                       qubit_index: int = 0) -> List[Tuple[float, float, float]]:
    if qs1.n_qubits != qs2.n_qubits:
        raise ValueError("States must have the same number of qubits")

    q1 = qs1.to_quaternion(qubit_index)
    q2 = qs2.to_quaternion(qubit_index)

    bloch_points = []
    for t in np.linspace(0, 1, steps):
        q_interp = QuantumState.quaternion_slerp(q1, q2, t)
        x, y, z = QuantumState.quaternion_to_bloch(q_interp)
        bloch_points.append((x, y, z))

    return bloch_points
