import os
import sys
from pathlib import Path

project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

from celery_app import celery

if __name__ == "__main__":
    worker = celery.Worker(
        concurrency=2,
        pool="prefork",
        loglevel="INFO",
        hostname="solver_worker@%h",
    )
    worker.start()
