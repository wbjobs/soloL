from pydantic import BaseModel, Field
from typing import Optional, List, Any, Dict
from enum import Enum


class EntityType(str, Enum):
    LAW = "law"
    CASE = "case"
    ELEMENT = "element"
    CIRCUMSTANCE = "circumstance"
    PERSON = "person"


class RelationType(str, Enum):
    APPLIES = "APPLIES"
    CONFLICTS = "CONFLICTS"
    EXCEPTION = "EXCEPTION"
    REFERENCES = "REFERENCES"
    INCLUDES = "INCLUDES"
    HAS = "HAS"
    INVOLVES = "INVOLVES"
    RELEVANT_TO = "RELEVANT_TO"


class GraphEntity(BaseModel):
    id: str = Field(..., description="实体ID")
    label: str = Field(..., description="实体显示名称")
    type: EntityType = Field(..., description="实体类型")
    properties: Dict[str, Any] = Field(default_factory=dict, description="实体属性")
    x: Optional[float] = None
    y: Optional[float] = None


class GraphRelation(BaseModel):
    id: str = Field(..., description="关系ID")
    source: str = Field(..., description="起点实体ID")
    target: str = Field(..., description="终点实体ID")
    type: RelationType = Field(..., description="关系类型")
    properties: Dict[str, Any] = Field(default_factory=dict, description="关系属性")


class GraphResponse(BaseModel):
    nodes: List[GraphEntity] = Field(default_factory=list, description="节点列表")
    edges: List[GraphRelation] = Field(default_factory=list, description="边列表")
    case_id: Optional[str] = None
    stats: Dict[str, Any] = Field(default_factory=dict)


class EntityListResponse(BaseModel):
    items: List[GraphEntity] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 20
