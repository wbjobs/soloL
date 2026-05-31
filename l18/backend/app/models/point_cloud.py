from datetime import datetime
from typing import Optional
import uuid
import os

from sqlalchemy.types import JSON, LargeBinary

JSON_TYPE = JSON
BINARY_TYPE = LargeBinary

try:
    from sqlalchemy.dialects.postgresql import JSONB, BYTEA
    database_url = os.environ.get("DATABASE_URL", "")
    if database_url.startswith("postgresql"):
        JSON_TYPE = JSONB
        BINARY_TYPE = BYTEA
except ImportError:
    pass

from app.extensions import db


class LabelDefinition(db.Model):
    __tablename__ = "label_definitions"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), unique=True, nullable=False)
    color = db.Column(db.String(7), nullable=False)
    description = db.Column(db.Text, nullable=True)

    label_chunks = db.relationship("LabelChunk", back_populates="label_definition")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "color": self.color,
            "description": self.description,
        }


class PointCloud(db.Model):
    __tablename__ = "point_clouds"

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = db.Column(db.String(36), db.ForeignKey("projects.id"), nullable=False, index=True)
    name = db.Column(db.String(255), nullable=False)
    filename = db.Column(db.String(255), nullable=False)
    total_points = db.Column(db.BigInteger, nullable=False)
    bounds = db.Column(JSON_TYPE, nullable=False)
    lod_levels = db.Column(db.Integer, nullable=False, default=3)
    file_path = db.Column(db.String(500), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    project = db.relationship("Project", back_populates="point_clouds")
    label_chunks = db.relationship("LabelChunk", back_populates="point_cloud", cascade="all, delete-orphan")
    annotations = db.relationship("Annotation", back_populates="point_cloud", cascade="all, delete-orphan")
    quality_assessments = db.relationship("QualityAssessment", back_populates="point_cloud", cascade="all, delete-orphan")

    def __init__(
        self,
        name: str,
        filename: str,
        project_id: str,
        total_points: int,
        bounds: dict,
        file_path: str,
        lod_levels: int = 3,
    ) -> None:
        self.name = name
        self.filename = filename
        self.project_id = project_id
        self.total_points = total_points
        self.bounds = bounds
        self.file_path = file_path
        self.lod_levels = lod_levels

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "projectId": self.project_id,
            "name": self.name,
            "filename": self.filename,
            "totalPoints": self.total_points,
            "bounds": self.bounds,
            "lodLevels": self.lod_levels,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }


class LabelChunk(db.Model):
    __tablename__ = "label_chunks"

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    point_cloud_id = db.Column(db.String(36), db.ForeignKey("point_clouds.id"), nullable=False, index=True)
    label_id = db.Column(db.Integer, db.ForeignKey("label_definitions.id"), nullable=True)
    start_index = db.Column(db.BigInteger, nullable=False)
    end_index = db.Column(db.BigInteger, nullable=False)
    label_data = db.Column(BINARY_TYPE, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    point_cloud = db.relationship("PointCloud", back_populates="label_chunks")
    label_definition = db.relationship("LabelDefinition", back_populates="label_chunks")

    __table_args__ = (
        db.Index("idx_label_chunks_range", "point_cloud_id", "start_index", "end_index"),
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "pointCloudId": self.point_cloud_id,
            "labelId": self.label_id,
            "startIndex": self.start_index,
            "endIndex": self.end_index,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }
