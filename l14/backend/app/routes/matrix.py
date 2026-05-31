from fastapi import APIRouter, HTTPException
from typing import Dict, Any
from ..db.redis import redis_client
from ..services.matrix_parser import matrix_parser
from ..storage.file_manager import file_manager
from ..utils.matrix_utils import generate_heatmap_data, compute_matrix_stats

router = APIRouter(prefix="/api/v1", tags=["matrix"])


@router.get("/matrix/{matrix_id}/stats")
async def get_matrix_stats(matrix_id: str):
    matrix_info = matrix_parser.get_matrix_info(matrix_id)
    if not matrix_info:
        raise HTTPException(status_code=404, detail="Matrix not found")

    stats = redis_client.get_matrix_stats(matrix_id)

    if stats is None:
        A = matrix_parser.load_matrix(matrix_id)
        if A is None:
            raise HTTPException(status_code=404, detail="Matrix data not found")

        stats = compute_matrix_stats(A)
        stats["matrix_id"] = matrix_id
        redis_client.save_matrix_stats(matrix_id, stats)

    return {
        "matrixId": matrix_id,
        "shape": stats.get("shape", list(matrix_info.shape)),
        "nnz": stats.get("nnz", matrix_info.nnz),
        "sparsity": stats.get("sparsity", matrix_info.sparsity),
        "conditionNumber": matrix_info.condition_number,
        "rowNonzeroStats": stats.get("row_nonzero_stats", {}),
        "colNonzeroStats": stats.get("col_nonzero_stats", {}),
        "valueStats": stats.get("value_stats", {}),
    }


@router.get("/matrix/{matrix_id}/heatmap")
async def get_matrix_heatmap(matrix_id: str, bins: int = 100, max_points: int = 10000):
    matrix_info = matrix_parser.get_matrix_info(matrix_id)
    if not matrix_info:
        raise HTTPException(status_code=404, detail="Matrix not found")

    heatmap_data = redis_client.get_heatmap_data(matrix_id)

    if heatmap_data is None:
        A = matrix_parser.load_matrix(matrix_id)
        if A is None:
            raise HTTPException(status_code=404, detail="Matrix data not found")

        heatmap_data = generate_heatmap_data(A, num_bins=bins, max_points=max_points)
        heatmap_data["matrix_id"] = matrix_id
        redis_client.save_heatmap_data(matrix_id, heatmap_data)

    return {
        "matrixId": matrix_id,
        "rows": matrix_info.shape[0],
        "cols": matrix_info.shape[1],
        "numBins": heatmap_data.get("num_bins", bins),
        "bins": heatmap_data.get("bins", []),
        "samplePoints": heatmap_data.get("sample_points", []),
    }
