from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import os
from .config import settings
from .database import engine, Base
from .redis_client import RedisManager
from .routers import upload, alignment, websocket, analysis

Base.metadata.create_all(bind=engine)

os.makedirs(settings.UPLOAD_DIR, exist_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await RedisManager.close_async()
    RedisManager.close_sync()


app = FastAPI(
    title="基因序列比对API",
    description="基于Smith-Waterman算法的基因序列比对系统",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(upload.router, prefix="/api/upload", tags=["文件上传"])
app.include_router(alignment.router, prefix="/api/alignment", tags=["序列比对"])
app.include_router(websocket.router, prefix="/api/ws", tags=["WebSocket"])
app.include_router(analysis.router, prefix="/api/analysis", tags=["区域分析与导出"])


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "message": "服务运行正常"}
