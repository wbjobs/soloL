from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from .config import settings
from .routes.upload import router as upload_router
from .routes.solve import router as solve_router
from .routes.tasks import router as tasks_router
from .routes.matrix import router as matrix_router
from .routes.batch import router as batch_router

app = FastAPI(
    title="Matrix Solver API",
    description="High-performance sparse matrix linear system solver",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {
        "name": "Matrix Solver API",
        "version": "1.0.0",
        "endpoints": {
            "upload": "/api/v1/upload",
            "solve": "/api/v1/solve",
            "batch_solve": "/api/v1/batch/solve",
            "tasks": "/api/v1/tasks",
            "matrix": "/api/v1/matrix/{id}/stats",
            "condition": "/api/v1/matrix/{id}/condition",
        },
        "solvers": ["cg", "gmres", "superlu"],
        "max_matrix_size": settings.max_matrix_size,
        "task_timeout": settings.task_timeout,
    }


@app.get("/health")
async def health_check():
    try:
        from .db.redis import redis_client
        redis_client.client.ping()
        return {"status": "healthy", "redis": "connected"}
    except Exception as e:
        return JSONResponse(
            status_code=503,
            content={"status": "unhealthy", "redis": "disconnected", "error": str(e)},
        )


app.include_router(upload_router)
app.include_router(solve_router)
app.include_router(tasks_router)
app.include_router(matrix_router)
app.include_router(batch_router)


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal server error: {str(exc)}"},
    )
