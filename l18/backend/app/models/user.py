from datetime import datetime
from typing import Optional
import uuid
import hashlib

from app.extensions import db


ROLE_PRIORITY = {
    "admin": 3,
    "senior": 2,
    "annotator": 1,
    "junior": 0,
}

ROLE_LABELS = {
    "admin": "管理员",
    "senior": "资深远",
    "annotator": "标注员",
    "junior": "新手",
}


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


def verify_password(password: str, password_hash: str) -> bool:
    return hash_password(password) == password_hash


def get_role_priority(role: str) -> int:
    return ROLE_PRIORITY.get(role, 0)


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    name = db.Column(db.String(100), nullable=True)
    role = db.Column(db.String(20), nullable=False, default="junior")
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    projects = db.relationship("Project", back_populates="user", cascade="all, delete-orphan")
    annotations = db.relationship("Annotation", back_populates="user", cascade="all, delete-orphan")

    def __init__(
        self,
        email: str,
        password: str,
        role: str = "junior",
        name: Optional[str] = None,
    ) -> None:
        self.email = email
        self.password_hash = hash_password(password)
        self.role = role
        self.name = name

    @property
    def role_priority(self) -> int:
        return get_role_priority(self.role)

    @property
    def role_label(self) -> str:
        return ROLE_LABELS.get(self.role, self.role)

    @property
    def password(self) -> None:
        raise AttributeError("password is not a readable attribute")

    @password.setter
    def password(self, password: str) -> None:
        self.password_hash = hash_password(password)

    def check_password(self, password: str) -> bool:
        return verify_password(password, self.password_hash)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "email": self.email,
            "name": self.name,
            "role": self.role,
            "isActive": self.is_active,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }

    def __repr__(self) -> str:
        return f"<User {self.email}>"
