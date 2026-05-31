from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = "postgresql+psycopg2://gene_user:gene_password@localhost:5432/gene_alignment"
    RABBITMQ_URL: str = "amqp://celery_user:celery_password@localhost:5672//"
    REDIS_URL: str = "redis://localhost:6379/0"
    UPLOAD_DIR: str = "./uploads"
    CHUNK_SIZE: int = 5 * 1024 * 1024
    MAX_FILE_SIZE: int = 2 * 1024 * 1024 * 1024
    API_HOST: str = "0.0.0.0"
    API_PORT: int = 8000
    WS_MANAGER_HOST: str = "0.0.0.0"
    WS_MANAGER_PORT: int = 8765


settings = Settings()
