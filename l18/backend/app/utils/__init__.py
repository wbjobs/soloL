import logging
from typing import Any
from pathlib import Path

from flask import jsonify


def setup_logger(name: str, log_file: str | None = None, level: int = logging.INFO) -> logging.Logger:
    logger = logging.getLogger(name)
    logger.setLevel(level)

    formatter = logging.Formatter(
        "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    )

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)

    if log_file:
        file_handler = logging.FileHandler(log_file)
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)

    return logger


def success_response(data: Any = None, message: str = "Success", status_code: int = 200):
    response = {"success": True, "message": message}
    if data is not None:
        response["data"] = data
    return jsonify(response), status_code


def error_response(message: str, status_code: int = 400, details: Any = None):
    response = {"success": False, "error": message}
    if details is not None:
        response["details"] = details
    return jsonify(response), status_code


def get_file_extension(filename: str) -> str:
    return Path(filename).suffix.lower().lstrip(".")


def validate_file_extension(filename: str, allowed_extensions: set[str]) -> bool:
    ext = Path(filename).suffix.lower()
    return ext in allowed_extensions


def format_file_size(size_bytes: int) -> str:
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024**2:
        return f"{size_bytes / 1024:.2f} KB"
    elif size_bytes < 1024**3:
        return f"{size_bytes / (1024**2):.2f} MB"
    else:
        return f"{size_bytes / (1024**3):.2f} GB"


def safe_filename(filename: str) -> str:
    from werkzeug.utils import secure_filename
    return secure_filename(filename)
