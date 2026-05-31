from __future__ import annotations

import io
import uuid
from collections import OrderedDict

import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from demo_board import build_demo_conductivity_matrix, generate_demo_board
from gerber_parser import parse_gerber_files, parse_zip_upload
from models import (
    BoardData,
    ErrorResponse,
    ExportRequest,
    SimulationRequest,
    SimulationResult,
)
from thermal_solver import export_vtk, run_simulation

app = FastAPI(
    title="PCB Thermal Simulation API",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://localhost:5175"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class _LRUCache:
    def __init__(self, maxsize: int = 20):
        self._maxsize = maxsize
        self._cache: OrderedDict[str, BoardData] = OrderedDict()

    def get(self, key: str) -> BoardData | None:
        if key in self._cache:
            self._cache.move_to_end(key)
            return self._cache[key]
        return None

    def put(self, key: str, value: BoardData) -> None:
        if key in self._cache:
            self._cache.move_to_end(key)
        self._cache[key] = value
        while len(self._cache) > self._maxsize:
            self._cache.popitem(last=False)

    def __contains__(self, key: str) -> bool:
        return key in self._cache


_board_cache = _LRUCache(maxsize=20)
_k_cache: dict[tuple[str, float], list] = {}
_result_cache: dict[str, SimulationResult] = {}


def _get_demo_board() -> BoardData:
    return generate_demo_board()


@app.post(
    "/api/parse-gerber",
    response_model=BoardData,
    responses={400: {"model": ErrorResponse}},
)
async def parse_gerber(files: list[UploadFile] = File(...)):
    if not files:
        raise HTTPException(status_code=400, detail="未提供任何文件")

    board_id = str(uuid.uuid4())[:8]
    file_dict: dict[str, io.BytesIO] = {}

    for f in files:
        content = await f.read()
        filename = f.filename or "unknown.gerber"
        if filename.lower().endswith(".zip"):
            try:
                board = parse_zip_upload(content, board_id)
                _board_cache.put(board.board_id, board)
                return board
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e))
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"解析 ZIP 文件失败: {e}")
        file_dict[filename] = io.BytesIO(content)

    try:
        board = parse_gerber_files(file_dict, board_id)
        _board_cache.put(board.board_id, board)
        return board
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"解析 Gerber 文件失败: {e}")


@app.post(
    "/api/simulate",
    response_model=SimulationResult,
    responses={404: {"model": ErrorResponse}, 400: {"model": ErrorResponse}},
)
async def simulate(request: SimulationRequest):
    board = _board_cache.get(request.board_id)
    if board is None and request.board_id == "demo-board-001":
        board = _get_demo_board()
        _board_cache.put(board.board_id, board)
    if board is None:
        raise HTTPException(
            status_code=404,
            detail=f"未找到电路板: {request.board_id}，请先上传 Gerber 文件或使用 demo-board",
        )

    if not request.heat_sources:
        raise HTTPException(status_code=400, detail="热源列表不能为空")

    k_matrices = _k_cache.get((request.board_id, request.params.grid_resolution))

    try:
        result = run_simulation(
            board=board,
            heat_sources=request.heat_sources,
            current_sources=request.current_sources,
            params=request.params,
            k_matrices=k_matrices,
        )
        _result_cache[request.board_id] = result
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"仿真计算失败: {e}")


@app.post("/api/export-vtk")
async def export_vtk_data(request: ExportRequest):
    result = _result_cache.get(request.board_id)
    if result is None:
        raise HTTPException(status_code=404, detail="未找到仿真结果，请先运行仿真")

    try:
        T_matrices = [np.array(layer_data) for layer_data in result.temperature_matrices]
        layer_thickness = np.array([0.2] * result.n_layers)
        layer_thickness[0] = 0.035
        layer_thickness[-1] = 0.035
        if result.n_layers >= 3:
            layer_thickness[result.n_layers // 2] = 1.13

        vtk_content = export_vtk(
            board_id=request.board_id,
            T_matrices=T_matrices,
            layer_names=result.layer_names,
            dx=1.0,
            dy=1.0,
            layer_thickness=layer_thickness,
            potential_matrix=np.array(result.potential_matrix) if result.potential_matrix else None,
            current_density=np.array(result.current_density) if result.current_density else None,
        )
        return Response(
            content=vtk_content,
            media_type="text/plain",
            headers={"Content-Disposition": f"attachment; filename=pcb_thermal_{request.board_id}.vtk"},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"VTK 导出失败: {e}")


@app.get("/api/demo-board", response_model=BoardData)
async def get_demo_board():
    board = _get_demo_board()
    _board_cache.put(board.board_id, board)
    k_matrix = build_demo_conductivity_matrix(board)
    _k_cache[(board.board_id, board.grid_resolution)] = k_matrix
    return board


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "PCB Thermal Simulation"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
