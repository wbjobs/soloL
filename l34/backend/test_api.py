import requests
import time

r0 = requests.get('http://localhost:8000/api/demo-board')
board = r0.json()
board_id = board['board_id']
print(f"Board: {board_id} {board['dimensions']['width']}x{board['dimensions']['height']}")

t0 = time.perf_counter()
r = requests.post(
    'http://localhost:8000/api/simulate',
    json={
        'board_id': board_id,
        'heat_sources': [
            {'id': 'h1', 'type': 'ic', 'x': 50, 'y': 40, 'width': 10, 'height': 10, 'power': 2.5},
        ],
        'params': {
            'ambient_temp': 25,
            'board_thickness': 1.6,
            'copper_thickness': 1,
            'convection_coeff': 10,
            'max_iterations': 5000,
            'convergence_tol': 0.01,
            'grid_resolution': 0.5,
        },
    },
)
t1 = time.perf_counter() - t0
d = r.json()
if 'detail' in d:
    print(f"Error: {d['detail']}")
else:
    print(f"Direct 0.5mm: max={d['max_temp']:.1f} min={d['min_temp']:.1f} avg={d['avg_temp']:.1f} "
          f"iter={d['iterations']} conv={d['converged']} grid={d['grid_rows']}x{d['grid_cols']} time={t1:.2f}s")

t0 = time.perf_counter()
r = requests.post(
    'http://localhost:8000/api/simulate',
    json={
        'board_id': board_id,
        'heat_sources': [
            {'id': 'h1', 'type': 'ic', 'x': 50, 'y': 40, 'width': 10, 'height': 10, 'power': 2.5},
        ],
        'params': {
            'ambient_temp': 25,
            'board_thickness': 1.6,
            'copper_thickness': 1,
            'convection_coeff': 10,
            'max_iterations': 5000,
            'convergence_tol': 0.01,
            'grid_resolution': 0.25,
        },
    },
)
t1 = time.perf_counter() - t0
d = r.json()
if 'detail' in d:
    print(f"Error: {d['detail']}")
else:
    print(f"SOR 0.25mm:   max={d['max_temp']:.1f} min={d['min_temp']:.1f} avg={d['avg_temp']:.1f} "
          f"iter={d['iterations']} conv={d['converged']} grid={d['grid_rows']}x{d['grid_cols']} time={t1:.2f}s")
