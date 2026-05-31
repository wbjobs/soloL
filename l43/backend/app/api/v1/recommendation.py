from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from app.services.recommendation_service import recommendation_service

router = APIRouter(prefix="/recommendation", tags=["案件推荐"])


@router.get("/similar/{case_id}", summary="获取相似案件推荐")
async def get_similar_cases(
    case_id: str,
    limit: int = Query(default=10, ge=1, le=50, description="返回数量"),
    method: str = Query(default="hybrid", description="推荐方法: hybrid/graph/vector")
):
    if method not in ["hybrid", "graph", "vector"]:
        raise HTTPException(status_code=400, detail="method参数必须是 hybrid, graph 或 vector")

    result = await recommendation_service.get_similar_cases(
        case_id=case_id,
        limit=limit,
        method=method
    )

    if not result.get("success"):
        raise HTTPException(status_code=404, detail=result.get("message", "推荐失败"))

    return result


@router.get("/recommend", summary="获取热门/推荐案件")
async def get_recommendations(
    case_type: Optional[str] = Query(None, description="案件类型过滤"),
    limit: int = Query(default=10, ge=1, le=50, description="返回数量")
):
    result = await recommendation_service.get_case_recommendations(
        case_type=case_type,
        limit=limit
    )
    return result
