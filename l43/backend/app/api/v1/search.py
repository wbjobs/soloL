from fastapi import APIRouter
from app.services.search_service import search_service
from app.models.schemas.search import SearchRequest, SearchResponse

router = APIRouter(prefix="/search", tags=["法律检索"])


@router.post("/legal", response_model=SearchResponse, summary="法条判例检索")
async def search_legal(request: SearchRequest):
    result = await search_service.search(
        query=request.query,
        search_type=request.search_type.value,
        limit=request.limit
    )
    return result


@router.get("/suggest", summary="搜索建议")
async def search_suggest(query: str, limit: int = 5):
    suggestions = [
        {"text": f"关于{query}的法律规定", "type": "law"},
        {"text": f"{query}相关判例", "type": "case"},
        {"text": f"{query}适用情节", "type": "circumstance"},
    ]
    return {"suggestions": suggestions[:limit]}
