import numpy as np
from scipy.linalg import sqrtm as scipy_sqrtm
from typing import Tuple, Optional, Dict, Union, List
from quantum_core import QuantumState


def _partial_transpose_2qubit(rho: np.ndarray) -> np.ndarray:
    pt = np.zeros_like(rho, dtype=np.complex128)
    pt[0, 0] = rho[0, 0]
    pt[0, 1] = rho[1, 0]
    pt[0, 2] = rho[0, 2]
    pt[0, 3] = rho[1, 2]
    pt[1, 0] = rho[0, 1]
    pt[1, 1] = rho[1, 1]
    pt[1, 2] = rho[0, 3]
    pt[1, 3] = rho[1, 3]
    pt[2, 0] = rho[2, 0]
    pt[2, 1] = rho[3, 0]
    pt[2, 2] = rho[2, 2]
    pt[2, 3] = rho[3, 2]
    pt[3, 0] = rho[2, 1]
    pt[3, 1] = rho[3, 1]
    pt[3, 2] = rho[2, 3]
    pt[3, 3] = rho[3, 3]
    return pt


def _eigenvalues_reduced(rho: np.ndarray) -> np.ndarray:
    a = rho[0, 0].real
    b = rho[0, 1].real
    c = rho[0, 1].imag
    d = rho[1, 1].real

    trace = a + d
    det = a * d - (b * b + c * c)

    discriminant = max(0.0, trace * trace / 4 - det)
    sqrt_disc = np.sqrt(discriminant)

    return np.array([trace / 2 + sqrt_disc, trace / 2 - sqrt_disc], dtype=np.float64)


def partial_transpose(rho: np.ndarray, subsystem: int = 1,
                      dims: Optional[Tuple[int, int]] = None) -> np.ndarray:
    if dims is None:
        n = int(np.log2(rho.shape[0]))
        dims = (2 ** (n - subsystem), 2 ** subsystem)

    d1, d2 = dims
    if rho.shape != (d1 * d2, d1 * d2):
        raise ValueError("Density matrix dimensions do not match subsystem dimensions")

    rho_reshaped = rho.reshape(d1, d2, d1, d2)
    rho_pt = rho_reshaped.transpose(0, 3, 2, 1)
    return rho_pt.reshape(d1 * d2, d1 * d2)


def ppt_criterion(rho: np.ndarray, dims: Optional[Tuple[int, int]] = None,
                  threshold: float = 1e-10) -> Dict[str, Union[bool, float, List[float]]]:
    if dims is None:
        n = int(np.log2(rho.shape[0]))
        if n == 2:
            dims = (2, 2)
        else:
            dims = (2, 2 ** (n - 1))

    try:
        rho_pt = partial_transpose(rho, 1, dims)
        eigenvalues = np.linalg.eigvalsh(rho_pt)
        min_eigenvalue = float(np.min(eigenvalues.real))

        is_entangled = min_eigenvalue < -threshold
        negativity = float(np.sum(np.maximum(-eigenvalues.real, 0)))
        log_negativity = float(np.log2(2 * negativity + 1)) if negativity > 0 else 0.0

        return {
            'is_entangled': bool(is_entangled),
            'min_eigenvalue': min_eigenvalue,
            'negativity': negativity,
            'log_negativity': log_negativity,
            'eigenvalues': eigenvalues.real.tolist()
        }
    except Exception as e:
        return {
            'is_entangled': False,
            'min_eigenvalue': 0.0,
            'negativity': 0.0,
            'log_negativity': 0.0,
            'eigenvalues': [],
            'error': str(e)
        }


def _concurrence_2qubit_fast(rho: np.ndarray) -> Dict[str, Union[float, bool]]:
    if rho.shape != (4, 4):
        return {'concurrence': 0.0, 'entanglement_of_formation': 0.0, 'is_entangled': False}

    sigma_y = np.array([[0, -1j], [1j, 0]], dtype=np.complex128)
    sigma_y_sigma_y = np.kron(sigma_y, sigma_y)

    rho_tilde = sigma_y_sigma_y @ np.conj(rho) @ sigma_y_sigma_y

    R = scipy_sqrtm(rho) @ rho_tilde @ scipy_sqrtm(rho)
    eigenvalues = np.sort(np.linalg.eigvalsh(R).real)[::-1]

    sqrt_eig = np.sqrt(np.maximum(eigenvalues, 0))
    C = max(0.0, sqrt_eig[0] - sqrt_eig[1] - sqrt_eig[2] - sqrt_eig[3])

    if C > 0:
        h_arg = (1 + np.sqrt(1 - C * C)) / 2
        h_arg = np.clip(h_arg, 1e-10, 1 - 1e-10)
        E = -h_arg * np.log2(h_arg) - (1 - h_arg) * np.log2(1 - h_arg)
    else:
        E = 0.0

    return {
        'concurrence': float(C),
        'entanglement_of_formation': float(E),
        'is_entangled': bool(C > 1e-10)
    }


concurrence_2qubit = _concurrence_2qubit_fast


def von_neumann_entropy(rho: np.ndarray, base: float = 2) -> float:
    eigenvalues = np.linalg.eigvalsh(rho)
    eigenvalues = np.maximum(eigenvalues.real, 1e-20)
    entropy = -np.sum(eigenvalues * np.log(eigenvalues) / np.log(base))
    return float(entropy)


