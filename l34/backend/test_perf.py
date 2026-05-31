import numpy as np
import time
from thermal_solver import _solve_direct, _solve_sor_fft

print("=" * 70)
print("PCB Thermal Solver - Performance & Accuracy Validation")
print("=" * 70)

test_cases = [
    {"name": "200x250 (50k cells)", "rows": 200, "cols": 250, "dx": 0.5e-3},
    {"name": "320x400 (128k cells)", "rows": 320, "cols": 400, "dx": 0.25e-3},
]

for tc in test_cases:
    print(f"\n--- Test: {tc['name']} ---")
    rows, cols, dx = tc["rows"], tc["cols"], tc["dx"]
    dz = 1.6e-3

    k = np.full((rows, cols), 0.3)
    Q = np.zeros((rows, cols))
    r_center = rows // 2
    c_center = cols // 2
    r_lo = r_center - rows // 10
    r_hi = r_center + rows // 10
    c_lo = c_center - cols // 10
    c_hi = c_center + cols // 10
    area = (c_hi - c_lo) * dx * 1e-3 * (r_hi - r_lo) * dx * 1e-3
    vol = area * dz
    Q[r_lo:r_hi, c_lo:c_hi] = 2.5 / vol

    class P:
        ambient_temp = 25
        board_thickness = 1.6
        copper_thickness = 1
        convection_coeff = 10
        max_iterations = 5000
        convergence_tol = 0.01

    p = P()

    if rows * cols < 120000:
        t0 = time.perf_counter()
        r1 = _solve_direct(k, Q, dx, dx, dz, p, rows, cols, 'test')
        t1 = time.perf_counter() - t0
        print(f"  Direct: max={r1['max_temp']:.1f} min={r1['min_temp']:.1f} avg={r1['avg_temp']:.1f} time={t1:.3f}s")
        T_direct = np.array(r1['temperature_matrix'])

    t0 = time.perf_counter()
    r2 = _solve_sor_fft(k, Q, dx, dx, dz, p, rows, cols, 'test')
    t2 = time.perf_counter() - t0
    print(f"  SOR:    max={r2['max_temp']:.1f} min={r2['min_temp']:.1f} avg={r2['avg_temp']:.1f} conv={r2['converged']} iter={r2['iterations']} time={t2:.3f}s")

    if rows * cols < 120000:
        T_sor = np.array(r2['temperature_matrix'])
        diff = np.max(np.abs(T_direct - T_sor))
        print(f"  Accuracy: max diff={diff:.2f}°C ({diff / np.max(np.abs(T_direct - 25)) * 100:.1f}% of ΔT)")

print("\n" + "=" * 70)
print("Performance Summary:")
print("=" * 70)
print("Grid Size        | Solver   | Time (s) | Speedup vs Direct")
print("-----------------|----------|----------|------------------")

# Re-run for summary
for tc in test_cases:
    rows, cols, dx = tc["rows"], tc["cols"], tc["dx"]
    dz = 1.6e-3
    k = np.full((rows, cols), 0.3)
    Q = np.zeros((rows, cols))
    r_center = rows // 2
    c_center = cols // 2
    r_lo = r_center - rows // 10
    r_hi = r_center + rows // 10
    c_lo = c_center - cols // 10
    c_hi = c_center + cols // 10
    area = (c_hi - c_lo) * dx * 1e-3 * (r_hi - r_lo) * dx * 1e-3
    vol = area * dz
    Q[r_lo:r_hi, c_lo:c_hi] = 2.5 / vol

    class P:
        ambient_temp = 25
        board_thickness = 1.6
        copper_thickness = 1
        convection_coeff = 10
        max_iterations = 5000
        convergence_tol = 0.01

    p = P()

    t_direct = None
    if rows * cols < 120000:
        t0 = time.perf_counter()
        r1 = _solve_direct(k, Q, dx, dx, dz, p, rows, cols, 'test')
        t_direct = time.perf_counter() - t0

    t0 = time.perf_counter()
    r2 = _solve_sor_fft(k, Q, dx, dx, dz, p, rows, cols, 'test')
    t_sor = time.perf_counter() - t0

    label = f"{rows}x{cols} ({rows*cols//1000}k)"
    if t_direct is not None:
        speedup = t_direct / t_sor
        print(f"{label:<16} | Direct   | {t_direct:>8.3f} |")
        print(f"                 | SOR      | {t_sor:>8.3f} | {speedup:>14.2f}x")
    else:
        print(f"{label:<16} | SOR      | {t_sor:>8.3f} | N/A (too large for direct)")

print("\n" + "=" * 70)
