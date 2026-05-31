from pydantic import BaseModel, Field
from typing import Optional, List, Any, Dict


class ModifiedElement(BaseModel):
    element_id: str = Field(..., description="要素ID")
    new_value: Any = Field(..., description="修改后的值")


class CounterfactualRequest(BaseModel):
    case_id: str = Field(..., description="案件ID")
    modified_elements: List[ModifiedElement] = Field(..., description="修改的要素列表")
    reasoning_depth: int = Field(default=3, ge=1, le=10, description="推理深度")


class ReasoningStep(BaseModel):
    step_id: str
    description: str
    law_reference: Optional[str] = None
    case_reference: Optional[str] = None
    confidence: float = Field(default=1.0, ge=0, le=1)
    details: Optional[Dict[str, Any]] = None


class DifferenceItem(BaseModel):
    field: str
    original_value: Any
    modified_value: Any
    impact: str = Field(..., description="影响说明")
    severity: str = Field(default="medium", description="影响程度: low, medium, high")


class ReasoningResult(BaseModel):
    success: bool = True
    case_id: str
    original_verdict: str = Field(..., description="原判决结果")
    alternative_verdict: str = Field(..., description="替代判决结果")
    reasoning_path: List[ReasoningStep] = Field(default_factory=list, description="推理路径")
    confidence: float = Field(default=0.85, ge=0, le=1, description="推理置信度")
    differences: List[DifferenceItem] = Field(default_factory=list, description="差异点分析")
    relevant_laws: List[Dict[str, Any]] = Field(default_factory=list, description="相关法条")
    relevant_cases: List[Dict[str, Any]] = Field(default_factory=list, description="相关判例")
    execution_time: Optional[float] = None