def mutual_information(qs: QuantumState, subsystems: Optional[Tuple[int, List[int]]] = None) -> float:
    if subsystems is None:
        if qs.n_qubits < 2:
            return 0.0
        subsystems = ([0], list(range(1, qs.n_qubits)))

    subsystem_a, subsystem_b = subsystems

    rho_full = qs.density_matrix()
    S_full = von_neumann_entropy(rho_full)

    rho_a = reduce_density_matrix_vectorized(qs, subsystem_a)
    S_a = von_neumann_entropy(rho_a)

    rho_b = reduce_density_matrix_vectorized(qs, subsystem_b)
    S_b = von_neumann_entropy(rho_b)

    return S_a + S_b - S_full


def reduce_density_matrix_vectorized(qs: QuantumState, keep_indices: List[int]) -> np.ndarray:
    n = qs.n_qubits
    keep_indices = sorted(keep_indices)
    trace_indices = [i for i in range(n) if i not in keep_indices]

    if not trace_indices:
        return qs.density_matrix()

    sv = qs.state_vector
    dim = 2 ** n
    keep_dim = 2 ** len(keep_indices)
    trace_dim = 2 ** len(trace_indices)

    idx_map_keep = np.zeros(dim, dtype=np.int64)
    idx_map_trace = np.zeros(dim, dtype=np.int64)

    for s in range(dim):
        k_val = 0
        t_val = 0
        for q in keep_indices:
            bit = (s >> (n - 1 - q)) & 1
            k_val = (k_val << 1) | bit
        for q in trace_indices:
            bit = (s >> (n - 1 - q)) & 1
            t_val = (t_val << 1) | bit
        idx_map_keep[s] = k_val
        idx_map_trace[s] = t_val

    result = np.zeros((keep_dim, keep_dim), dtype=np.complex128)

    for t in range(trace_dim):
        mask = idx_map_trace == t
        sv_slice = sv[mask]
        k_indices = idx_map_keep[mask]
        outer = np.outer(sv_slice, np.conj(sv_slice))
        for i_local in range(len(k_indices)):
            for j_local in range(len(k_indices)):
                result[k_indices[i_local], k_indices[j_local]] += outer[i_local, j_local]

    return result


def reduce_density_matrix_general(qs: QuantumState, keep_indices: List[int]) -> np.ndarray:
    return reduce_density_matrix_vectorized(qs, keep_indices)


def expand_indices(keep_val: int, keep_indices: List[int],
                   trace_val: int, trace_indices: List[int],
                   n_qubits: int) -> int:
    result = 0
    keep_idx = 0
    trace_idx = 0

    for qubit in range(n_qubits):
        result <<= 1
        if qubit in keep_indices:
            bit = (keep_val >> (len(keep_indices) - 1 - keep_idx)) & 1
            result |= bit
            keep_idx += 1
        else:
            bit = (trace_val >> (len(trace_indices) - 1 - trace_idx)) & 1
            result |= bit
            trace_idx += 1

    return result


def detect_entanglement(qs: QuantumState) -> Dict[str, Union[bool, float, Dict]]:
    dm = qs.density_matrix()
    result = {
        'n_qubits': qs.n_qubits,
        'state_vector': [[c.real, c.imag] for c in qs.state_vector],
        'density_matrix': {
            'real': dm.real.tolist(),
            'imag': dm.imag.tolist()
        }
    }

    if qs.n_qubits == 1:
        result.update({
            'is_entangled': False,
            'message': 'Single qubit states cannot be entangled',
            'von_neumann_entropy': von_neumann_entropy(dm)
        })
        return result

    if qs.n_qubits == 2:
        ppt_result = ppt_criterion(dm, dims=(2, 2))
        concurrence_result = _concurrence_2qubit_fast(dm)

        rdm_list = []
        for i in range(2):
            rho_i = qs.reduced_density_matrix(i)
            rdm_list.append({
                'qubit': i,
                'real': rho_i.real.tolist(),
                'imag': rho_i.imag.tolist(),
                'entropy': von_neumann_entropy(rho_i)
            })

        result.update({
            'is_entangled': bool(ppt_result['is_entangled'] or concurrence_result['is_entangled']),
            'ppt_criterion': ppt_result,
            'concurrence': concurrence_result,
            'mutual_information': float(mutual_information(qs)),
            'reduced_density_matrices': rdm_list
        })

        return result

    rdm_list = []
    for i in range(qs.n_qubits):
        rho_i = qs.reduced_density_matrix(i)
        rdm_list.append({
            'qubit': i,
            'real': rho_i.real.tolist(),
            'imag': rho_i.imag.tolist(),
            'entropy': von_neumann_entropy(rho_i)
        })

    pairwise_list = []
    is_entangled = False

    for i in range(qs.n_qubits):
        for j in range(i + 1, qs.n_qubits):
            rho_pair = reduce_density_matrix_vectorized(qs, [i, j])
            ppt_pair = ppt_criterion(rho_pair, dims=(2, 2))
            conc_pair = _concurrence_2qubit_fast(rho_pair)

            pair_entangled = bool(ppt_pair['is_entangled'] or conc_pair['is_entangled'])
            if pair_entangled:
                is_entangled = True

            pairwise_list.append({
                'qubits': [i, j],
                'is_entangled': pair_entangled,
                'ppt_criterion': ppt_pair,
                'concurrence': conc_pair
            })

    global_ppt = ppt_criterion(dm, dims=(2, 2 ** (qs.n_qubits - 1)))
    is_entangled = bool(is_entangled or global_ppt['is_entangled'])

    result.update({
        'is_entangled': is_entangled,
        'pairwise_entanglement': pairwise_list,
        'ppt_criterion': {'global': global_ppt},
        'reduced_density_matrices': rdm_list
    })

    return result
