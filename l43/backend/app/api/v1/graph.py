from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from app.services.graph_service import graph_service
from app.models.schemas.graph import GraphResponse, EntityListResponse

router = APIRouter(prefix="/graph", tags=["知识图谱"])


@router.get("/full", response_model=GraphResponse, summary="获取完整知识图谱")
async def get_full_graph(limit: int = Query(default=200, ge=10, le=1000)):
    return await graph_service.get_full_graph(limit)


@router.get("/case/{case_id}", response_model=GraphResponse, summary="获取案件知识图谱")
async def get_case_graph(case_id: str):
    return await graph_service.build_case_graph(case_id)


@router.get("/entity/{entity_id}", summary="获取实体详情")
async def get_entity_detail(entity_id: str):
    result = await graph_service.get_entity_detail(entity_id)
    if not result:
        raise HTTPException(status_code=404, detail="实体不存在")
    return result


@router.get("/entities", response_model=EntityListResponse, summary="获取实体列表")
async def get_entities(
    entity_type: str = Query(default="law"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100)
):
    return await graph_service.get_entities(entity_type, page, page_size)


@router.get("/path", summary="查找两实体间路径")
async def find_path(
    start_id: str = Query(..., description="起点实体ID"),
    end_id: str = Query(..., description="终点实体ID")
):
    result = await graph_service.find_path(start_id, end_id)
    return {"path": result}


@router.get("/stats", summary="获取图谱统计信息")
async def get_stats():
    return await graph_service.get_stats()
