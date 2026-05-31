import os

from fastapi import APIRouter
from fastapi.responses import FileResponse

from app.models.schemas import FileListResponse
from app.services.services import tracker_service, chunk_service
from app.config import TORRENTS_PATH, CHUNKS_PATH

router = APIRouter(prefix="/api", tags=["files"])


@router.get("/files", response_model=FileListResponse)
async def list_files():
    files = await tracker_service.get_all_files()
    return FileListResponse(files=files)


@router.get("/torrent/{file_id}")
async def get_torrent(file_id: str):
    torrent_path = os.path.join(TORRENTS_PATH, f"{file_id}.torrent")
    if not os.path.exists(torrent_path):
        return {"error": "Torrent not found"}
    return FileResponse(
        torrent_path,
        media_type="application/x-bittorrent",
        filename=f"{file_id}.torrent",
    )


@router.get("/chunk/{file_id}/{chunk_index}")
async def get_chunk(file_id: str, chunk_index: int):
    data = await chunk_service.get_chunk(file_id, chunk_index)
    if data is None:
        return {"error": "Chunk not found"}
    from fastapi.responses import Response
    return Response(content=data, media_type="application/octet-stream")
