from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import Dict, Any
import io
import uuid

from ..database import get_db
from ..models import AlignmentTask, AlignmentResult, UploadFile
from ..schemas import (
    RegionAlignmentRequest,
    RegionAlignmentResponse,
    ExportRequest,
    HilbertRegionSelection
)
from ..algorithms import SmithWaterman, generate_hilbert_3d_data
from ..utils.fasta_parser import read_sequence
from ..utils.export_formats import (
    export_to_csv,
    export_to_phylip,
    export_difference_sites_to_bed
)

router = APIRouter()


@router.post("/region-align", response_model=RegionAlignmentResponse)
async def region_alignment(
    request: RegionAlignmentRequest,
    db: Session = Depends(get_db)
):
    task = db.query(AlignmentTask).filter(
        AlignmentTask.task_id == request.task_id
    ).first()

    if not task:
        raise HTTPException(
            status_code=404,
            detail="任务不存在"
        )

    if task.status != "completed":
        raise HTTPException(
            status_code=400,
            detail="任务未完成，无法进行区域比对"
        )

    file1 = db.query(UploadFile).filter(
        UploadFile.file_id == task.file1_id
    ).first()
    file2 = db.query(UploadFile).filter(
        UploadFile.file_id == task.file2_id
    ).first()

    if not file1 or not file2:
        raise HTTPException(
            status_code=404,
            detail="文件不存在"
        )

    seq1 = read_sequence(file1.file_path)
    seq2 = read_sequence(file2.file_path)

    if not seq1 or not seq2:
        raise HTTPException(
            status_code=400,
            detail="无法读取序列文件"
        )

    if request.start_pos1 >= len(seq1) or request.end_pos1 > len(seq1):
        raise HTTPException(
            status_code=400,
            detail="序列1区域超出范围"
        )
    if request.start_pos2 >= len(seq2) or request.end_pos2 > len(seq2):
        raise HTTPException(
            status_code=400,
            detail="序列2区域超出范围"
        )

    sub_seq1 = seq1[request.start_pos1:request.end_pos1]
    sub_seq2 = seq2[request.start_pos2:request.end_pos2]

    sw = SmithWaterman(
        match_score=request.match_score,
        mismatch_penalty=request.mismatch_penalty,
        gap_penalty=request.gap_penalty
    )

    result = sw.align(sub_seq1, sub_seq2)

    hilbert_data = generate_hilbert_3d_data(
        result.aligned_seq1,
        result.aligned_seq2,
        window_size=30,
        step_size=5
    )

    region_id = f"region_{uuid.uuid4().hex[:12]}"

    return RegionAlignmentResponse(
        success=True,
        task_id=request.task_id,
        region_id=region_id,
        aligned_sequence1=result.aligned_seq1,
        aligned_sequence2=result.aligned_seq2,
        start_pos1=result.start_pos1 + request.start_pos1,
        end_pos1=result.end_pos1 + request.start_pos1,
        start_pos2=result.start_pos2 + request.start_pos2,
        end_pos2=result.end_pos2 + request.start_pos2,
        identity_percentage=result.identity_percentage,
        similarity_score=result.score,
        match_count=result.match_count,
        mismatch_count=result.mismatch_count,
        gap_count=result.gap_count,
        difference_sites=result.difference_sites,
        hilbert_data=hilbert_data
    )


@router.post("/hilbert-to-position")
async def hilbert_to_sequence_position(
    request: HilbertRegionSelection,
    db: Session = Depends(get_db)
):
    task = db.query(AlignmentTask).filter(
        AlignmentTask.task_id == request.task_id
    ).first()

    if not task:
        raise HTTPException(
            status_code=404,
            detail="任务不存在"
        )

    alignment_result = db.query(AlignmentResult).filter(
        AlignmentResult.task_id == request.task_id
    ).first()

    if not alignment_result:
        raise HTTPException(
            status_code=404,
            detail="比对结果不存在"
        )

    alignment_length = len(alignment_result.aligned_sequence1)

    start_position = max(0, min(request.start_position, alignment_length - 1))
    end_position = max(start_position + 1, min(request.end_position, alignment_length))

    file1 = db.query(UploadFile).filter(
        UploadFile.file_id == task.file1_id
    ).first()
    file2 = db.query(UploadFile).filter(
        UploadFile.file_id == task.file2_id
    ).first()

    seq1 = read_sequence(file1.file_path)
    seq2 = read_sequence(file2.file_path)

    return {
        "task_id": request.task_id,
        "selected_region": {
            "start": start_position,
            "end": end_position,
            "length": end_position - start_position,
            "sequence1": seq1[start_position:end_position],
            "sequence2": seq2[start_position:end_position],
            "hilbert_indices": request.hilbert_indices,
            "selection_center": {
                "x": request.center_x,
                "y": request.center_y,
                "z": request.center_z,
                "radius": request.radius
            }
        }
    }


@router.post("/export")
async def export_alignment(
    request: ExportRequest,
    db: Session = Depends(get_db)
):
    task = db.query(AlignmentTask).filter(
        AlignmentTask.task_id == request.task_id
    ).first()

    if not task:
        raise HTTPException(
            status_code=404,
            detail="任务不存在"
        )

    if task.status != "completed":
        raise HTTPException(
            status_code=400,
            detail="任务未完成，无法导出"
        )

    alignment_result = db.query(AlignmentResult).filter(
        AlignmentResult.task_id == request.task_id
    ).first()

    if not alignment_result:
        raise HTTPException(
            status_code=404,
            detail="比对结果不存在"
        )

    file1 = db.query(UploadFile).filter(
        UploadFile.file_id == task.file1_id
    ).first()
    file2 = db.query(UploadFile).filter(
        UploadFile.file_id == task.file2_id
    ).first()

    metadata = {}
    if request.include_metadata:
        metadata = {
            "task_id": request.task_id,
            "file1": file1.filename if file1 else "Unknown",
            "file2": file2.filename if file2 else "Unknown",
            "similarity_score": task.similarity_score,
            "identity_percentage": task.identity_percentage,
            "alignment_length": task.alignment_length,
            "match_count": task.match_count,
            "mismatch_count": task.mismatch_count,
            "gap_count": task.gap_count,
            "export_format": request.format
        }

    seq1_name = request.seq1_name or (file1.sequence_name if file1 else "Sequence1")
    seq2_name = request.seq2_name or (file2.sequence_name if file2 else "Sequence2")

    if request.format == "csv":
        content = export_to_csv(
            alignment_result.aligned_sequence1,
            alignment_result.aligned_sequence2,
            alignment_result.difference_sites,
            metadata
        )
        media_type = "text/csv"
        filename = f"alignment_{request.task_id}.csv"
    elif request.format == "phylip":
        content = export_to_phylip(
            alignment_result.aligned_sequence1,
            alignment_result.aligned_sequence2,
            seq1_name=seq1_name,
            seq2_name=seq2_name,
            metadata=metadata
        )
        media_type = "text/plain"
        filename = f"alignment_{request.task_id}.phy"
    elif request.format == "bed":
        content = export_difference_sites_to_bed(
            alignment_result.difference_sites,
            seq_name=seq1_name
        )
        media_type = "text/plain"
        filename = f"alignment_{request.task_id}.bed"
    else:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的导出格式: {request.format}"
        )

    return StreamingResponse(
        io.StringIO(content),
        media_type=media_type,
        headers={
            "Content-Disposition": f"attachment; filename={filename}"
        }
    )
