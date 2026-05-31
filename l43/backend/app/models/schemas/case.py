from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional, List, Any, Dict
from enum import Enum


class CaseType(str, Enum):
    CRIMINAL = "criminal"
    CIVIL = "civil"
    ADMINISTRATIVE = "administrative"


class CaseStatus(str, Enum):
    PROCESSING = "processing"
    COMPLETED = "completed"


class CaseCreate(BaseModel):
    title: str = Field(..., description="案件标题", max_length=200)
    description: str = Field(..., description="案件描述")
    case_type: CaseType = Field(default=CaseType.CIVIL, description="案件类型")


class CaseUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    case_type: Optional[CaseType] = None
    status: Optional[CaseStatus] = None


class CaseElement(BaseModel):
    id: str = Field(..., description="要素ID")
    name: str = Field(..., description="要素名称")
    type: str = Field(..., description="要素类型: person, amount, action, circumstance")
    value: Any = Field(None, description="要素值")
    editable: bool = Field(default=True, description="是否可编辑")
    metadata: Optional[Dict[str, Any]] = None


class Case(BaseModel):
    id: str
    title: str
    description: str
    case_type: CaseType
    status: CaseStatus
    created_at: datetime
    updated_at: Optional[datetime] = None
    elements: List[CaseElement] = Field(default_factory=list)

    class Config:
        from_attributes = True


class TextUploadRequest(BaseModel):
    content: str = Field(..., description="文本内容")


class TextUploadResponse(BaseModel):
    success: bool = True
    message: str = "文本处理完成"
    elements: List[CaseElement] = Field(default_factory=list)
    extracted_text: str = ""


class ImageUploadResponse(BaseModel):
    success: bool = True
    message: str = "图片识别完成"
    ocr_text: str = ""
    elements: List[CaseElement] = Field(default_factory=list)


class AudioUploadResponse(BaseModel):
    success: bool = True
    message: str = "音频转写完成"
    transcript: str = ""
    elements: List[CaseElement] = Field(default_factory=list)
    segments: List[Dict[str, Any]] = Field(default_factory=list)
