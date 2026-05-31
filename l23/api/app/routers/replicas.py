from fastapi import APIRouter, HTTPException, Body

from app.models.schemas import (
    SeederContainer, ReplicaCreateRequest, ReplicaRemoveRequest
)
from app.services.services import edge_node_service

router = APIRouter(prefix="/api/replicas", tags=["replicas"])


@router.get("", response_model=list[SeederContainer])
async def list_replicas(info_hash: str | None = None):
    replicas = await edge_node_service.get_replicas(info_hash)
    return [SeederContainer(**r) for r in replicas]


@router.post("", response_model=list[SeederContainer])
async def create_replicas(req: ReplicaCreateRequest):
    replicas = await edge_node_service.create_replicas(
        file_id=req.file_id,
        info_hash="",
        file_name="",
        count=req.count or 1,
        target_node_ids=req.target_node_ids,
    )
    if not replicas:
        raise HTTPException(status_code=400, detail="Failed to create replicas")
    return [SeederContainer(**r) for r in replicas]


@router.delete("", response_model=dict)
async def remove_replica(req: ReplicaRemoveRequest):
    success = await edge_node_service.remove_replica(req.container_id)
    if not success:
        raise HTTPException(status_code=404, detail="Replica not found")
    return {"success": True, "container_id": req.container_id}
