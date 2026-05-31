from app.celery_app import celery

if __name__ == "__main__":
    celery.start(argv=["worker", "--loglevel=info", "--concurrency=4", "-P", "threads"])
