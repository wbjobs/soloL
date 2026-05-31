from typing import Any
import zipfile
import tempfile
import json
from pathlib import Path
import numpy as np
from flask import current_app

from app.models import PointCloud
from app.ml.preprocess import load_ply, export_to_semantic_kitti
from app.services.point_cloud_service import PointCloudService


class ExportService:
    @staticmethod
    def export_point_cloud(
        point_cloud: PointCloud,
        format: str = "semantickitti",
    ) -> Path:
        config = current_app.config
        export_folder = Path(config["EXPORT_FOLDER"])
        export_folder.mkdir(parents=True, exist_ok=True)

        ply_data = load_ply(point_cloud.file_path)
        points = ply_data["points"]
        colors = ply_data["colors"]

        total_points = point_cloud.total_points
        labels = PointCloudService.get_labels_for_points(
            point_cloud.id, 0, total_points - 1
        )

        if format == "semantickitti":
            return ExportService._export_semantic_kitti(
                point_cloud, points, labels, export_folder
            )
        elif format == "ply":
            return ExportService._export_ply_with_labels(
                point_cloud, points, colors, labels, export_folder
            )
        elif format == "labels":
            return ExportService._export_labels_only(
                point_cloud, labels, export_folder
            )
        else:
            raise ValueError(f"Unsupported export format: {format}")

    @staticmethod
    def _export_semantic_kitti(
        point_cloud: PointCloud,
        points: np.ndarray,
        labels: np.ndarray,
        export_folder: Path,
    ) -> Path:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)

            sequence_id = "00"
            scan_id = 0

            export_to_semantic_kitti(
                points=points,
                labels=labels,
                output_dir=tmp_path,
                sequence_id=sequence_id,
                scan_id=scan_id,
            )

            config_file = tmp_path / "sequences" / sequence_id / "config.json"
            config_data = {
                "labels": ExportService._get_label_mapping(),
                "point_cloud_id": str(point_cloud.id),
                "name": point_cloud.name,
                "total_points": len(points),
            }
            config_file.write_text(json.dumps(config_data, indent=2))

            zip_path = export_folder / f"{point_cloud.name}_semantickitti.zip"

            with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                for file_path in tmp_path.rglob("*"):
                    if file_path.is_file():
                        arcname = file_path.relative_to(tmp_path)
                        zf.write(file_path, arcname)

            return zip_path

    @staticmethod
    def _export_ply_with_labels(
        point_cloud: PointCloud,
        points: np.ndarray,
        colors: np.ndarray | None,
        labels: np.ndarray,
        export_folder: Path,
    ) -> Path:
        from app.ml.preprocess import save_ply

        ply_path = export_folder / f"{point_cloud.name}_labeled.ply"

        save_ply(
            file_path=ply_path,
            points=points,
            colors=colors,
            labels=labels,
        )

        zip_path = export_folder / f"{point_cloud.name}_ply.zip"
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.write(ply_path, ply_path.name)

        return zip_path

    @staticmethod
    def _export_labels_only(
        point_cloud: PointCloud,
        labels: np.ndarray,
        export_folder: Path,
    ) -> Path:
        label_file = export_folder / f"{point_cloud.name}_labels.label"
        labels.astype(np.uint32).tofile(label_file)

        json_file = export_folder / f"{point_cloud.name}_labels.json"
        json_data = {
            "label_mapping": ExportService._get_label_mapping(),
            "statistics": ExportService._get_label_statistics(labels),
        }
        json_file.write_text(json.dumps(json_data, indent=2))

        zip_path = export_folder / f"{point_cloud.name}_labels.zip"
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.write(label_file, label_file.name)
            zf.write(json_file, json_file.name)

        return zip_path

    @staticmethod
    def _get_label_mapping() -> dict[str, Any]:
        return {
            "0": {"name": "未标注", "color": "#808080"},
            "1": {"name": "车辆", "color": "#FF0000"},
            "2": {"name": "行人", "color": "#00FF00"},
            "3": {"name": "建筑", "color": "#0000FF"},
            "4": {"name": "植被", "color": "#00FF7F"},
            "5": {"name": "道路", "color": "#FFFF00"},
            "6": {"name": "人行道", "color": "#FFA500"},
            "7": {"name": "围栏", "color": "#FF00FF"},
            "8": {"name": "杆状物", "color": "#00FFFF"},
            "9": {"name": "交通标志", "color": "#FFC0CB"},
        }

    @staticmethod
    def _get_label_statistics(labels: np.ndarray) -> dict[str, int]:
        unique, counts = np.unique(labels, return_counts=True)
        return {str(int(k)): int(v) for k, v in zip(unique, counts)}
