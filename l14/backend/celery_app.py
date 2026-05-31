from celery import Celery
from .app.config import settings
import os
from datetime import timedelta

celery = Celery(
    "matrix_solver",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
)

celery.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=settings.task_timeout + 30,
    task_soft_time_limit=settings.task_timeout,
    worker_prefetch_multiplier=1,
    worker_max_tasks_per_child=10,
    result_expires=timedelta(days=1),
    broker_connection_retry_on_startup=True,
    broker_connection_max_retries=5,
    broker_pool_limit=10,
)

from .app.tasks import solve_tasks

celery.autodiscover_tasks(["backend.app.tasks"], force=True)
