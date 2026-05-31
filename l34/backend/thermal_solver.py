from __future__ import annotations

import logging
import time
from typing import Optional

import numpy as np
from scipy import sparse
from scipy.sparse.linalg import spsolve

from models import (
    BoardData,
    CurrentSource,
    HeatFlowField,
    HeatSource,
    SimulationParams,
    SimulationResult,
)

logger = logging.getLogger(__name__)


def run_simulation(
    board: BoardData,
    heat_sources: list[HeatSource],
    current_sources: Optional[list[CurrentSource]],
    params: SimulationParams,
    k_matrices: Optional[list[np.ndarray]] = None,
    sigma_matrices: Optional[list[np.ndarray]] = None,
) -> SimulationResult:
    grid_res = params.grid_resolution
    dx = grid_res * 1e-3
    dy = grid_res * 1e-3

    rows = int(board.dimensions.height / grid_res)
    cols = int(board.dimensions.width / grid_res)

    layers = board.layers if board.layers else _get_default_layers(params)
    n_layers = len(layers)
    layer_thickness = np.array([l.thickness * 1e-3 for l in layers])

    if k_matrices is None or len(k_matrices) != n_layers:
        k_matrices = _build_layer_conductivity_matrices(board, layers, rows, cols, grid_res)

    potential_matrix = None
    current_density = None
    max_current_density = None
    joule_heat_total = None
    Q_joule = np.zeros((n_layers, rows, cols), dtype=np.float64)

    if params.enable_current_simulation and sigma_matrices:
        potential_matrix, current_density, Q_joule, joule_heat_total = _solve_current_density(
            board, current_sources or [], sigma_matrices, layers, dx, dy, layer_thickness, rows, cols, grid_res
        )

    Q_total = _build_multilayer_heat_source_array(
        heat_sources, layers, rows, cols, grid_res, layer_thickness
    )
    if params.joule_heating_coupling and params.enable_current_simulation:
        Q_total += Q_joule

    T_matrices, iterations, converged = _solve_multilayer_heat_3d(
        k_matrices, Q_total, layers, dx, dy, layer_thickness, params, rows, cols
    )

    T_all = np.array(T_matrices)
    max_temp = float(np.max(T_all))
    min_temp = float(np.min(T_all))
    avg_temp = float(np.mean(T_all))

    heat_flow = _compute_heat_flow_field(k_matrices, T_matrices, dx, dy, layer_thickness)

    return SimulationResult(
        board_id=board.board_id,
        temperature_matrices=[T.tolist() for T in T_matrices],
        layer_names=[l.name for l in layers],
        max_temp=max_temp,
        min_temp=min_temp,
        avg_temp=avg_temp,
        iterations=iterations,
        converged=converged,
        grid_rows=rows,
        grid_cols=cols,
        n_layers=n_layers,
        potential_matrix=potential_matrix.tolist() if potential_matrix is not None else None,
        current_density=current_density.tolist() if current_density is not None else None,
        max_current_density=float(np.max(current_density)) if current_density is not None else None,
        joule_heat_total=joule_heat_total,
        heat_flow=heat_flow,
    )


def _get_default_layers(params: SimulationParams) -> list:
    from models import LayerDefinition
    return [
        LayerDefinition(
            name="Single Layer",
            thickness=params.board_thickness,
            conductivity=0.3,
            electrical_conductivity=0.0,
            is_copper=False,
        ),
    ]


def _build_layer_conductivity_matrices(
    board: BoardData, layers: list, rows: int, cols: int, res: float
) -> list[np.ndarray]:
    from demo_board import K_COPPER, K_FR4
    k_matrices = []
    for layer in layers:
        k = np.full((rows, cols), layer.conductivity, dtype=np.float64)
        if layer.is_copper:
            _rasterize_traces_for_layer(k, board.traces, layer.name, res, K_COPPER)
            _rasterize_pads_for_layer(k, board.pads, layer.name, res, K_COPPER)
        k_matrices.append(k)
    return k_matrices


