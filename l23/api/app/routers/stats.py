from fastapi import APIRouter

from app.models.schemas import StatsResponse, ChunkStatus
from app.services.services import chunk_service, tracker_service

router = APIRouter(prefix="/api", tags=["stats"])


@router.get("/stats/{file_id}", response_model=StatsResponse)
async def get_stats(file_id: str):
    file_info = await tracker_service.get_file_info(file_id)
    if not file_info:
        return StatsResponse(
            download_speed=0,
            upload_speed=0,
            peers_connected=0,
            progress=0,
            chunks_status=[],
        )

    chunk_hashes = await chunk_service.get_chunk_hashes(file_id)
    total_chunks = file_info.get("total_chunks", 0)
    chunks_status = []
    for i in range(total_chunks):
        verified = str(i) in chunk_hashes
        chunks_status.append(ChunkStatus(index=i, verified=verified))

    seeders = file_info.get("seeders", 0)

    return StatsResponse(
        download_speed=0,
        upload_speed=0,
        peers_connected=seeders,
        progress=len(chunk_hashes) / total_chunks if total_chunks > 0 else 0,
        chunks_status=chunks_status,
    )
