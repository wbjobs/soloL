from fastapi import APIRouter, HTTPException

from app.models.schemas import HotnessResponse, HotnessInfo
from app.services.services import hotness_service

router = APIRouter(prefix="/api/hotness", tags=["hotness"])


@router.get("", response_model=HotnessResponse)
async def get_hot_files():
    data = await hotness_service.get_hot_files()
    return HotnessResponse(**data)


@router.get("/{file_id}", response_model=HotnessInfo)
async def get_file_hotness(file_id: str):
    hotness = await hotness_service.get_file_hotness(file_id)
    if not hotness:
        raise HTTPException(status_code=404, detail="File not found")
    return HotnessInfo(**hotness)
