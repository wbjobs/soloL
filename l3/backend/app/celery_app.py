from celery import Celery
from .config import settings

celery = Celery(
    "gene_alignment",
    broker=settings.RABBITMQ_URL,
    backend=settings.REDIS_URL,
    include=["app.tasks"]
)

celery.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Asia/Shanghai",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=3600 * 6,
    task_soft_time_limit=3600 * 5,
    worker_prefetch_multiplier=1,
    worker_max_tasks_per_child=10,
    acks_late=True,
    task_reject_on_worker_lost=True,
    task_acks_late=True,
    task_default_retry_delay=30,
    task_max_retries=3,
    broker_transport_options={
        "max_retries": 3,
        "interval_start": 0,
        "interval_step": 0.2,
        "interval_max": 0.5,
    },
    result_backend_transport_options={
        "visibility_timeout": 3600 * 6,
    },
    broker_connection_retry_on_startup=True,
    broker_connection_max_retries=10,
)


if __name__ == "__main__":
    celery.start()
