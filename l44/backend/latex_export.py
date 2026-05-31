import numpy as np
from typing import Dict, List, Optional, Any


def _complex_to_latex(c: complex, precision: int = 4) -> str:
    re = c.real
    im = c.imag
    if abs(re) < 1e-10 and abs(im) < 1e-10:
        return '0'
    if abs(im) < 1e-10:
        return f'{re:.{precision}f}'
    if abs(re) < 1e-10:
        if abs(im - 1.0) < 1e-10:
            return 'i'
        if abs(im + 1.0) < 1e-10:
            return '-i'
        return f'{im:.{precision}f}i'
    sign = '+' if im > 0 else '-'
    aim = abs(im)
    if abs(aim - 1.0) < 1e-10:
        return f'{re:.{precision}f}{sign}i'
    return f'{re:.{precision}f}{sign}{aim:.{precision}f}i'


def state_vector_to_latex(state_vector: np.ndarray, n_qubits: int,
                          precision: int = 4) -> str:
    lines = []
    lines.append(r'\begin{equation}')
    lines.append(r'|\psi\rangle = ')
    terms = []
    for i, amp in enumerate(state_vector):
        if abs(amp) < 1e-10:
            continue
        bits = format(i, f'0{n_qubits}b')
        amp_str = _complex_to_latex(amp, precision)
        if abs(amp.real - 1.0) < 1e-10 and abs(amp.imag) < 1e-10:
            terms.append(f'|{bits}\\rangle')
        elif abs(amp.real + 1.0) < 1e-10 and abs(amp.imag) < 1e-10:
            terms.append(f'-|{bits}\\rangle')
        else:
            terms.append(f'{amp_str}|{bits}\\rangle')
    if not terms:
        terms.append('0')
    lines.append(' + '.join(terms).replace('+ -', '- '))
    lines.append(r'\end{equation}')
    return '\n'.join(lines)


def density_matrix_to_latex(dm: np.ndarray, precision: int = 4) -> str:
    n = dm.shape[0]
    lines = []
    lines.append(r'\begin{equation}')
    lines.append(r'\rho = \begin{pmatrix}')
    for i in range(n):
        row_parts = []
        for j in range(n):
            row_parts.append(_complex_to_latex(dm[i, j], precision))
        lines.append(' & '.join(row_parts) + r' \\')
    lines.append(r'\end{pmatrix}')
    lines.append(r'\end{equation}')
    return '\n'.join(lines)


def entanglement_spectrum_to_latex(eigenvalues: np.ndarray, precision: int = 4) -> str:
    lines = []
    lines.append(r'\begin{equation}')
    lines.append(r'\text{Entanglement Spectrum:}')
    lines.append(r'\end{equation}')
    lines.append(r'\begin{equation}')
    sorted_eigs = sorted(eigenvalues.real, reverse=True)
    spec_parts = []
    for ev in sorted_eigs:
        spec_parts.append(f'{ev:.{precision}f}')
    lines.append(r'\sigma(\rho^{T_B}) = \{' + ', '.join(spec_parts) + r'\}')
    lines.append(r'\end{equation}')
    return '\n'.join(lines)


def concurrence_to_latex(concurrence: float, entanglement_of_formation: float,
                         precision: int = 4) -> str:
    lines = []
    lines.append(r'\begin{equation}')
    lines.append(f'C(\\rho) = {concurrence:.{precision}f}')
    lines.append(r'\end{equation}')
    lines.append(r'\begin{equation}')
    lines.append(f'E_F(\\rho) = {entanglement_of_formation:.{precision}f}')
    lines.append(r'\end{equation}')
    return '\n'.join(lines)


def von_neumann_entropy_to_latex(entropy: float, precision: int = 4) -> str:
    lines = []
    lines.append(r'\begin{equation}')
    lines.append(f'S(\\rho) = -\\text{{Tr}}(\\rho \\log_2 \\rho) = {entropy:.{precision}f}')
    lines.append(r'\end{equation}')
    return '\n'.join(lines)


def export_full_latex(entanglement_result: Dict[str, Any],
                      precision: int = 4) -> str:
    sections = []

    n_qubits = entanglement_result.get('n_qubits', 1)
    sv_data = entanglement_result.get('state_vector', [])
    if sv_data:
        sv = np.array([complex(re, im) for re, im in sv_data], dtype=np.complex128)
        sections.append('%% Quantum State Vector')
        sections.append(state_vector_to_latex(sv, n_qubits, precision))
        sections.append('')

    dm_data = entanglement_result.get('density_matrix')
    if dm_data:
        dm = dm_data['real'] + 1j * np.array(dm_data['imag'])
        sections.append('%% Density Matrix')
        sections.append(density_matrix_to_latex(dm, precision))
        sections.append('')

    ppt = entanglement_result.get('ppt_criterion', {})
    if ppt and 'eigenvalues' in ppt and ppt.get('eigenvalues'):
        eigs = np.array(ppt['eigenvalues'])
        sections.append('%% Entanglement Spectrum (Partial Transpose)')
        sections.append(entanglement_spectrum_to_latex(eigs, precision))
        sections.append('')

    conc = entanglement_result.get('concurrence', {})
    if conc and 'concurrence' in conc:
        sections.append('%% Concurrence')
        sections.append(concurrence_to_latex(
            conc.get('concurrence', 0.0),
            conc.get('entanglement_of_formation', 0.0),
            precision
        ))
        sections.append('')

    vne = entanglement_result.get('von_neumann_entropy')
    if vne is not None:
        sections.append('%% Von Neumann Entropy')
        sections.append(von_neumann_entropy_to_latex(float(vne), precision))
        sections.append('')

    rdms = entanglement_result.get('reduced_density_matrices', [])
    for rdm in rdms:
        qubit = rdm.get('qubit', 0)
        rdm_matrix = np.array(rdm['real']) + 1j * np.array(rdm['imag'])
        sections.append(f'%% Reduced Density Matrix - Qubit {qubit}')
        sections.append(density_matrix_to_latex(rdm_matrix, precision))
        if 'entropy' in rdm:
            sections.append(von_neumann_entropy_to_latex(float(rdm['entropy']), precision))
        sections.append('')

    pairwise = entanglement_result.get('pairwise_entanglement', [])
    for pair in pairwise:
        qubits = pair.get('qubits', [0, 0])
        sections.append(f'%% Pairwise Entanglement: Qubit {qubits[0]} & {qubits[1]}')
        pair_conc = pair.get('concurrence', {})
        if 'concurrence' in pair_conc:
            sections.append(concurrence_to_latex(
                pair_conc.get('concurrence', 0.0),
                pair_conc.get('entanglement_of_formation', 0.0),
                precision
            ))
        sections.append('')

    return '\n'.join(sections)
