import os
from datetime import timedelta
from pathlib import Path


class Config:
    BASE_DIR = Path(__file__).resolve().parent.parent

    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key-change-in-production")

    SQLALCHEMY_DATABASE_URI = os.getenv(
        "DATABASE_URL", "sqlite:///pointcloud_annotator.db"
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "jwt-secret-key-change-in-production")
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(minutes=15)
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(days=7)

    UPLOAD_FOLDER = BASE_DIR / "uploads"
    EXPORT_FOLDER = BASE_DIR / "exports"
    MODELS_FOLDER = BASE_DIR / "models"

    MAX_CONTENT_LENGTH = 5 * 1024 * 1024 * 1024

    ALLOWED_EXTENSIONS = {".ply"}

    CORS_HEADERS = "Content-Type"

    INFERENCE_BATCH_SIZE = int(os.getenv("INFERENCE_BATCH_SIZE", "1024"))
    USE_GPU = os.getenv("USE_GPU", "true").lower() == "true"

    def __init__(self) -> None:
        self.UPLOAD_FOLDER.mkdir(parents=True, exist_ok=True)
        self.EXPORT_FOLDER.mkdir(parents=True, exist_ok=True)
        self.MODELS_FOLDER.mkdir(parents=True, exist_ok=True)
