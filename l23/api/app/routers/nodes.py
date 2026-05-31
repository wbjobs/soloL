from fastapi import APIRouter

from app.models.schemas import EdgeNode, HeatmapResponse, EdgeNodeActivity
from app.services.services import edge_node_service

router = APIRouter(prefix="/api/nodes", tags=["nodes"])


@router.get("", response_model=list[EdgeNode])
async def list_nodes():
    nodes = await edge_node_service.list_nodes()
    return [EdgeNode(**n) for n in nodes]


@router.get("/heatmap", response_model=HeatmapResponse)
async def get_heatmap():
    data = await edge_node_service.get_heatmap_data()
    return HeatmapResponse(**data)


@router.get("/{node_id}", response_model=EdgeNode)
async def get_node(node_id: str):
    nodes = await edge_node_service.list_nodes()
    for n in nodes:
        if n["id"] == node_id:
            return EdgeNode(**n)
    from fastapi import HTTPException
    raise HTTPException(status_code=404, detail="Node not found")
