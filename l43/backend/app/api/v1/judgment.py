from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import PlainTextResponse
from typing import Optional
from app.services.judgment_service import judgment_generator_service
from pydantic import BaseModel
from typing import Dict, Any

router = APIRouter(prefix="/judgment", tags=["判决书生成"])


class JudgmentRequest(BaseModel):
    template_type: str = "auto"
    custom_data: Optional[Dict[str, Any]] = None


@router.get("/preview/{case_id}", summary="获取判决书生成预览")
async def get_judgment_preview(case_id: str):
    result = await judgment_generator_service.generate_judgment_preview(case_id)
    if not result.get("success"):
        raise HTTPException(status_code=404, detail=result.get("error", "案件不存在"))
    return result


@router.post("/generate/{case_id}", summary="生成判决书")
async def generate_judgment(case_id: str, request: JudgmentRequest):
    result = await judgment_generator_service.generate_judgment(
        case_id=case_id,
        template_type=request.template_type,
        custom_data=request.custom_data
    )
    if not result.get("success"):
        raise HTTPException(status_code=404, detail=result.get("error", "案件不存在"))
    return result


@router.post("/generate/{case_id}/download", summary="下载判决书文本")
async def download_judgment(case_id: str, request: JudgmentRequest):
    result = await judgment_generator_service.generate_judgment(
        case_id=case_id,
        template_type=request.template_type,
        custom_data=request.custom_data
    )
    if not result.get("success"):
        raise HTTPException(status_code=404, detail=result.get("error", "案件不存在"))

    judgment_text = result.get("judgment_text", "")
    filename = f"判决书_{case_id}.txt"

    return PlainTextResponse(
        content=judgment_text,
        headers={
            "Content-Disposition": f"attachment; filename={filename}",
            "Content-Type": "text/plain; charset=utf-8"
        }
    )


@router.get("/templates", summary="获取可用模板列表")
async def get_available_templates():
    return {
        "templates": [
            {"id": "criminal", "name": "刑事判决书模板", "description": "适用于刑事案件的完整判决书格式"},
            {"id": "civil", "name": "民事判决书模板", "description": "适用于民事案件的完整判决书格式"},
            {"id": "simple", "name": "简易判决书模板", "description": "适用于简单案件的简化格式"}
        ]
    }