def _rasterize_traces_for_layer(
    k_matrix: np.ndarray, traces: list, layer_name: str, res: float, k_copper: float
) -> None:
    rows, cols = k_matrix.shape
    for t in traces:
        t_layer = getattr(t, "layer", "top")
        if t_layer in layer_name or (t_layer == "top" and "Top" in layer_name) or (t_layer == "bottom" and "Bottom" in layer_name):
            half_w = t.width / 2.0
            n_samples = max(
                int(max(abs(t.end_x - t.start_x), abs(t.end_y - t.start_y)) / (res * 0.5)),
                2,
            )
            for i in range(n_samples):
                frac = i / (n_samples - 1)
                cx = t.start_x + frac * (t.end_x - t.start_x)
                cy = t.start_y + frac * (t.end_y - t.start_y)
                r_lo = max(int((cy - half_w) / res), 0)
                r_hi = min(int((cy + half_w) / res) + 1, rows)
                c_lo = max(int((cx - half_w) / res), 0)
                c_hi = min(int((cx + half_w) / res) + 1, cols)
                k_matrix[r_lo:r_hi, c_lo:c_hi] = k_copper


def _rasterize_pads_for_layer(
    k_matrix: np.ndarray, pads: list, layer_name: str, res: float, k_copper: float
) -> None:
    rows, cols = k_matrix.shape
    for p in pads:
        p_layer = getattr(p, "layer", "top")
        if p_layer in layer_name or (p_layer == "top" and "Top" in layer_name) or (p_layer == "bottom" and "Bottom" in layer_name):
            r_lo = max(int((p.y - p.height / 2) / res), 0)
            r_hi = min(int((p.y + p.height / 2) / res) + 1, rows)
            c_lo = max(int((p.x - p.width / 2) / res), 0)
            c_hi = min(int((p.x + p.width / 2) / res) + 1, cols)
            k_matrix[r_lo:r_hi, c_lo:c_hi] = k_copper


def _build_multilayer_heat_source_array(
    heat_sources: list[HeatSource],
    layers: list,
    rows: int,
    cols: int,
    res: float,
    layer_thickness: np.ndarray,
) -> np.ndarray:
    n_layers = len(layers)
    Q = np.zeros((n_layers, rows, cols), dtype=np.float64)
    for hs in heat_sources:
        layer_idx = 0
        for i, layer in enumerate(layers):
            hs_layer = getattr(hs, "layer", "top")
            if hs_layer in layer.name or (hs_layer == "top" and "Top" in layer.name) or (hs_layer == "bottom" and "Bottom" in layer.name):
                layer_idx = i
                break
        r_lo = max(int((hs.y - hs.height / 2) / res), 0)
        r_hi = min(int((hs.y + hs.height / 2) / res) + 1, rows)
        c_lo = max(int((hs.x - hs.width / 2) / res), 0)
        c_hi = min(int((hs.x + hs.width / 2) / res) + 1, cols)
        area = (c_hi - c_lo) * res * 1e-3 * (r_hi - r_lo) * res * 1e-3
        vol = area * layer_thickness[layer_idx]
        if vol > 0:
            Q[layer_idx, r_lo:r_hi, c_lo:c_hi] = hs.power / vol
    return Q


