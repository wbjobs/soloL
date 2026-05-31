from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    APP_NAME: str = "多模态知识图谱法律辅助系统"
    APP_VERSION: str = "1.0.0"
    API_V1_PREFIX: str = "/api/v1"
    DEBUG: bool = True

    NEO4J_URI: str = "bolt://localhost:7687"
    NEO4J_USER: str = "neo4j"
    NEO4J_PASSWORD: str = "password"
    NEO4J_DATABASE: str = "neo4j"

    MILVUS_URI: str = "http://localhost:19530"
    MILVUS_TOKEN: Optional[str] = None
    VECTOR_DIMENSION: int = 768

    DATABASE_URL: str = "sqlite:///./legal_assistant.db"

    UPLOAD_DIR: str = "uploads"
    MAX_UPLOAD_SIZE: int = 50 * 1024 * 1024

    OCR_LANG: str = "ch"
    ASR_MODEL: str = "base"

    EMBEDDING_MODEL: str = "shibing624/text2vec-base-chinese"

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
