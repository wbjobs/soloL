import os
import uuid
import aiofiles
from fastapi import UploadFile
from app.config.settings import settings
from app.utils.logger import setup_logger

logger = setup_logger()


class FileRepository:
    def __init__(self):
        self.upload_dir = settings.UPLOAD_DIR
        os.makedirs(self.upload_dir, exist_ok=True)

    async def save_upload(self, file: UploadFile, subdir: str = "") -> str:
        save_dir = os.path.join(self.upload_dir, subdir)
        os.makedirs(save_dir, exist_ok=True)

        ext = os.path.splitext(file.filename or "file")[1]
        filename = f"{uuid.uuid4().hex}{ext}"
        filepath = os.path.join(save_dir, filename)

        async with aiofiles.open(filepath, "wb") as f:
            content = await file.read()
            await f.write(content)

        return filepath

    async def read_file(self, filepath: str) -> bytes:
        async with aiofiles.open(filepath, "rb") as f:
            return await f.read()

    def delete_file(self, filepath: str) -> bool:
        if os.path.exists(filepath):
            os.remove(filepath)
            return True
        return False

    def get_file_url(self, filepath: str) -> str:
        rel_path = os.path.relpath(filepath, self.upload_dir)
        return f"/files/{rel_path.replace(os.sep, '/')}"


file_repository = FileRepository()
