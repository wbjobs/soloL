from __future__ import annotations

import io
import zipfile
from typing import BinaryIO

import numpy as np

from models import BoardData, BoardDimensions, Component, Pad, TraceSegment

K_FR4 = 0.3
K_COPPER = 385.0
GRID_RESOLUTION = 0.5

COPPER_EXTENSIONS = {".gtl", ".gbl", ".gts", ".gbs"}
SILK_EXTENSIONS = {".gto", ".gbo"}
OUTLINE_EXTENSIONS = {".gko", ".gm1", ".gml"}


def parse_gerber_files(
    files: dict[str, BinaryIO], board_id: str
) -> BoardData:
    traces: list[TraceSegment] = []
    pads: list[Pad] = []
    components: list[Component] = []
    board_width = 100.0
    board_height = 80.0

    for filename, file_obj in files.items():
        ext = _get_extension(filename)
        if ext in COPPER_EXTENSIONS:
            layer_traces, layer_pads = _parse_copper_layer(file_obj, filename)
            traces.extend(layer_traces)
            pads.extend(layer_pads)
        elif ext in OUTLINE_EXTENSIONS:
            w, h = _parse_outline_layer(file_obj, filename)
            if w > 0 and h > 0:
                board_width = w
                board_height = h

    return BoardData(
        board_id=board_id,
        dimensions=BoardDimensions(width=board_width, height=board_height),
        traces=traces,
        pads=pads,
        components=components,
        grid_resolution=GRID_RESOLUTION,
    )


def parse_zip_upload(zip_bytes: bytes, board_id: str) -> BoardData:
    files: dict[str, BinaryIO] = {}
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        for name in zf.namelist():
            if name.endswith("/"):
                continue
            ext = _get_extension(name)
            if ext in COPPER_EXTENSIONS or ext in SILK_EXTENSIONS or ext in OUTLINE_EXTENSIONS:
                files[name] = io.BytesIO(zf.read(name))
    if not files:
        raise ValueError("ZIP 中未找到有效的 Gerber 文件")
    return parse_gerber_files(files, board_id)


def build_conductivity_matrix(board: BoardData) -> np.ndarray:
    rows = int(board.dimensions.height / board.grid_resolution)
    cols = int(board.dimensions.width / board.grid_resolution)
    k_matrix = np.full((rows, cols), K_FR4, dtype=np.float64)
    _rasterize_traces(k_matrix, board.traces, board.grid_resolution)
    _rasterize_pads(k_matrix, board.pads, board.grid_resolution)
    _rasterize_components(k_matrix, board.components, board.grid_resolution)
    return k_matrix


def _parse_copper_layer(
    file_obj: BinaryIO, filename: str
) -> tuple[list[TraceSegment], list[Pad]]:
    traces: list[TraceSegment] = []
    pads: list[Pad] = []

    try:
        from gerber import read

        file_obj.seek(0)
        gerber_layer = read(file_obj)
        for primitive in gerber_layer.primitives:
            _extract_primitive(primitive, traces, pads)
    except ImportError:
        pass
    except Exception as e:
        print(f"解析 Gerber 层 {filename} 时出错: {e}")

    return traces, pads


def _parse_outline_layer(
    file_obj: BinaryIO, filename: str
) -> tuple[float, float]:
    try:
        from gerber import read

        file_obj.seek(0)
        gerber_layer = read(file_obj)
        bounds = gerber_layer.bounding_box
        if bounds:
            width = (bounds[0][1] - bounds[0][0]) * 1e-3
            height = (bounds[1][1] - bounds[1][0]) * 1e-3
            return abs(width), abs(height)
    except ImportError:
        pass
    except Exception as e:
        print(f"解析轮廓层 {filename} 时出错: {e}")
    return 0.0, 0.0


def _extract_primitive(primitive, traces: list, pads: list) -> None:
    try:
        ptype = type(primitive).__name__.lower()

        if "line" in ptype or "draw" in ptype:
            start = _to_mm_tuple(getattr(primitive, "start", (0, 0)))
            end = _to_mm_tuple(getattr(primitive, "end", (0, 0)))
            width = _to_mm_float(getattr(primitive, "width", 0.2)) or 0.2
            traces.append(
                TraceSegment(
                    start_x=start[0],
                    start_y=start[1],
                    end_x=end[0],
                    end_y=end[1],
                    width=width,
                )
            )
        elif "pad" in ptype or "flash" in ptype:
            pos = _to_mm_tuple(getattr(primitive, "position", (0, 0)))
            size = _to_mm_tuple(getattr(primitive, "size", (1.0, 1.0)))
            pads.append(
                Pad(
                    x=pos[0],
                    y=pos[1],
                    width=size[0],
                    height=size[1],
                    shape="rect",
                )
            )
        elif "region" in ptype or "polygon" in ptype:
            position = _to_mm_tuple(getattr(primitive, "position", (0, 0)))
            size = _to_mm_tuple(getattr(primitive, "size", (2.0, 2.0)))
            pads.append(
                Pad(
                    x=position[0],
                    y=position[1],
                    width=size[0],
                    height=size[1],
                    shape="rect",
                )
            )
        elif "arc" in ptype or "circle" in ptype:
            center = _to_mm_tuple(getattr(primitive, "center", (0, 0)))
            radius = _to_mm_float(getattr(primitive, "radius", 0.5))
            pads.append(
                Pad(
                    x=center[0],
                    y=center[1],
                    width=radius * 2,
                    height=radius * 2,
                    shape="circle",
                )
            )
    except Exception as e:
        print(f"提取图元时出错: {e}")


def _to_mm_tuple(value) -> tuple[float, float]:
    if hasattr(value, "__iter__") and len(value) >= 2:
        return (float(value[0]) * 1e-3, float(value[1]) * 1e-3)
    return (0.0, 0.0)


def _to_mm_float(value) -> float:
    return float(value) * 1e-3


def _rasterize_traces(
    k_matrix: np.ndarray, traces: list[TraceSegment], res: float
) -> None:
    rows, cols = k_matrix.shape
    for t in traces:
        half_w = t.width / 2.0
        n_samples = max(
            int(
                max(abs(t.end_x - t.start_x), abs(t.end_y - t.start_y)) / (res * 0.5)
            ),
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
            k_matrix[r_lo:r_hi, c_lo:c_hi] = K_COPPER


def _rasterize_pads(k_matrix: np.ndarray, pads: list[Pad], res: float) -> None:
    rows, cols = k_matrix.shape
    for p in pads:
        r_lo = max(int((p.y - p.height / 2) / res), 0)
        r_hi = min(int((p.y + p.height / 2) / res) + 1, rows)
        c_lo = max(int((p.x - p.width / 2) / res), 0)
        c_hi = min(int((p.x + p.width / 2) / res) + 1, cols)
        k_matrix[r_lo:r_hi, c_lo:c_hi] = K_COPPER


def _rasterize_components(
    k_matrix: np.ndarray, components: list[Component], res: float
) -> None:
    rows, cols = k_matrix.shape
    for c in components:
        r_lo = max(int((c.y - c.height / 2) / res), 0)
        r_hi = min(int((c.y + c.height / 2) / res) + 1, rows)
        c_lo = max(int((c.x - c.width / 2) / res), 0)
        c_hi = min(int((c.x + c.width / 2) / res) + 1, cols)
        k_matrix[r_lo:r_hi, c_lo:c_hi] = np.maximum(
            k_matrix[r_lo:r_hi, c_lo:c_hi], 50.0
        )


def _get_extension(filename: str) -> str:
    dot = filename.rfind(".")
    if dot >= 0:
        return filename[dot:].lower()
    return ""