def _solve_multilayer_heat_3d(
    k_matrices: list[np.ndarray],
    Q: np.ndarray,
    layers: list,
    dx: float,
    dy: float,
    layer_thickness: np.ndarray,
    params: SimulationParams,
    rows: int,
    cols: int,
) -> tuple[list[np.ndarray], int, bool]:
    n_layers = len(layers)
    T_amb = params.ambient_temp
    h_conv = params.convection_coeff
    tol = params.convergence_tol
    max_iter = params.max_iterations

    T = np.full((n_layers, rows, cols), T_amb, dtype=np.float64)
    source = Q.copy()

    kz = np.zeros((n_layers + 1, rows, cols), dtype=np.float64)
    for l in range(n_layers - 1):
        k1 = k_matrices[l]
        k2 = k_matrices[l + 1]
        dz1 = layer_thickness[l]
        dz2 = layer_thickness[l + 1]
        kz[l + 1] = 2 * k1 * k2 / (k1 * dz2 + k2 * dz1 + 1e-30)

    ae = np.zeros((n_layers, rows, cols), dtype=np.float64)
    aw = np.zeros((n_layers, rows, cols), dtype=np.float64)
    an = np.zeros((n_layers, rows, cols), dtype=np.float64)
    as_ = np.zeros((n_layers, rows, cols), dtype=np.float64)
    for l in range(n_layers):
        k = k_matrices[l]
        ke_int = np.zeros_like(k)
        kw_int = np.zeros_like(k)
        kn_int = np.zeros_like(k)
        ks_int = np.zeros_like(k)
        ke_int[:, :-1] = 2 * k[:, :-1] * k[:, 1:] / (k[:, :-1] + k[:, 1:] + 1e-30)
        kw_int[:, 1:] = ke_int[:, :-1]
        kn_int[:-1, :] = 2 * k[:-1, :] * k[1:, :] / (k[:-1, :] + k[1:, :] + 1e-30)
        ks_int[1:, :] = kn_int[:-1, :]
        ae[l] = ke_int / dx**2
        aw[l] = kw_int / dx**2
        an[l] = kn_int / dy**2
        as_[l] = ks_int / dy**2

    surf_conv_top = h_conv / layer_thickness[0]
    surf_conv_bot = h_conv / layer_thickness[-1]
    diag_bc = np.zeros((n_layers, rows, cols), dtype=np.float64)
    diag_bc[0] += surf_conv_top
    diag_bc[-1] += surf_conv_bot
    source[0] += surf_conv_top * T_amb
    source[-1] += surf_conv_bot * T_amb

    for l in range(n_layers):
        diag_bc[l, 0, :] += h_conv / dy
        diag_bc[l, -1, :] += h_conv / dy
        diag_bc[l, :, 0] += h_conv / dx
        diag_bc[l, :, -1] += h_conv / dx
        source[l, 0, :] += h_conv * T_amb / dy
        source[l, -1, :] += h_conv * T_amb / dy
        source[l, :, 0] += h_conv * T_amb / dx
        source[l, :, -1] += h_conv * T_amb / dx

    a_p = ae + aw + an + as_ + diag_bc
    for l in range(1, n_layers - 1):
        a_p[l] += kz[l] / (layer_thickness[l] ** 2) + kz[l + 1] / (layer_thickness[l] ** 2)
    a_p[0] += kz[1] / (layer_thickness[0] ** 2)
    a_p[-1] += kz[-2] / (layer_thickness[-1] ** 2)

    rho_jacobi = np.cos(np.pi / max(rows, cols))
    omega = 2.0 / (1.0 + np.sqrt(1.0 - rho_jacobi**2))
    omega = min(omega, 1.8)
    converged = False
    iteration = 0

    for iteration in range(1, max_iter + 1):
        T_old = T.copy()
        for l in range(n_layers):
            te = np.zeros((rows, cols))
            tw = np.zeros((rows, cols))
            tn = np.zeros((rows, cols))
            ts = np.zeros((rows, cols))
            te[:, :-1] = T[l, :, 1:]
            tw[:, 1:] = T[l, :, :-1]
            tn[:-1, :] = T[l, 1:, :]
            ts[1:, :] = T[l, :-1, :]
            laplace = ae[l] * te + aw[l] * tw + an[l] * tn + as_[l] * ts

            if l == 0:
                z_term = kz[1] * T[1] / (layer_thickness[0] ** 2)
            elif l == n_layers - 1:
                z_term = kz[-2] * T[-2] / (layer_thickness[-1] ** 2)
            else:
                z_term = (kz[l] * T[l - 1] + kz[l + 1] * T[l + 1]) / (layer_thickness[l] ** 2)

            T_gs = (laplace + z_term + source[l]) / a_p[l]
            T[l] = T[l] + omega * (T_gs - T[l])

        max_delta = np.max(np.abs(T - T_old))
        if max_delta < tol:
            converged = True
            break

    T = np.clip(T, T_amb - 1, 2000.0)
    return [T[l] for l in range(n_layers)], iteration, converged


