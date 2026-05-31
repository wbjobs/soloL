from __future__ import annotations

import numpy as np

from models import BoardData, BoardDimensions, Component, LayerDefinition, Pad, TraceSegment

BOARD_WIDTH = 100.0
BOARD_HEIGHT = 80.0
GRID_RESOLUTION = 0.5
K_FR4 = 0.3
K_COPPER = 385.0
SIGMA_COPPER = 5.96e7


def generate_demo_board() -> BoardData:
    traces = _build_traces()
    pads = _build_pads()
    components = _build_components()
    layers = _build_layers()
    return BoardData(
        board_id="demo-board-001",
        dimensions=BoardDimensions(width=BOARD_WIDTH, height=BOARD_HEIGHT),
        traces=traces,
        pads=pads,
        components=components,
        layers=layers,
        grid_resolution=GRID_RESOLUTION,
    )


def _build_layers() -> list[LayerDefinition]:
    return [
        LayerDefinition(
            name="Top Layer",
            thickness=0.035,
            conductivity=K_COPPER,
            electrical_conductivity=SIGMA_COPPER,
            is_copper=True,
        ),
        LayerDefinition(
            name="Prepreg 1",
            thickness=0.2,
            conductivity=K_FR4,
            electrical_conductivity=0.0,
            is_copper=False,
        ),
        LayerDefinition(
            name="Core",
            thickness=1.13,
            conductivity=K_FR4,
            electrical_conductivity=0.0,
            is_copper=False,
        ),
        LayerDefinition(
            name="Prepreg 2",
            thickness=0.2,
            conductivity=K_FR4,
            electrical_conductivity=0.0,
            is_copper=False,
        ),
        LayerDefinition(
            name="Bottom Layer",
            thickness=0.035,
            conductivity=K_COPPER,
            electrical_conductivity=SIGMA_COPPER,
            is_copper=True,
        ),
    ]


def build_demo_conductivity_matrix(board: BoardData) -> np.ndarray:
    rows = int(board.dimensions.height / board.grid_resolution)
    cols = int(board.dimensions.width / board.grid_resolution)
    k_matrix = np.full((rows, cols), K_FR4, dtype=np.float64)
    _rasterize_traces(k_matrix, board.traces, board.grid_resolution)
    _rasterize_pads(k_matrix, board.pads, board.grid_resolution)
    _rasterize_components(k_matrix, board.components, board.grid_resolution)
    _add_thermal_pads(k_matrix, board.grid_resolution)
    return k_matrix


def _add_thermal_pads(k_matrix: np.ndarray, res: float) -> None:
    rows, cols = k_matrix.shape
    thermal_pads = [
        (25, 25, 16, 16),
        (75, 60, 12, 12),
        (55, 40, 10, 8),
    ]
    for x, y, w, h in thermal_pads:
        r_lo = max(int((y - h / 2) / res), 0)
        r_hi = min(int((y + h / 2) / res) + 1, rows)
        c_lo = max(int((x - w / 2) / res), 0)
        c_hi = min(int((x + w / 2) / res) + 1, cols)
        k_matrix[r_lo:r_hi, c_lo:c_hi] = np.maximum(
            k_matrix[r_lo:r_hi, c_lo:c_hi], K_COPPER * 0.5
        )


