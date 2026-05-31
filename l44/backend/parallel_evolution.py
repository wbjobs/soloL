import numpy as np
from typing import List, Dict, Any, Optional
from concurrent.futures import ProcessPoolExecutor, as_completed
from quantum_core import QuantumState
from entanglement_detection import detect_entanglement, von_neumann_entropy
import multiprocessing


def _evolve_single(task: Dict[str, Any]) -> Dict[str, Any]:
    n_qubits = task['n_qubits']
    sv_data = task.get('state_vector')
    gates = task.get('gates', [])
    label = task.get('label', '')

    if sv_data:
        sv = np.array([complex(re, im) for re, im in sv_data], dtype=np.complex128)
        qs = QuantumState.from_state_vector(sv)
    else:
        qs = QuantumState(n_qubits)

    for gate in gates:
        gt = gate['gate_type'].upper()
        target = gate['target_qubit']
        if gt == 'H':
            qs.apply_hadamard(target)
        elif gt == 'X':
            qs.apply_x(target)
        elif gt == 'Y':
            qs.apply_y(target)
        elif gt == 'Z':
            qs.apply_z(target)
        elif gt == 'CNOT':
            control = gate.get('control_qubit', 0)
            qs.apply_cnot(control, target)

    bloch_spheres = []
    for i in range(qs.n_qubits):
        x, y, z = qs.to_bloch_sphere(i)
        q = qs.to_quaternion(i)
        bloch_spheres.append({
            'qubit': i,
            'x': float(x),
            'y': float(y),
            'z': float(z),
            'quaternion': [float(q[0]), float(q[1]), float(q[2]), float(q[3])]
        })

    dm = qs.density_matrix()
    ent_result = detect_entanglement(qs)

    state_vector = [[c.real, c.imag] for c in qs.state_vector]
    entropies = []
    for i in range(qs.n_qubits):
        rho_i = qs.reduced_density_matrix(i)
        entropies.append(float(von_neumann_entropy(rho_i)))

    return {
        'label': label,
        'n_qubits': qs.n_qubits,
        'state_vector': state_vector,
        'bloch_spheres': bloch_spheres,
        'density_matrix': {
            'real': dm.real.tolist(),
            'imag': dm.imag.tolist()
        },
        'entanglement_result': ent_result,
        'entropies': entropies
    }


def parallel_evolve(tasks: List[Dict[str, Any]], max_workers: Optional[int] = None) -> List[Dict[str, Any]]:
    if max_workers is None:
        max_workers = min(len(tasks), multiprocessing.cpu_count())

    if len(tasks) <= 1 or max_workers <= 1:
        return [_evolve_single(task) for task in tasks]

    results = [None] * len(tasks)
    with ProcessPoolExecutor(max_workers=max_workers) as executor:
        future_map = {executor.submit(_evolve_single, task): i for i, task in enumerate(tasks)}
        for future in as_completed(future_map):
            idx = future_map[future]
            results[idx] = future.result()

    return results
