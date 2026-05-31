from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class TraceSegment(BaseModel):
    start_x: float = Field(..., description="起点 X 坐标 (mm)")
    start_y: float = Field(..., description="起点 Y 坐标 (mm)")
    end_x: float = Field(..., description="终点 X 坐标 (mm)")
    end_y: float = Field(..., description="终点 Y 坐标 (mm)")
    width: float = Field(..., description="线宽 (mm)")
    layer: str = Field(default="top", description="所在层")


class Pad(BaseModel):
    x: float = Field(..., description="焊盘中心 X 坐标 (mm)")
    y: float = Field(..., description="焊盘中心 Y 坐标 (mm)")
    width: float = Field(..., description="焊盘宽度 (mm)")
    height: float = Field(..., description="焊盘高度 (mm)")
    shape: str = Field(default="rect", description="焊盘形状: rect / circle / oval")
    layer: str = Field(default="top", description="所在层")


class Component(BaseModel):
    name: str = Field(..., description="元件参考标识")
    x: float = Field(..., description="元件中心 X 坐标 (mm)")
    y: float = Field(..., description="元件中心 Y 坐标 (mm)")
    width: float = Field(..., description="元件宽度 (mm)")
    height: float = Field(..., description="元件高度 (mm)")
    power: float = Field(default=0.0, description="功耗 (W)")
    layer: str = Field(default="top", description="所在层: top / bottom")


class LayerDefinition(BaseModel):
    name: str = Field(..., description="层名称")
    thickness: float = Field(..., description="层厚度 (mm)")
    conductivity: float = Field(..., description="热导率 (W/m·K)")
    electrical_conductivity: float = Field(default=0.0, description="电导率 (S/m)，0表示绝缘层")
    is_copper: bool = Field(default=False, description="是否为铜层")


class BoardDimensions(BaseModel):
    width: float = Field(..., description="板宽 (mm)")
    height: float = Field(..., description="板高 (mm)")


class BoardData(BaseModel):
    board_id: str = Field(..., description="电路板唯一标识")
    dimensions: BoardDimensions = Field(..., description="电路板尺寸")
    traces: List[TraceSegment] = Field(default_factory=list, description="走线列表")
    pads: List[Pad] = Field(default_factory=list, description="焊盘列表")
    components: List[Component] = Field(default_factory=list, description="元件列表")
    layers: List[LayerDefinition] = Field(default_factory=list, description="层定义列表")
    grid_resolution: float = Field(
        default=0.5, description="网格分辨率 (mm/格)"
    )


class HeatSource(BaseModel):
    x: float = Field(..., description="热源中心 X 坐标 (mm)")
    y: float = Field(..., description="热源中心 Y 坐标 (mm)")
    width: float = Field(..., description="热源宽度 (mm)")
    height: float = Field(..., description="热源高度 (mm)")
    power: float = Field(..., description="功耗 (W)")
    layer: str = Field(default="top", description="所在层")


class CurrentSource(BaseModel):
    name: str = Field(..., description="电流源名称")
    type: str = Field(default="current", description="类型: current / voltage")
    x: float = Field(..., description="位置 X 坐标 (mm)")
    y: float = Field(..., description="位置 Y 坐标 (mm)")
    value: float = Field(..., description="电流 (A) 或 电压 (V)")
    layer: str = Field(default="top", description="所在层")
    is_sink: bool = Field(default=False, description="是否为电流汇")


class SimulationParams(BaseModel):
    ambient_temp: float = Field(default=25.0, description="环境温度 (°C)")
    board_thickness: float = Field(default=1.6, description="板厚 (mm)")
    copper_thickness: float = Field(default=0.035, description="铜厚 (mm)")
    convection_coeff: float = Field(default=10.0, description="对流系数 (W/m²·K)")
    max_iterations: int = Field(default=5000, description="最大迭代次数")
    convergence_tol: float = Field(default=1e-3, description="收敛容差 (°C)")
    grid_resolution: float = Field(default=0.5, description="网格分辨率 (mm/格)")
    enable_current_simulation: bool = Field(default=False, description="是否启用电流仿真")
    joule_heating_coupling: bool = Field(default=True, description="是否启用焦耳热耦合")


class SimulationRequest(BaseModel):
    board_id: str = Field(..., description="电路板唯一标识")
    heat_sources: List[HeatSource] = Field(..., description="热源列表")
    current_sources: List[CurrentSource] = Field(default_factory=list, description="电流源列表")
    params: SimulationParams = Field(default_factory=SimulationParams)


class HeatFlowField(BaseModel):
    qx: List[List[float]] = Field(..., description="X方向热流密度 (W/m²)")
    qy: List[List[float]] = Field(..., description="Y方向热流密度 (W/m²)")
    qz: List[List[float]] = Field(..., description="Z方向热流密度 (W/m²)")


class SimulationResult(BaseModel):
    board_id: str = Field(..., description="电路板唯一标识")
    temperature_matrices: List[List[List[float]]] = Field(
        ..., description="3D温度矩阵 [层][行][列] (°C)"
    )
    layer_names: List[str] = Field(default_factory=list, description="层名称列表")
    max_temp: float = Field(..., description="最高温度 (°C)")
    min_temp: float = Field(..., description="最低温度 (°C)")
    avg_temp: float = Field(..., description="平均温度 (°C)")
    iterations: int = Field(..., description="实际迭代次数")
    converged: bool = Field(..., description="是否收敛")
    grid_rows: int = Field(..., description="网格行数")
    grid_cols: int = Field(..., description="网格列数")
    n_layers: int = Field(..., description="层数")
    potential_matrix: Optional[List[List[float]]] = Field(
        default=None, description="电势矩阵 (V)"
    )
    current_density: Optional[List[List[float]]] = Field(
        default=None, description="电流密度大小 (A/m²)"
    )
    max_current_density: Optional[float] = Field(default=None, description="最大电流密度 (A/m²)")
    joule_heat_total: Optional[float] = Field(default=None, description="总焦耳热功率 (W)")
    heat_flow: Optional[HeatFlowField] = Field(default=None, description="热流矢量场")


class ExportRequest(BaseModel):
    board_id: str = Field(..., description="电路板唯一标识")
    format: str = Field(default="vtk", description="导出格式: vtk / csv")


class ErrorResponse(BaseModel):
    error: str
    detail: Optional[str] = None