def _solve_current_density(
    board: BoardData,
    current_sources: list[CurrentSource],
    sigma_matrices: list[np.ndarray],
    layers: list,
    dx: float,
    dy: float,
    layer_thickness: np.ndarray,
    rows: int,
    cols: int,
    res: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, float]:
    n_layers = len(layers)
    V = np.zeros((n_layers, rows, cols), dtype=np.float64)
    sigma_eff = np.zeros((n_layers, rows, cols), dtype=np.float64)
    for l in range(n_layers):
        sigma_eff[l] = sigma_matrices[l] * layers[l].electrical_conductivity

    sigma_e = np.zeros_like(sigma_eff)
    sigma_w = np.zeros_like(sigma_eff)
    sigma_n = np.zeros_like(sigma_eff)
    sigma_s = np.zeros_like(sigma_eff)
    for l in range(n_layers):
        sigma = sigma_eff[l]
        se_int = np.zeros_like(sigma)
        sw_int = np.zeros_like(sigma)
        sn_int = np.zeros_like(sigma)
        ss_int = np.zeros_like(sigma)
        se_int[:, :-1] = 2 * sigma[:, :-1] * sigma[:, 1:] / (sigma[:, :-1] + sigma[:, 1:] + 1e-30)
        sw_int[:, 1:] = se_int[:, :-1]
        sn_int[:-1, :] = 2 * sigma[:-1, :] * sigma[1:, :] / (sigma[:-1, :] + sigma[1:, :] + 1e-30)
        ss_int[1:, :] = sn_int[:-1, :]
        sigma_e[l] = se_int / dx**2
        sigma_w[l] = sw_int / dx**2
        sigma_n[l] = sn_int / dy**2
        sigma_s[l] = ss_int / dy**2

    diag = sigma_e + sigma_w + sigma_n + sigma_s
    diag_safe = np.where(diag > 1e-30, diag, 1e-30)

    for cs in current_sources:
        layer_idx = 0
        for i, layer in enumerate(layers):
            cs_layer = getattr(cs, "layer", "top")
            if cs_layer in layer.name or (cs_layer == "top" and "Top" in layer.name) or (cs_layer == "bottom" and "Bottom" in layer.name):
                layer_idx = i
                break
        r = int(cs.y / res)
        c = int(cs.x / res)
        if 0 <= r < rows and 0 <= c < cols:
            if cs.is_sink:
                V[layer_idx, r, c] = 0.0
                diag[layer_idx, r, c] = 1.0
            else:
                V[layer_idx, r, c] = cs.value
                diag[layer_idx, r, c] = 1.0

    omega = 1.5
    tol = 1e-6
    max_iter = 2000

    for iteration in range(max_iter):
        V_old = V.copy()
        for l in range(n_layers):
            ve = np.zeros((rows, cols))
            vw = np.zeros((rows, cols))
            vn = np.zeros((rows, cols))
            vs = np.zeros((rows, cols))
            ve[:, :-1] = V[l, :, 1:]
            vw[:, 1:] = V[l, :, :-1]
            vn[:-1, :] = V[l, 1:, :]
            vs[1:, :] = V[l, :-1, :]
            V_gs = (sigma_e[l] * ve + sigma_w[l] * vw + sigma_n[l] * vn + sigma_s[l] * vs) / diag_safe[l]
            V[l] = V[l] + omega * (V_gs - V[l])

        max_delta = np.max(np.abs(V - V_old))
        if max_delta < tol:
            break

    Jx = np.zeros_like(V)
    Jy = np.zeros_like(V)
    for l in range(n_layers):
        Jx[l, :, :-1] = sigma_eff[l, :, :-1] * (V[l, :, 1:] - V[l, :, :-1]) / dx
        Jy[l, :-1, :] = sigma_eff[l, :-1, :] * (V[l, 1:, :] - V[l, :-1, :]) / dy

    J_mag = np.sqrt(Jx**2 + Jy**2)
    Q_joule = (Jx**2 + Jy**2) / (sigma_eff + 1e-30)
    total_joule_heat = 0.0
    for l in range(n_layers):
        vol = dx * dy * layer_thickness[l]
        total_joule_heat += np.sum(Q_joule[l]) * vol

    return V[0], J_mag[0], Q_joule, float(total_joule_heat)


