from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.config.settings import settings
from app.api.v1 import case, graph, reasoning, search, recommendation, annotation, judgment
from app.utils.logger import setup_logger

logger = setup_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"{settings.APP_NAME} 启动中...")
    from app.repositories.graph_repository import graph_repository
    from app.repositories.vector_repository import vector_repository
    
    try:
        await graph_repository.connect()
        logger.info("Neo4j 连接成功")
    except Exception as e:
        logger.warning(f"Neo4j 连接失败: {e}，请确保数据库已启动")
    
    try:
        vector_repository.connect()
        logger.info("Milvus 连接成功")
    except Exception as e:
        logger.warning(f"Milvus 连接失败: {e}，请确保数据库已启动")
    
    yield
    
    await graph_repository.disconnect()
    vector_repository.disconnect()
    logger.info(f"{settings.APP_NAME} 已关闭")


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="多模态知识图谱驱动的反事实推理法律辅助系统",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(case.router, prefix=settings.API_V1_PREFIX, tags=["案件管理"])
app.include_router(graph.router, prefix=settings.API_V1_PREFIX, tags=["知识图谱"])
app.include_router(reasoning.router, prefix=settings.API_V1_PREFIX, tags=["反事实推理"])
app.include_router(search.router, prefix=settings.API_V1_PREFIX, tags=["法律检索"])
app.include_router(recommendation.router, prefix=settings.API_V1_PREFIX, tags=["案件推荐"])
app.include_router(annotation.router, prefix=settings.API_V1_PREFIX, tags=["协同批注"])
app.include_router(judgment.router, prefix=settings.API_V1_PREFIX, tags=["判决书生成"])


@app.get("/")
async def root():
    return {
        "name": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "status": "running",
        "docs": "/docs"
    }


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.DEBUG
    )
