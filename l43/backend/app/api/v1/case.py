from fastapi import APIRouter, HTTPException, UploadFile, File
from typing import Optional
from app.services.case_service import case_service
from app.services.multimodal_service import multimodal_service
from app.models.schemas.case import (
    CaseCreate, CaseUpdate, Case,
    TextUploadRequest, TextUploadResponse,
    ImageUploadResponse, AudioUploadResponse
)

router = APIRouter(prefix="/cases", tags=["案件管理"])


@router.post("", response_model=Case, summary="创建新案件")
async def create_case(data: CaseCreate):
    result = case_service.create_case(data.title, data.description, data.case_type.value)
    return result


@router.get("", summary="获取案件列表")
async def list_cases(page: int = 1, page_size: int = 20, case_type: Optional[str] = None):
    return case_service.list_cases(page, page_size, case_type)


@router.get("/{case_id}", summary="获取案件详情")
async def get_case(case_id: str):
    case = case_service.get_case(case_id)
    if not case:
        raise HTTPException(status_code=404, detail="案件不存在")
    return case


@router.put("/{case_id}", summary="更新案件")
async def update_case(case_id: str, data: CaseUpdate):
    updates = data.model_dump(exclude_none=True)
    result = case_service.update_case(case_id, updates)
    if not result:
        raise HTTPException(status_code=404, detail="案件不存在")
    return result


@router.delete("/{case_id}", summary="删除案件")
async def delete_case(case_id: str):
    if not case_service.delete_case(case_id):
        raise HTTPException(status_code=404, detail="案件不存在")
    return {"message": "案件已删除"}


@router.post("/{case_id}/upload-text", response_model=TextUploadResponse, summary="上传案件文本")
async def upload_text(case_id: str, data: TextUploadRequest):
    case = case_service.get_case(case_id)
    if not case:
        raise HTTPException(status_code=404, detail="案件不存在")
    result = await multimodal_service.process_text(case_id, data.content)
    return result


@router.post("/{case_id}/upload-image", response_model=ImageUploadResponse, summary="上传证据图片")
async def upload_image(case_id: str, file: UploadFile = File(...)):
    case = case_service.get_case(case_id)
    if not case:
        raise HTTPException(status_code=404, detail="案件不存在")
    result = await multimodal_service.process_image(case_id, file)
    return result


@router.post("/{case_id}/upload-audio", response_model=AudioUploadResponse, summary="上传庭审录音")
async def upload_audio(case_id: str, file: UploadFile = File(...)):
    case = case_service.get_case(case_id)
    if not case:
        raise HTTPException(status_code=404, detail="案件不存在")
    result = await multimodal_service.process_audio(case_id, file)
    return result
