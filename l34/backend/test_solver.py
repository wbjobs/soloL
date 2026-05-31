import numpy as np
import time
from thermal_solver import _solve_direct, _solve_sor_fft

k = np.full((320, 400), 0.3)
Q = np.zeros((320, 400))
dx = 0.25e-3
dz = 1.6e-3
Q[160:200, 100:140] = 2.5 / (40*dx * 40*dx * dz)

class P:
    ambient_temp = 25
    board_thickness = 1.6
    copper_thickness = 1
    convection_coeff = 10
    max_iterations = 5000
    convergence_tol = 0.01

p = P()

t0 = time.perf_counter()
r_sor = _solve_sor_fft(k, Q, dx, dx, dz, p, 320, 400, 'test')
t1 = time.perf_counter() - t0
print(f"SOR 320x400: max={r_sor['max_temp']:.1f} min={r_sor['min_temp']:.1f} avg={r_sor['avg_temp']:.1f} conv={r_sor['converged']} iter={r_sor['iterations']} time={t1:.3f}s")
