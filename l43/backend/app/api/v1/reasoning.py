from fastapi import APIRouter, HTTPException
from app.services.reasoning_service import reasoning_service
from app.services.case_service import case_service
from app.models.schemas.reasoning import CounterfactualRequest, ReasoningResult

router = APIRouter(prefix="/reasoning", tags=["反事实推理"])


@router.post("/counterfactual", response_model=ReasoningResult, summary="执行反事实推理")
async def counterfactual_reasoning(request: CounterfactualRequest):
    case = case_service.get_case(request.case_id)
    if not case:
        raise HTTPException(status_code=404, detail="案件不存在")

    modified_elements = [
        {"element_id": m.element_id, "new_value": m.new_value}
        for m in request.modified_elements
    ]

    result = await reasoning_service.counterfactual_reasoning(
        case_id=request.case_id,
        modified_elements=modified_elements,
        reasoning_depth=request.reasoning_depth
    )

    if not result.get("success"):
        raise HTTPException(status_code=500, detail="推理执行失败")

    return result


@router.get("/preview/{case_id}", summary="获取案件要素预览")
async def preview_case_elements(case_id: str):
    case = case_service.get_case(case_id)
    if not case:
        raise HTTPException(status_code=404, detail="案件不存在")

    elements = case.get("elements", [])
    editable_elements = [e for e in elements if e.get("editable", True)]

    return {
        "case_id": case_id,
        "title": case.get("title", ""),
        "elements": editable_elements,
        "total_elements": len(elements),
        "editable_elements": len(editable_elements)
    }
