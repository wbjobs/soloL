from fastapi import APIRouter, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse
from typing import Dict
from ..config import settings
from ..services.matrix_parser import matrix_parser
from ..db.models import MatrixInfo

router = APIRouter(prefix="/api/v1", tags=["upload"])


@router.post("/upload", response_model=Dict)
async def upload_matrix(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    if not file.filename.endswith(".mtx"):
        raise HTTPException(
            status_code=400,
            detail="Only Matrix Market format (.mtx) files are supported"
        )

    content = await file.read()

    if len(content) > settings.max_upload_size:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size is {settings.max_upload_size // 1024 // 1024}MB"
        )

    try:
        matrix_info = matrix_parser.process_upload(content, file.filename)

        return {
            "matrixId": matrix_info.matrix_id,
            "filename": matrix_info.filename,
            "shape": list(matrix_info.shape),
            "nnz": matrix_info.nnz,
            "sparsity": matrix_info.sparsity,
            "conditionNumber": matrix_info.condition_number,
            "uploadedAt": matrix_info.uploaded_at.isoformat(),
        }

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error processing matrix: {str(e)}"
        )


@router.get("/matrix/{matrix_id}")
async def get_matrix_info(matrix_id: str):
    matrix_info = matrix_parser.get_matrix_info(matrix_id)
    if not matrix_info:
        raise HTTPException(status_code=404, detail="Matrix not found")

    return {
        "matrixId": matrix_info.matrix_id,
        "filename": matrix_info.filename,
        "shape": list(matrix_info.shape),
        "nnz": matrix_info.nnz,
        "sparsity": matrix_info.sparsity,
        "conditionNumber": matrix_info.condition_number,
        "uploadedAt": matrix_info.uploaded_at.isoformat(),
    }
