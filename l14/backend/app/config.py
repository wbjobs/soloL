from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str = "redis://localhost:6379/1"
    celery_result_backend: str = "redis://localhost:6379/2"

    max_matrix_size: int = 1_000_000
    max_upload_size: int = 512 * 1024 * 1024
    task_timeout: int = 300

    upload_dir: str = "../uploads"
    result_dir: str = "../results"

    default_tol: float = 1e-6
    default_max_iter: int = 1000

    cors_origins: list = ["http://localhost:5173", "http://localhost:3000"]


settings = Settings()
