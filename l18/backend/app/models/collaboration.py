from datetime import datetime
import uuid
import os
from typing import Optional, List, Dict, Any

from app.extensions import db

try:
    from sqlalchemy.dialects.postgresql import JSONB, BYTEA
    database_url = os.environ.get("DATABASE_URL", "")
    if database_url.startswith("postgresql"):
        JSON_TYPE = JSONB
        BINARY_TYPE = BYTEA
    else:
        from sqlalchemy.types import JSON, LargeBinary
        JSON_TYPE = JSON
        BINARY_TYPE = LargeBinary
except ImportError:
    from sqlalchemy.types import JSON, LargeBinary
    JSON_TYPE = JSON
    BINARY_TYPE = LargeBinary


class Annotation(db.Model):
    __tablename__ = "annotations"

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    point_cloud_id = db.Column(db.String(36), db.ForeignKey("point_clouds.id"), nullable=False, index=True)
    user_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=False, index=True)
    point_index = db.Column(db.Integer, nullable=False, index=True)
    label_id = db.Column(db.Integer, nullable=False)
    role = db.Column(db.String(20), nullable=False)
    role_priority = db.Column(db.Integer, nullable=False, default=0)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    is_deleted = db.Column(db.Boolean, default=False)
    
    point_cloud = db.relationship("PointCloud", back_populates="annotations")
    user = db.relationship("User", back_populates="annotations")

    __table_args__ = (
        db.UniqueConstraint('point_cloud_id', 'user_id', 'point_index', name='_point_cloud_user_point_uc'),
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "pointCloudId": self.point_cloud_id,
            "userId": self.user_id,
            "pointIndex": self.point_index,
            "labelId": self.label_id,
            "role": self.role,
            "rolePriority": self.role_priority,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "isDeleted": self.is_deleted,
        }


class AnnotationHistory(db.Model):
    __tablename__ = "annotation_history"

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    point_cloud_id = db.Column(db.String(36), db.ForeignKey("point_clouds.id"), nullable=False, index=True)
    user_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=False, index=True)
    operation = db.Column(db.String(50), nullable=False)
    data = db.Column(JSON_TYPE, nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    lamport_clock = db.Column(db.Integer, nullable=False, default=0)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "pointCloudId": self.point_cloud_id,
            "userId": self.user_id,
            "operation": self.operation,
            "data": self.data,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "lamportClock": self.lamport_clock,
        }


class QualityAssessment(db.Model):
    __tablename__ = "quality_assessments"

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    point_cloud_id = db.Column(db.String(36), db.ForeignKey("point_clouds.id"), nullable=False, index=True)
    krippendorff_alpha = db.Column(db.Float, nullable=True)
    overall_entropy = db.Column(db.Float, nullable=True)
    controversial_point_count = db.Column(db.Integer, nullable=True, default=0)
    assessment_date = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    details = db.Column(JSON_TYPE, nullable=True)
    needs_review = db.Column(db.Boolean, default=False)

    point_cloud = db.relationship("PointCloud", back_populates="quality_assessments")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "pointCloudId": self.point_cloud_id,
            "krippendorffAlpha": self.krippendorff_alpha,
            "overallEntropy": self.overall_entropy,
            "controversialPointCount": self.controversial_point_count,
            "assessmentDate": self.assessment_date.isoformat() if self.assessment_date else None,
            "details": self.details,
            "needsReview": self.needs_review,
        }


class ControversialPoint(db.Model):
    __tablename__ = "controversial_points"

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    point_cloud_id = db.Column(db.String(36), db.ForeignKey("point_clouds.id"), nullable=False, index=True)
    point_index = db.Column(db.Integer, nullable=False, index=True)
    entropy = db.Column(db.Float, nullable=False)
    label_distribution = db.Column(JSON_TYPE, nullable=False)
    annotator_count = db.Column(db.Integer, nullable=False, default=0)
    last_assessed = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    is_resolved = db.Column(db.Boolean, default=False)

    __table_args__ = (
        db.UniqueConstraint('point_cloud_id', 'point_index', name='_point_cloud_point_uc'),
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "pointCloudId": self.point_cloud_id,
            "pointIndex": self.point_index,
            "entropy": self.entropy,
            "labelDistribution": self.label_distribution,
            "annotatorCount": self.annotator_count,
            "lastAssessed": self.last_assessed.isoformat() if self.last_assessed else None,
            "isResolved": self.is_resolved,
        }


class CollaborativeSession(db.Model):
    __tablename__ = "collaborative_sessions"

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    point_cloud_id = db.Column(db.String(36), db.ForeignKey("point_clouds.id"), nullable=False, index=True)
    host_user_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=False)
    session_name = db.Column(db.String(255), nullable=True)
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    ended_at = db.Column(db.DateTime, nullable=True)
    
    participants = db.Column(JSON_TYPE, nullable=True)
    webrtc_offer = db.Column(JSON_TYPE, nullable=True)
    webrtc_answer = db.Column(JSON_TYPE, nullable=True)
    ice_candidates = db.Column(JSON_TYPE, nullable=True)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "pointCloudId": self.point_cloud_id,
            "hostUserId": self.host_user_id,
            "sessionName": self.session_name,
            "isActive": self.is_active,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "endedAt": self.ended_at.isoformat() if self.ended_at else None,
            "participants": self.participants,
        }