def _compute_heat_flow_field(
    k_matrices: list[np.ndarray],
    T_matrices: list[np.ndarray],
    dx: float,
    dy: float,
    layer_thickness: np.ndarray,
) -> HeatFlowField:
    n_layers = len(k_matrices)
    rows, cols = k_matrices[0].shape

    qx = np.zeros((n_layers, rows, cols), dtype=np.float64)
    qy = np.zeros((n_layers, rows, cols), dtype=np.float64)
    qz = np.zeros((n_layers, rows, cols), dtype=np.float64)

    for l in range(n_layers):
        k = k_matrices[l]
        T = T_matrices[l]
        qx[l, :, :-1] = k[:, :-1] * (T[:, 1:] - T[:, :-1]) / dx
        qy[l, :-1, :] = k[:-1, :] * (T[1:, :] - T[:-1, :]) / dy

        if l < n_layers - 1:
            k1 = k_matrices[l]
            k2 = k_matrices[l + 1]
            dz1 = layer_thickness[l]
            dz2 = layer_thickness[l + 1]
            k_interface = 2 * k1 * k2 / (k1 * dz2 + k2 * dz1 + 1e-30)
            qz[l] = k_interface * (T_matrices[l + 1] - T) / ((dz1 + dz2) / 2.0)

    return HeatFlowField(
        qx=[qx[l].tolist() for l in range(n_layers)],
        qy=[qy[l].tolist() for l in range(n_layers)],
        qz=[qz[l].tolist() for l in range(n_layers)],
    )


def export_vtk(
    board_id: str,
    T_matrices: list[np.ndarray],
    layer_names: list[str],
    dx: float,
    dy: float,
    layer_thickness: np.ndarray,
    potential_matrix: Optional[np.ndarray] = None,
    current_density: Optional[np.ndarray] = None,
) -> str:
    n_layers = len(T_matrices)
    rows, cols = T_matrices[0].shape
    layer_z = np.cumsum(np.concatenate([[0], layer_thickness]))

    lines = [
        "# vtk DataFile Version 3.0",
        f"PCB Thermal Simulation - {board_id}",
        "ASCII",
        "DATASET STRUCTURED_POINTS",
        f"DIMENSIONS {cols} {rows} {n_layers}",
        f"ORIGIN 0 0 0",
        f"SPACING {dx * 1e3} {dy * 1e3} {1.0}",
        f"POINT_DATA {cols * rows * n_layers}",
    ]

    lines.append("SCALARS Temperature float 1")
    lines.append("LOOKUP_TABLE default")
    for l in range(n_layers):
        for r in range(rows):
            for c in range(cols):
                lines.append(f"{T_matrices[l][r, c]:.6f}")

    if potential_matrix is not None:
        lines.append("SCALARS Potential float 1")
        lines.append("LOOKUP_TABLE default")
        for r in range(rows):
            for c in range(cols):
                lines.append(f"{potential_matrix[r, c]:.6f}")

    if current_density is not None:
        lines.append("SCALARS CurrentDensity float 1")
        lines.append("LOOKUP_TABLE default")
        for r in range(rows):
            for c in range(cols):
                lines.append(f"{current_density[r, c]:.6e}")

    return "\n".join(lines)