def _build_traces() -> list[TraceSegment]:
    return [
        TraceSegment(start_x=10, start_y=20, end_x=40, end_y=20, width=0.5),
        TraceSegment(start_x=40, start_y=20, end_x=40, end_y=50, width=0.5),
        TraceSegment(start_x=40, start_y=50, end_x=70, end_y=50, width=0.5),
        TraceSegment(start_x=70, start_y=50, end_x=70, end_y=20, width=0.5),
        TraceSegment(start_x=70, start_y=20, end_x=90, end_y=20, width=0.5),
        TraceSegment(start_x=15, start_y=60, end_x=50, end_y=60, width=0.3),
        TraceSegment(start_x=50, start_y=60, end_x=50, end_y=70, width=0.3),
        TraceSegment(start_x=50, start_y=70, end_x=85, end_y=70, width=0.3),
        TraceSegment(start_x=20, start_y=35, end_x=35, end_y=35, width=0.25),
        TraceSegment(start_x=60, start_y=35, end_x=80, end_y=35, width=0.25),
        TraceSegment(start_x=5, start_y=45, end_x=30, end_y=45, width=1.0),
        TraceSegment(start_x=55, start_y=10, end_x=85, end_y=10, width=1.0),
        TraceSegment(start_x=30, start_y=10, end_x=30, end_y=30, width=0.5),
        TraceSegment(start_x=80, start_y=30, end_x=80, end_y=55, width=0.5),
    ]


def _build_pads() -> list[Pad]:
    return [
        Pad(x=10, y=20, width=2.0, height=2.0, shape="rect"),
        Pad(x=40, y=20, width=1.5, height=1.5, shape="circle"),
        Pad(x=40, y=50, width=1.5, height=1.5, shape="circle"),
        Pad(x=70, y=50, width=1.5, height=1.5, shape="circle"),
        Pad(x=70, y=20, width=1.5, height=1.5, shape="circle"),
        Pad(x=90, y=20, width=2.0, height=2.0, shape="rect"),
        Pad(x=15, y=60, width=1.5, height=1.5, shape="rect"),
        Pad(x=85, y=70, width=1.5, height=1.5, shape="rect"),
        Pad(x=20, y=35, width=1.0, height=1.0, shape="circle"),
        Pad(x=35, y=35, width=1.0, height=1.0, shape="circle"),
        Pad(x=60, y=35, width=1.0, height=1.0, shape="circle"),
        Pad(x=80, y=35, width=1.0, height=1.0, shape="circle"),
        Pad(x=5, y=45, width=2.5, height=2.5, shape="rect"),
        Pad(x=30, y=45, width=2.5, height=2.5, shape="rect"),
        Pad(x=55, y=10, width=2.0, height=2.0, shape="rect"),
        Pad(x=85, y=10, width=2.0, height=2.0, shape="rect"),
    ]


def _build_components() -> list[Component]:
    return [
        Component(
            name="U1",
            x=25,
            y=25,
            width=12,
            height=12,
            power=2.5,
            layer="top",
        ),
        Component(
            name="U2",
            x=75,
            y=60,
            width=8,
            height=8,
            power=1.2,
            layer="top",
        ),
        Component(
            name="VR1",
            x=55,
            y=40,
            width=6,
            height=4,
            power=0.8,
            layer="top",
        ),
        Component(
            name="R1",
            x=15,
            y=60,
            width=2,
            height=1,
            power=0.1,
            layer="top",
        ),
        Component(
            name="R2",
            x=85,
            y=70,
            width=2,
            height=1,
            power=0.05,
            layer="top",
        ),
        Component(
            name="R3",
            x=30,
            y=10,
            width=2,
            height=1,
            power=0.05,
            layer="bottom",
        ),
        Component(
            name="R4",
            x=80,
            y=30,
            width=2,
            height=1,
            power=0.08,
            layer="top",
        ),
        Component(
            name="C1",
            x=45,
            y=15,
            width=3,
            height=1.5,
            power=0.0,
            layer="top",
        ),
        Component(
            name="C2",
            x=60,
            y=65,
            width=3,
            height=1.5,
            power=0.0,
            layer="top",
        ),
        Component(
            name="C3",
            x=35,
            y=70,
            width=3,
            height=1.5,
            power=0.0,
            layer="bottom",
        ),
        Component(
            name="C4",
            x=10,
            y=45,
            width=3,
            height=1.5,
            power=0.0,
            layer="top",
        ),
        Component(
            name="L1",
            x=55,
            y=25,
            width=4,
            height=4,
            power=0.15,
            layer="top",
        ),
    ]


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
