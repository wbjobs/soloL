from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime


class ChunkUploadRequest(BaseModel):
    file_id: str
    chunk_index: int
    total_chunks: int
    filename: str
    file_size: int
    file_hash: Optional[str] = None


class ChunkUploadResponse(BaseModel):
    success: bool
    file_id: str
    chunk_index: int
    uploaded_chunks: int
    total_chunks: int
    completed: bool


class FileInfoResponse(BaseModel):
    file_id: str
    filename: str
    file_size: int
    status: str
    sequence_name: Optional[str] = None
    sequence_length: Optional[int] = None
    created_at: datetime


class AlignmentTaskRequest(BaseModel):
    file1_id: str
    file2_id: str
    match_score: int = Field(default=2, ge=1)
    mismatch_penalty: int = Field(default=-1, le=-1)
    gap_penalty: int = Field(default=-2, le=-1)


class AlignmentTaskResponse(BaseModel):
    task_id: str
    status: str
    file1_id: str
    file2_id: str
    created_at: datetime


class TaskProgressResponse(BaseModel):
    task_id: str
    status: str
    progress: float
    message: Optional[str] = None
    current_stage: Optional[str] = None


class AlignmentResultSummary(BaseModel):
    task_id: str
    similarity_score: float
    alignment_length: int
    gap_count: int
    mismatch_count: int
    match_count: int
    identity_percentage: float
    completed_at: datetime


class DifferenceSite(BaseModel):
    position: int
    base1: str
    base2: str
    type: str


class AlignmentResultDetail(AlignmentResultSummary):
    aligned_sequence1: str
    aligned_sequence2: str
    start_pos1: int
    start_pos2: int
    end_pos1: int
    end_pos2: int
    difference_sites: List[DifferenceSite]
    hilbert_data: List[Dict[str, Any]]


class WSMessage(BaseModel):
    type: str
    task_id: str
    data: Dict[str, Any]


class RegionAlignmentRequest(BaseModel):
    task_id: str
    start_pos1: int = Field(ge=0)
    end_pos1: int = Field(gt=0)
    start_pos2: int = Field(ge=0)
    end_pos2: int = Field(gt=0)
    match_score: int = Field(default=3, ge=1)
    mismatch_penalty: int = Field(default=-2, le=-1)
    gap_penalty: int = Field(default=-4, le=-1)
    gap_extend_penalty: int = Field(default=-1, le=0)


class RegionAlignmentResponse(BaseModel):
    success: bool
    task_id: str
    region_id: str
    aligned_sequence1: str
    aligned_sequence2: str
    start_pos1: int
    end_pos1: int
    start_pos2: int
    end_pos2: int
    identity_percentage: float
    similarity_score: float
    match_count: int
    mismatch_count: int
    gap_count: int
    difference_sites: List[DifferenceSite]
    hilbert_data: Optional[List[Dict[str, Any]]] = None


class ExportRequest(BaseModel):
    task_id: str
    format: str = Field(pattern="^(csv|phylip|bed)$")
    include_metadata: bool = True
    seq1_name: Optional[str] = None
    seq2_name: Optional[str] = None


class HilbertRegionSelection(BaseModel):
    task_id: str
    hilbert_indices: List[int]
    start_position: int
    end_position: int
    center_x: float
    center_y: float
    center_z: float
    radius: float


__all__ = [
    "ChunkUploadRequest",
    "ChunkUploadResponse",
    "FileInfoResponse",
    "AlignmentTaskRequest",
    "AlignmentTaskResponse",
    "TaskProgressResponse",
    "AlignmentResultSummary",
    "DifferenceSite",
    "AlignmentResultDetail",
    "WSMessage",
    "RegionAlignmentRequest",
    "RegionAlignmentResponse",
    "ExportRequest",
    "HilbertRegionSelection"
]
