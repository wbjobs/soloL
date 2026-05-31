from sqlalchemy import Column, Integer, String, DateTime, Float, Text, ForeignKey, JSON
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from .database import Base


class UploadFile(Base):
    __tablename__ = "upload_files"

    id = Column(Integer, primary_key=True, index=True)
    file_id = Column(String(64), unique=True, index=True, nullable=False)
    filename = Column(String(255), nullable=False)
    file_size = Column(Integer, nullable=False)
    total_chunks = Column(Integer, nullable=False)
    uploaded_chunks = Column(Integer, default=0)
    file_path = Column(String(512))
    status = Column(String(20), default="uploading")
    sequence_name = Column(String(255))
    sequence_length = Column(Integer)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class AlignmentTask(Base):
    __tablename__ = "alignment_tasks"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(String(64), unique=True, index=True, nullable=False)
    file1_id = Column(String(64), ForeignKey("upload_files.file_id"), nullable=False)
    file2_id = Column(String(64), ForeignKey("upload_files.file_id"), nullable=False)
    status = Column(String(20), default="pending")
    progress = Column(Float, default=0.0)
    similarity_score = Column(Float)
    alignment_length = Column(Integer)
    gap_count = Column(Integer)
    mismatch_count = Column(Integer)
    match_count = Column(Integer)
    identity_percentage = Column(Float)
    error_message = Column(Text)
    started_at = Column(DateTime(timezone=True))
    completed_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    file1 = relationship("UploadFile", foreign_keys=[file1_id])
    file2 = relationship("UploadFile", foreign_keys=[file2_id])


class AlignmentResult(Base):
    __tablename__ = "alignment_results"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(String(64), ForeignKey("alignment_tasks.task_id"), nullable=False, unique=True)
    aligned_sequence1 = Column(Text, nullable=False)
    aligned_sequence2 = Column(Text, nullable=False)
    start_pos1 = Column(Integer)
    start_pos2 = Column(Integer)
    end_pos1 = Column(Integer)
    end_pos2 = Column(Integer)
    score_matrix = Column(JSON)
    difference_sites = Column(JSON)
    hilbert_data = Column(JSON)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    task = relationship("AlignmentTask")
