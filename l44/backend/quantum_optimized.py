import numpy as np
from typing import List, Tuple


def fast_kron(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    a_shape0, a_shape1 = a.shape
    b_shape0, b_shape1 = b.shape
    out_shape0 = a_shape0 * b_shape0
    out_shape1 = a_shape1 * b_shape1
    out = np.zeros((out_shape0, out_shape1), dtype=np.complex128)

    for i in range(a_shape0):
        for j in range(a_shape1):
            a_ij = a[i, j]
            i_start = i * b_shape0
            i_end = i_start + b_shape0
            j_start = j * b_shape1
            j_end = j_start + b_shape1
            for k in range(b_shape0):
                for l in range(b_shape1):
                    out[i_start + k, j_start + l] = a_ij * b[k, l]
    return out


def fast_apply_gate(gate: np.ndarray, state: np.ndarray) -> np.ndarray:
    return gate @ state


def fast_probabilities(state: np.ndarray) -> np.ndarray:
    n = state.shape[0]
    probs = np.zeros(n, dtype=np.float64)
    for i in range(n):
        probs[i] = state[i].real * state[i].real + state[i].imag * state[i].imag
    return probs


def fast_density_matrix(state: np.ndarray) -> np.ndarray:
    n = state.shape[0]
    rho = np.zeros((n, n), dtype=np.complex128)
    for i in range(n):
        s_i = state[i]
        for j in range(n):
            rho[i, j] = s_i * np.conj(state[j])
    return rho


def fast_partial_transpose_2qubit(rho: np.ndarray) -> np.ndarray:
    pt = np.zeros((4, 4), dtype=np.complex128)

    mapping = [
        [0, 0, 0, 0], [0, 1, 0, 2], [0, 2, 0, 1], [0, 3, 0, 3],
        [1, 0, 1, 0], [1, 1, 1, 2], [1, 2, 1, 1], [1, 3, 1, 3],
        [2, 0, 2, 0], [2, 1, 2, 2], [2, 2, 2, 1], [2, 3, 2, 3],
        [3, 0, 3, 0], [3, 1, 3, 2], [3, 2, 3, 1], [3, 3, 3, 3]
    ]

    for m in range(16):
        i, j, k, l = mapping[m]
        pt[i, j] = rho[k, l]

    return pt


def fast_eigenvalues_2x2(rho: np.ndarray) -> np.ndarray:
    a = rho[0, 0].real
    b = rho[0, 1].real
    c = rho[0, 1].imag
    d = rho[1, 1].real

    trace = a + d
    det = a * d - (b * b + c * c)
    discriminant = max(0.0, trace * trace / 4.0 - det)
    sqrt_disc = np.sqrt(discriminant)

    return np.array([trace / 2.0 + sqrt_disc, trace / 2.0 - sqrt_disc], dtype=np.float64)


def fast_eigenvalues_hermitian(rho: np.ndarray) -> np.ndarray:
    n = rho.shape[0]
    A = rho.copy()
    d = np.zeros(n, dtype=np.float64)
    e = np.zeros(n, dtype=np.float64)

    for i in range(n - 1, 0, -1):
        scale = 0.0
        for k in range(i):
            scale += abs(A[k, i - 1].real) + abs(A[k, i - 1].imag)
        if scale == 0.0:
            e[i] = 0.0
            continue

        h = 0.0
        for k in range(i):
            A[k, i - 1] /= scale
            h += A[k, i - 1].real * A[k, i - 1].real + A[k, i - 1].imag * A[k, i - 1].imag
        f = A[i - 1, i - 1].real
        g = np.sqrt(h) if f >= 0 else -np.sqrt(h)
        e[i] = scale * g
        h -= f * g
        A[i - 1, i - 1] = f - g
        b = np.zeros(i, dtype=np.float64)

        for j in range(i):
            g = 0.0
            for k in range(j + 1):
                g += A[k, j].real * A[k, i - 1].real + A[k, j].imag * A[k, i - 1].imag
            for k in range(j + 1, i):
                g += A[j, k].real * A[k, i - 1].real + A[j, k].imag * A[k, i - 1].imag
            b[j] = g / h
        for j in range(i):
            for k in range(j + 1):
                A[k, j] -= b[j] * np.conj(A[k, i - 1]) + b[k] * A[j, i - 1]
                A[k, j] = complex(A[k, j].real, A[k, j].imag)

    for i in range(n):
        d[i] = A[i, i].real
    e[0] = 0.0

    max_iterations = 100
    for l in range(n):
        for _ in range(max_iterations):
            m = n - 1
            for mm in range(l, n - 1):
                if abs(e[mm + 1]) <= 1e-15 * (abs(d[mm]) + abs(d[mm + 1])):
                    m = mm
                    break
            if m == l:
                break

            g = (d[l + 1] - d[l]) / (2.0 * e[l + 1])
            r = np.sqrt(g * g + 1.0)
            g = d[m] - d[l] + e[l + 1] / (g + (r if g >= 0 else -r))
            s = 1.0
            c = 1.0
            p = 0.0

            for i in range(m - 1, l - 1, -1):
                f = s * e[i + 1]
                b = c * e[i + 1]
                if abs(f) > abs(g):
                    c = g / f
                    r = np.sqrt(c * c + 1.0)
                    e[i + 1] = f * r
                    s = 1.0 / r
                    c *= s
                else:
                    s = f / g
                    r = np.sqrt(s * s + 1.0)
                    e[i + 1] = g * r
                    c = 1.0 / r
                    s *= c
                g = d[i + 1] - p
                r = (d[i] - g) * s + 2.0 * c * b
                p = s * r
                d[i + 1] = g + p
                g = c * r - b

            d[l] -= p
            e[l + 1] = g
            e[m] = 0.0

    return np.sort(d)


def fast_quaternion_slerp_batch(q1_arr: np.ndarray, q2_arr: np.ndarray, steps: int) -> np.ndarray:
    result = np.zeros((steps, 4), dtype=np.float64)

    q1_norm = np.sqrt(q1_arr[0] ** 2 + q1_arr[1] ** 2 + q1_arr[2] ** 2 + q1_arr[3] ** 2)
    q2_norm = np.sqrt(q2_arr[0] ** 2 + q2_arr[1] ** 2 + q2_arr[2] ** 2 + q2_arr[3] ** 2)

    q1 = q1_arr / q1_norm
    q2 = q2_arr / q2_norm

    dot = q1[0] * q2[0] + q1[1] * q2[1] + q1[2] * q2[2] + q1[3] * q2[3]

    if dot < 0.0:
        q2 = -q2
        dot = -dot

    if dot > 0.9995:
        for t_idx in range(steps):
            t = t_idx / (steps - 1) if steps > 1 else 0.0
            for i in range(4):
                result[t_idx, i] = q1[i] + t * (q2[i] - q1[i])
            norm = np.sqrt(result[t_idx, 0] ** 2 + result[t_idx, 1] ** 2 +
                           result[t_idx, 2] ** 2 + result[t_idx, 3] ** 2)
            for i in range(4):
                result[t_idx, i] /= norm
        return result

    theta_0 = np.arccos(dot)
    sin_theta_0 = np.sin(theta_0)

    for t_idx in range(steps):
        t = t_idx / (steps - 1) if steps > 1 else 0.0
        theta = theta_0 * t
        sin_theta = np.sin(theta)

        s0 = np.cos(theta) - dot * sin_theta / sin_theta_0
        s1 = sin_theta / sin_theta_0

        for i in range(4):
            result[t_idx, i] = s0 * q1[i] + s1 * q2[i]

    return result


def fast_quaternion_to_bloch_batch(quaternions: np.ndarray) -> np.ndarray:
    n = quaternions.shape[0]
    result = np.zeros((n, 3), dtype=np.float64)

    for i in range(n):
        w = quaternions[i, 0]
        qx = quaternions[i, 1]
        qy = quaternions[i, 2]
        qz = quaternions[i, 3]

        norm = np.sqrt(w * w + qx * qx + qy * qy + qz * qz)
        w /= norm
        qx /= norm
        qy /= norm
        qz /= norm

        sin_half_theta = np.sqrt(qx * qx + qy * qy + qz * qz)

        if sin_half_theta < 1e-10:
            result[i, 0] = 0.0
            result[i, 1] = 0.0
            result[i, 2] = 1.0
        else:
            half_theta = np.arcsin(min(1.0, sin_half_theta))
            theta = 2.0 * half_theta
            phi = np.arctan2(qy, qx)

            result[i, 0] = np.sin(theta) * np.cos(phi)
            result[i, 1] = np.sin(theta) * np.sin(phi)
            result[i, 2] = np.cos(theta)

    return result


def fast_bloch_coordinates(state: np.ndarray) -> np.ndarray:
    alpha = state[0]
    beta = state[1]

    alpha_mag = np.sqrt(alpha.real * alpha.real + alpha.imag * alpha.imag)

    if alpha_mag < 1e-10:
        theta = np.pi
        phi = np.arctan2(beta.imag, beta.real)
    else:
        theta = 2.0 * np.arccos(min(1.0, alpha_mag))
        beta_over_alpha_real = (beta.real * alpha.real + beta.imag * alpha.imag) / (alpha_mag * alpha_mag)
        beta_over_alpha_imag = (beta.imag * alpha.real - beta.real * alpha.imag) / (alpha_mag * alpha_mag)
        phi = np.arctan2(beta_over_alpha_imag, beta_over_alpha_real)

    x = np.sin(theta) * np.cos(phi)
    y = np.sin(theta) * np.sin(phi)
    z = np.cos(theta)

    return np.array([x, y, z], dtype=np.float64)


def fast_cnot(control: int, target: int, n_qubits: int) -> np.ndarray:
    size = 2 ** n_qubits
    cnot = np.zeros((size, size), dtype=np.complex128)

    for i in range(size):
        bits = [0] * n_qubits
        temp = i
        for q in range(n_qubits):
            bits[n_qubits - 1 - q] = temp & 1
            temp >>= 1

        if bits[control] == 1:
            bits[target] = 1 - bits[target]

        j = 0
        for b in bits:
            j = (j << 1) | b

        cnot[j, i] = 1.0 + 0.0j

    return cnot
