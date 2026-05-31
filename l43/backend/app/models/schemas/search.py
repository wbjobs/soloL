from pydantic import BaseModel, Field
from typing import Optional, List, Any
from enum import Enum


class SearchType(str, Enum):
    ALL = "all"
    LAW = "law"
    CASE = "case"
    CIRCUMSTANCE = "circumstance"


class SearchRequest(BaseModel):
    query: str = Field(..., description="检索关键词", min_length=1)
    search_type: SearchType = Field(default=SearchType.ALL, description="检索类型")
    limit: int = Field(default=10, ge=1, le=100, description="返回数量")
    filters: Optional[dict] = None


class SearchResult(BaseModel):
    id: str
    title: str
    content: str
    similarity: float = Field(..., ge=0, le=1, description="相似度")
    type: str
    metadata: Optional[dict] = None


class SearchResponse(BaseModel):
    success: bool = True
    query: str
    results: List[SearchResult] = Field(default_factory=list)
    total: int = 0
    execution_time: Optional[float] = None
