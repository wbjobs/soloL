from pathlib import Path
from typing import Any
import struct

import numpy as np
from plyfile import PlyData, PlyElement


def load_ply(file_path: str | Path) -> dict[str, Any]:
    file_path = Path(file_path)
    plydata = PlyData.read(file_path)

    vertex_data = plydata["vertex"]
    num_points = len(vertex_data)

    points = np.zeros((num_points, 3), dtype=np.float32)
    points[:, 0] = vertex_data["x"]
    points[:, 1] = vertex_data["y"]
    points[:, 2] = vertex_data["z"]

    np_data = vertex_data.data
    property_names = np_data.dtype.names if np_data is not None else []

    colors = None
    if all(c in property_names for c in ["red", "green", "blue"]):
        colors = np.zeros((num_points, 3), dtype=np.uint8)
        colors[:, 0] = vertex_data["red"]
        colors[:, 1] = vertex_data["green"]
        colors[:, 2] = vertex_data["blue"]

    normals = None
    if all(n in property_names for n in ["nx", "ny", "nz"]):
        normals = np.zeros((num_points, 3), dtype=np.float32)
        normals[:, 0] = vertex_data["nx"]
        normals[:, 1] = vertex_data["ny"]
        normals[:, 2] = vertex_data["nz"]

    labels = None
    if "label" in property_names:
        labels = np.array(vertex_data["label"], dtype=np.uint32)

    bounds = {
        "min": [float(np.min(points[:, 0])), float(np.min(points[:, 1])), float(np.min(points[:, 2]))],
        "max": [float(np.max(points[:, 0])), float(np.max(points[:, 1])), float(np.max(points[:, 2]))],
    }

    return {
        "points": points,
        "colors": colors,
        "normals": normals,
        "labels": labels,
        "num_points": num_points,
        "bounds": bounds,
    }


def save_ply(
    file_path: str | Path,
    points: np.ndarray,
    colors: np.ndarray | None = None,
    normals: np.ndarray | None = None,
    labels: np.ndarray | None = None,
) -> None:
    file_path = Path(file_path)

    vertex_data = []
    vertex_dtype = [("x", "f4"), ("y", "f4"), ("z", "f4")]

    if colors is not None:
        vertex_dtype += [("red", "u1"), ("green", "u1"), ("blue", "u1")]

    if normals is not None:
        vertex_dtype += [("nx", "f4"), ("ny", "f4"), ("nz", "f4")]

    if labels is not None:
        vertex_dtype += [("label", "u4")]

    for i in range(len(points)):
        vertex = (points[i, 0], points[i, 1], points[i, 2])
        if colors is not None:
            vertex += (colors[i, 0], colors[i, 1], colors[i, 2])
        if normals is not None:
            vertex += (normals[i, 0], normals[i, 1], normals[i, 2])
        if labels is not None:
            vertex += (labels[i],)
        vertex_data.append(vertex)

    vertex_array = np.array(vertex_data, dtype=vertex_dtype)
    vertex_element = PlyElement.describe(vertex_array, "vertex")

    PlyData([vertex_element], text=True).write(file_path)


def generate_lod_levels(
    points: np.ndarray,
    colors: np.ndarray | None = None,
    num_levels: int = 3,
) -> list[dict[str, Any]]:
    lod_levels = []
    current_points = points
    current_colors = colors

    for level in range(num_levels):
        if level == 0:
            stride = 1
        else:
            stride = 2 ** level

        sampled_indices = np.arange(0, len(current_points), stride)
        lod_points = current_points[sampled_indices]
        lod_colors = current_colors[sampled_indices] if current_colors is not None else None

        lod_levels.append({
            "level": level,
            "points": lod_points,
            "colors": lod_colors,
            "num_points": len(lod_points),
        })

    return lod_levels


def octree_partition(
    points: np.ndarray,
    colors: np.ndarray | None = None,
    max_points_per_chunk: int = 100000,
) -> list[dict[str, Any]]:
    chunks = []

    def _partition(
        pts: np.ndarray,
        cols: np.ndarray | None,
        indices: np.ndarray,
        bounds: np.ndarray,
        depth: int = 0,
    ) -> None:
        if len(pts) <= max_points_per_chunk or depth > 10:
            chunks.append({
                "points": pts,
                "colors": cols,
                "indices": indices,
                "bounds": bounds.tolist(),
                "num_points": len(pts),
            })
            return

        center = np.mean(bounds, axis=0)

        for i in range(8):
            mask = np.ones(len(pts), dtype=bool)
            for dim in range(3):
                if (i >> dim) & 1:
                    mask &= pts[:, dim] >= center[dim]
                else:
                    mask &= pts[:, dim] < center[dim]

            if np.any(mask):
                child_bounds = bounds.copy()
                for dim in range(3):
                    if (i >> dim) & 1:
                        child_bounds[0, dim] = center[dim]
                    else:
                        child_bounds[1, dim] = center[dim]

                _partition(
                    pts[mask],
                    cols[mask] if cols is not None else None,
                    indices[mask],
                    child_bounds,
                    depth + 1,
                )

    initial_bounds = np.array([
        [np.min(points[:, 0]), np.min(points[:, 1]), np.min(points[:, 2])],
        [np.max(points[:, 0]), np.max(points[:, 1]), np.max(points[:, 2])],
    ])

    _partition(points, colors, np.arange(len(points)), initial_bounds)
    return chunks


def normalize_points(points: np.ndarray) -> tuple[np.ndarray, np.ndarray, float]:
    centroid = np.mean(points, axis=0)
    centered = points - centroid
    max_distance = np.max(np.sqrt(np.sum(centered ** 2, axis=1)))
    normalized = centered / max_distance
    return normalized, centroid, max_distance


def export_to_semantic_kitti(
    points: np.ndarray,
    labels: np.ndarray,
    output_dir: str | Path,
    sequence_id: str = "00",
    scan_id: int = 0,
) -> None:
    output_dir = Path(output_dir)
    sequences_dir = output_dir / "sequences" / sequence_id
    velodyne_dir = sequences_dir / "velodyne"
    labels_dir = sequences_dir / "labels"

    velodyne_dir.mkdir(parents=True, exist_ok=True)
    labels_dir.mkdir(parents=True, exist_ok=True)

    scan_filename = f"{scan_id:06d}.bin"
    velodyne_path = velodyne_dir / scan_filename
    labels_path = labels_dir / scan_filename

    point_cloud = np.zeros((len(points), 4), dtype=np.float32)
    point_cloud[:, :3] = points.astype(np.float32)
    point_cloud[:, 3] = 0.0

    with open(velodyne_path, "wb") as f:
        point_cloud.tofile(f)

    kitti_labels = labels.astype(np.uint32)
    label_data = np.zeros(len(labels), dtype=np.uint32)
    for i, label in enumerate(kitti_labels):
        label_data[i] = label | (label << 16)

    with open(labels_path, "wb") as f:
        label_data.tofile(f)
