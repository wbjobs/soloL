from datetime import datetime
from typing import Optional
import uuid

from app.extensions import db


class Project(db.Model):
    __tablename__ = "projects"

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=False, index=True)
    name = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = db.relationship("User", back_populates="projects")
    point_clouds = db.relationship("PointCloud", back_populates="project", cascade="all, delete-orphan")

    def __init__(self, name: str, user_id: str, description: Optional[str] = None) -> None:
        self.name = name
        self.user_id = user_id
        self.description = description

    def to_dict(self, include_point_clouds: bool = False) -> dict:
        data = {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "userId": self.user_id,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }
        if include_point_clouds:
            data["pointClouds"] = [pc.to_dict() for pc in self.point_clouds]
        return data

    def __repr__(self) -> str:
        return f"<Project {self.name}>"
