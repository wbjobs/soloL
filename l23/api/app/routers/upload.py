import os
import uuid

from fastapi import APIRouter, UploadFile, File, Form

from app.models.schemas import ChunkUploadResponse, UploadCompleteRequest, UploadCompleteResponse
from app.services.services import chunk_service, torrent_service, tracker_service

router = APIRouter(prefix="/api", tags=["upload"])


@router.post("/upload", response_model=ChunkUploadResponse)
async def upload_chunk(
    file: UploadFile = File(...),
    chunk_index: int = Form(...),
    chunk_hash: str = Form(...),
    total_chunks: int = Form(...),
    file_id: str = Form(...),
):
    data = await file.read()
    actual_hash = await chunk_service.save_chunk(file_id, chunk_index, data)
    verified = actual_hash == chunk_hash
    return ChunkUploadResponse(
        file_id=file_id,
        chunk_index=chunk_index,
        verified=verified,
    )


@router.post("/upload/complete", response_model=UploadCompleteResponse)
async def upload_complete(req: UploadCompleteRequest):
    file_id = req.file_id or str(uuid.uuid4())
    if not req.file_id:
        req.file_id = file_id

    info_hash, magnet_uri, torrent_path = await torrent_service.generate_torrent(
        file_id=file_id,
        file_name=req.file_name,
        total_size=req.total_size,
        total_chunks=req.total_chunks,
        chunk_hashes=req.chunk_hashes,
    )

    torrent_url = f"/api/torrent/{file_id}"

    return UploadCompleteResponse(
        file_id=file_id,
        torrent_url=torrent_url,
        magnet_uri=magnet_uri,
        info_hash=info_hash,
    )
