import os
import sys
from celery import Celery
from config import Config

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

celery = Celery(
    'anomaly_detection',
    broker=Config.CELERY_BROKER_URL,
    backend=Config.CELERY_RESULT_BACKEND
)

celery.conf.update(
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    timezone='UTC',
    enable_utc=True,
    task_track_started=True,
    task_time_limit=300,
    worker_prefetch_multiplier=1,
)

import app.tasks
