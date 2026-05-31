import numpy as np
import struct
from pathlib import Path


def generate_test_ply(filepath: str, num_points: int = 10000):
    points = np.random.randn(num_points, 3).astype(np.float32) * 10
    
    colors = np.zeros((num_points, 3), dtype=np.uint8)
    colors[:, 0] = (np.abs(points[:, 0]) * 10).astype(np.uint8)
    colors[:, 1] = (np.abs(points[:, 1]) * 10).astype(np.uint8)
    colors[:, 2] = (np.abs(points[:, 2]) * 10).astype(np.uint8)
    
    for i in range(num_points):
        if i < num_points // 3:
            points[i] += np.array([20, 0, 0])
            colors[i] = [255, 0, 0]
        elif i < 2 * num_points // 3:
            points[i] += np.array([-20, 0, 0])
            colors[i] = [0, 255, 0]
        else:
            points[i] += np.array([0, 20, 0])
            colors[i] = [0, 0, 255]
    
    header = f"""ply
format binary_little_endian 1.0
element vertex {num_points}
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
end_header
"""
    
    with open(filepath, 'wb') as f:
        f.write(header.encode('ascii'))
        for i in range(num_points):
            f.write(struct.pack('<fff', points[i, 0], points[i, 1], points[i, 2]))
            f.write(struct.pack('<BBB', colors[i, 0], colors[i, 1], colors[i, 2]))
    
    print(f"Generated test PLY file: {filepath}")
    print(f"Number of points: {num_points}")
    return filepath


if __name__ == "__main__":
    output_dir = Path("e:/soloL/l18/backend/test_data")
    output_dir.mkdir(exist_ok=True)
    
    generate_test_ply(str(output_dir / "test_cloud_10k.ply"), 10000)
    generate_test_ply(str(output_dir / "test_cloud_100k.ply"), 100000)
