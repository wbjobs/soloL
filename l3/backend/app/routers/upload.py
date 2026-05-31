from fastapi import APIRouter, UploadFile, File, Form, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import Optional
import os
import aiofiles
import uuid
from ..database import get_db
from ..models import UploadFile as UploadFileModel
from ..config import settings
from ..schemas import ChunkUploadResponse, FileInfoResponse
from ..utils.fasta_parser import parse_fasta, validate_fasta_content

router = APIRouter()


@router.post("/chunk", response_model=ChunkUploadResponse)
async def upload_chunk(
    file: UploadFile = File(...),
    file_id: str = Form(...),
    chunk_index: int = Form(...),
    total_chunks: int = Form(...),
    filename: str = Form(...),
    file_size: int = Form(...),
    db: Session = Depends(get_db)
):
    if file_size > settings.MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"文件大小超过限制，最大允许 {settings.MAX_FILE_SIZE // (1024*1024)} MB"
        )

    chunk_dir = os.path.join(settings.UPLOAD_DIR, file_id)
    os.makedirs(chunk_dir, exist_ok=True)

    chunk_data = await file.read()

    if chunk_index == 0 and not validate_fasta_content(chunk_data[:4096]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="文件格式不正确，请上传有效的FASTA格式文件"
        )

    chunk_path = os.path.join(chunk_dir, f"chunk_{chunk_index}")
    async with aiofiles.open(chunk_path, "wb") as f:
        await f.write(chunk_data)

    upload_record = db.query(UploadFileModel).filter(UploadFileModel.file_id == file_id).first()

    if not upload_record:
        upload_record = UploadFileModel(
            file_id=file_id,
            filename=filename,
            file_size=file_size,
            total_chunks=total_chunks,
            uploaded_chunks=1,
            status="uploading"
        )
        db.add(upload_record)
    else:
        if upload_record.uploaded_chunks < total_chunks:
            upload_record.uploaded_chunks += 1

    db.commit()
    db.refresh(upload_record)

    completed = upload_record.uploaded_chunks >= upload_record.total_chunks

    if completed:
        merged_file_path = os.path.join(settings.UPLOAD_DIR, f"{file_id}.fasta")

        upload_record.status = "merging"
        db.commit()

        merge_chunk_size = 10 * 1024 * 1024
        total_written = 0

        async with aiofiles.open(merged_file_path, "wb") as merged_file:
            for i in range(total_chunks):
                chunk_path = os.path.join(chunk_dir, f"chunk_{i}")
                async with aiofiles.open(chunk_path, "rb") as chunk_file:
                    while True:
                        data = await chunk_file.read(merge_chunk_size)
                        if not data:
                            break
                        await merged_file.write(data)
                        total_written += len(data)

                await merged_file.flush()
                os.fsync(merged_file.fileno())

                merge_progress = ((i + 1) / total_chunks) * 100
                upload_record.uploaded_chunks = min(total_chunks, i + 1)
                db.commit()

            await merged_file.flush()
            os.fsync(merged_file.fileno())

        seq_name, seq_desc, seq_length = parse_fasta(merged_file_path)

        if seq_length == 0:
            upload_record.status = "failed"
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="无法解析FASTA文件，请检查文件格式"
            )

        upload_record.file_path = merged_file_path
        upload_record.status = "completed"
        upload_record.sequence_name = seq_name or filename
        upload_record.sequence_length = seq_length
        db.commit()

        for i in range(total_chunks):
            chunk_path = os.path.join(chunk_dir, f"chunk_{i}")
            try:
                os.remove(chunk_path)
            except OSError:
                pass
        try:
            os.rmdir(chunk_dir)
        except OSError:
            pass

    return ChunkUploadResponse(
        success=True,
        file_id=file_id,
        chunk_index=chunk_index,
        uploaded_chunks=upload_record.uploaded_chunks,
        total_chunks=total_chunks,
        completed=completed
    )


@router.get("/check/{file_id}")
async def check_upload_status(file_id: str, db: Session = Depends(get_db)):
    upload_record = db.query(UploadFileModel).filter(UploadFileModel.file_id == file_id).first()
    if not upload_record:
        return {"exists": False, "uploaded_chunks": 0, "total_chunks": 0, "completed": False}

    return {
        "exists": True,
        "uploaded_chunks": upload_record.uploaded_chunks,
        "total_chunks": upload_record.total_chunks,
        "completed": upload_record.status == "completed",
        "status": upload_record.status
    }


@router.get("/{file_id}", response_model=FileInfoResponse)
async def get_file_info(file_id: str, db: Session = Depends(get_db)):
    upload_record = db.query(UploadFileModel).filter(UploadFileModel.file_id == file_id).first()
    if not upload_record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="文件不存在"
        )
    return FileInfoResponse(
        file_id=upload_record.file_id,
        filename=upload_record.filename,
        file_size=upload_record.file_size,
        status=upload_record.status,
        sequence_name=upload_record.sequence_name,
        sequence_length=upload_record.sequence_length,
        created_at=upload_record.created_at
    )


@router.get("/", response_model=list[FileInfoResponse])
async def list_files(skip: int = 0, limit: int = 20, db: Session = Depends(get_db)):
    files = db.query(UploadFileModel).filter(
        UploadFileModel.status == "completed"
    ).order_by(UploadFileModel.created_at.desc()).offset(skip).limit(limit).all()
    return [
        FileInfoResponse(
            file_id=f.file_id,
            filename=f.filename,
            file_size=f.file_size,
            status=f.status,
            sequence_name=f.sequence_name,
            sequence_length=f.sequence_length,
            created_at=f.created_at
        ) for f in files
    ]
