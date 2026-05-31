from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.services.services import (
    chunk_service, torrent_service, tracker_service,
    hotness_service, edge_node_service,
)
from app.routers import upload, files, tracker, stats, hotness, nodes, replicas


@asynccontextmanager
async def lifespan(app: FastAPI):
    await chunk_service.init_redis()
    await torrent_service.init_redis()
    await tracker_service.init_redis()
    await hotness_service.init_redis()
    await edge_node_service.init_redis()

    tracker_service.start_health_check()
    hotness_service.start_hotness_monitor()

    yield

    await chunk_service.close_redis()
    await torrent_service.close_redis()
    await tracker_service.close_redis()
    await hotness_service.close_redis()
    await edge_node_service.close_redis()


app = FastAPI(title="P2P File Distribution API", version="1.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(upload.router)
app.include_router(files.router)
app.include_router(tracker.router)
app.include_router(stats.router)
app.include_router(hotness.router)
app.include_router(nodes.router)
app.include_router(replicas.router)


@app.get("/")
async def root():
    return {
        "message": "P2P File Distribution API",
        "version": "1.1.0",
        "features": [
            "File chunking with SHA-256 verification",
            "Torrent generation and seeding",
            "Tracker with Redis-backed peer management",
            "Peer health checking (30s ping, 3 failures = remove)",
            "Intelligent peer selection (top 5 fastest uploaders)",
            "Hotness-based auto replication (Docker edge nodes)",
            "Geographic heatmap visualization",
        ],
    }
