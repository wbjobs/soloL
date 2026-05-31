from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime
import uuid


class AnnotationBase(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    midi_id: str
    type: str
    label: str
    start_time: float
    end_time: float
    track: Optional[int] = None
    notes: Optional[List[str]] = None
    metadata: Optional[Dict[str, Any]] = None
    created_by: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    version: int = 0
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    deleted: bool = False


class AnnotationCreate(BaseModel):
    midi_id: str
    type: str
    label: str
    start_time: float
    end_time: float
    track: Optional[int] = None
    notes: Optional[List[str]] = None
    metadata: Optional[Dict[str, Any]] = None
    created_by: str


class AnnotationUpdate(BaseModel):
    label: Optional[str] = None
    start_time: Optional[float] = None
    end_time: Optional[float] = None
    metadata: Optional[Dict[str, Any]] = None


class AnnotationResponse(AnnotationBase):
    pass


class MidiFileInfo(BaseModel):
    midi_id: str
    filename: str
    total_notes: int
    total_duration: float
    track_count: int
    created_at: datetime


class NoteResponse(BaseModel):
    id: str
    pitch: int
    velocity: int
    start_time: float
    duration: float
    track: int
    channel: int
    note_name: str


class TrackResponse(BaseModel):
    id: int
    name: str
    program: int
    channel: int
    notes_count: int


class MidiDetailResponse(BaseModel):
    midi_id: str
    filename: str
    ticks_per_beat: int
    time_signatures: List[Dict[str, Any]]
    tempos: List[Dict[str, Any]]
    tracks: List[TrackResponse]
    notes: List[NoteResponse]
    total_duration: float
    total_notes: int
    created_at: datetime


class WSMessage(BaseModel):
    type: str
    data: Dict[str, Any]
    user_id: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    version: Optional[int] = None
    client_version: Optional[int] = None


class AnnotationDelta(BaseModel):
    id: str
    midi_id: str
    operation: str
    version: int
    data: Dict[str, Any]
    timestamp: datetime


class AnnotationSyncRequest(BaseModel):
    midi_id: str
    client_version: int


class AnnotationSyncResponse(BaseModel):
    midi_id: str
    server_version: int
    deltas: List[AnnotationDelta]
    has_more: bool


class MidiSlicesResponse(BaseModel):
    midi_id: str
    total_duration: float
    slice_duration: float
    total_slices: int
    track_summary: Dict[int, int]


class VisibleNotesResponse(BaseModel):
    midi_id: str
    visible_notes: List[Dict[str, Any]]
    slice_indices: List[int]
    total_slices: int
    slice_duration: float
    viewport_start: float
    viewport_end: float


class ExportAnnotationsResponse(BaseModel):
    midi_id: str
    filename: str
    exported_at: datetime
    annotations: List[AnnotationResponse]
    total_annotations: int
