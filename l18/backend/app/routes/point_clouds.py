from flask import Blueprint, request, jsonify, send_file, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
import uuid
import os
from pathlib import Path
import numpy as np
import io

from app.extensions import db
from app.models import PointCloud, Project, LabelChunk, AnnotationHistory, LabelDefinition
from app.services.point_cloud_service import PointCloudService
from app.services.export_service import ExportService
from app.ml.preprocess import load_ply, generate_lod_levels

point_clouds_bp = Blueprint("point_clouds", __name__)


@point_clouds_bp.route("/upload", methods=["POST"])
@jwt_required()
def upload_point_cloud():
    user_id = get_jwt_identity()

    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    project_id = request.form.get("projectId") or request.form.get("project_id")
    name = request.form.get("name", file.filename)

    if not project_id:
        return jsonify({"error": "Project ID is required"}), 400

    project = Project.query.get(project_id)
    if not project:
        return jsonify({"error": "Project not found"}), 404

    if str(project.user_id) != user_id:
        return jsonify({"error": "Unauthorized"}), 403

    if file.filename == "":
        return jsonify({"error": "No file selected"}), 400

    if not file.filename.lower().endswith(".ply"):
        return jsonify({"error": "Only PLY files are allowed"}), 400

    config = current_app.config
    upload_folder = Path(config["UPLOAD_FOLDER"])
    upload_folder.mkdir(parents=True, exist_ok=True)

    filename = f"{uuid.uuid4()}_{file.filename}"
    file_path = upload_folder / filename
    file.save(file_path)

    try:
        ply_data = load_ply(file_path)
    except Exception as e:
        try:
            file_path.unlink(missing_ok=True)
        except:
            pass
        return jsonify({"error": f"Invalid PLY file: {str(e)}"}), 400

    total_points = ply_data["num_points"]
    bounds = ply_data["bounds"]

    if total_points > 5000000:
        del ply_data
        try:
            file_path.unlink(missing_ok=True)
        except:
            pass
        return jsonify({"error": "Point cloud exceeds maximum size of 5 million points"}), 400

    point_cloud = PointCloud(
        name=name,
        filename=file.filename,
        project_id=project_id,
        total_points=total_points,
        bounds=bounds,
        file_path=str(file_path),
        lod_levels=3,
    )
    db.session.add(point_cloud)
    db.session.commit()

    try:
        lod_dir = upload_folder / "lod" / str(point_cloud.id)
        lod_dir.mkdir(parents=True, exist_ok=True)

        lod_levels = generate_lod_levels(
            ply_data["points"],
            ply_data["colors"],
            num_levels=3,
        )

        for lod in lod_levels:
            lod_file = lod_dir / f"level_{lod['level']}.npz"
            np.savez(
                lod_file,
                points=lod["points"],
                colors=lod["colors"] if lod["colors"] is not None else np.array([]),
                num_points=lod["num_points"],
            )

    except Exception as e:
        db.session.delete(point_cloud)
        db.session.commit()
        file_path.unlink(missing_ok=True)
        return jsonify({"error": f"Failed to generate LOD levels: {str(e)}"}), 500

    return jsonify(point_cloud.to_dict()), 201


@point_clouds_bp.route("/<point_cloud_id>", methods=["GET"])
@jwt_required()
def get_point_cloud(point_cloud_id: str):
    user_id = get_jwt_identity()
    point_cloud = PointCloud.query.get(point_cloud_id)

    if not point_cloud:
        return jsonify({"error": "Point cloud not found"}), 404

    if str(point_cloud.project.user_id) != user_id:
        return jsonify({"error": "Unauthorized"}), 403

    return jsonify(point_cloud.to_dict())


@point_clouds_bp.route("/<point_cloud_id>/lod/<int:level>", methods=["GET"])
@jwt_required()
def get_lod_level(point_cloud_id: str, level: int):
    user_id = get_jwt_identity()
    point_cloud = PointCloud.query.get(point_cloud_id)

    if not point_cloud:
        return jsonify({"error": "Point cloud not found"}), 404

    if str(point_cloud.project.user_id) != user_id:
        return jsonify({"error": "Unauthorized"}), 403

    if level < 0 or level >= point_cloud.lod_levels:
        return jsonify({"error": f"Invalid LOD level. Must be between 0 and {point_cloud.lod_levels - 1}"}), 400

    config = current_app.config
    upload_folder = Path(config["UPLOAD_FOLDER"])
    lod_file = upload_folder / "lod" / str(point_cloud.id) / f"level_{level}.npz"

    if not lod_file.exists():
        return jsonify({"error": "LOD level not found"}), 404

    lod_data = np.load(lod_file)
    points = lod_data["points"]
    colors = lod_data["colors"] if lod_data["colors"].size > 0 else None

    labels = PointCloudService.get_labels_for_points(
        point_cloud.id,
        0,
        len(points) - 1,
    )

    response_data = {
        "points": points.flatten().tolist(),
        "colors": colors.flatten().tolist() if colors is not None else None,
        "labels": labels.tolist() if labels is not None else None,
        "num_points": len(points),
        "lodLevel": level,
    }

    return jsonify(response_data)


@point_clouds_bp.route("/<point_cloud_id>/labels", methods=["GET"])
@jwt_required()
def get_labels(point_cloud_id: str):
    user_id = get_jwt_identity()
    point_cloud = PointCloud.query.get(point_cloud_id)

    if not point_cloud:
        return jsonify({"error": "Point cloud not found"}), 404

    if str(point_cloud.project.user_id) != user_id:
        return jsonify({"error": "Unauthorized"}), 403

    start_index = request.args.get("start", 0, type=int)
    end_index = request.args.get("end", point_cloud.total_points - 1, type=int)

    labels = PointCloudService.get_labels_for_points(
        point_cloud_id,
        start_index,
        end_index,
    )

    return jsonify({
        "labels": labels.tolist(),
        "start_index": start_index,
        "end_index": end_index,
    })


@point_clouds_bp.route("/<point_cloud_id>/labels", methods=["PUT"])
@jwt_required()
def update_labels(point_cloud_id: str):
    user_id = get_jwt_identity()
    point_cloud = PointCloud.query.get(point_cloud_id)

    if not point_cloud:
        return jsonify({"error": "Point cloud not found"}), 404

    if str(point_cloud.project.user_id) != user_id:
        return jsonify({"error": "Unauthorized"}), 403

    data = request.get_json()
    updates = data.get("updates", [])

    if not updates:
        return jsonify({"error": "No updates provided"}), 400

    label_changes = PointCloudService.update_labels(
        point_cloud_id,
        updates,
    )

    history = AnnotationHistory(
        point_cloud_id=point_cloud_id,
        action="update_labels",
        label_changes=label_changes,
    )
    db.session.add(history)
    db.session.commit()

    return jsonify({
        "message": "Labels updated successfully",
        "changes_count": len(label_changes),
        "history_id": str(history.id),
    })


@point_clouds_bp.route("/<point_cloud_id>/export", methods=["GET"])
@jwt_required()
def export_point_cloud(point_cloud_id: str):
    user_id = get_jwt_identity()
    point_cloud = PointCloud.query.get(point_cloud_id)

    if not point_cloud:
        return jsonify({"error": "Point cloud not found"}), 404

    if str(point_cloud.project.user_id) != user_id:
        return jsonify({"error": "Unauthorized"}), 403

    format = request.args.get("format", "semantickitti")

    try:
        export_path = ExportService.export_point_cloud(
            point_cloud,
            format=format,
        )

        return send_file(
            export_path,
            as_attachment=True,
            download_name=f"{point_cloud.name}_{format}.zip",
        )
    except Exception as e:
        return jsonify({"error": f"Export failed: {str(e)}"}), 500


@point_clouds_bp.route("/<point_cloud_id>/history", methods=["GET"])
@jwt_required()
def get_history(point_cloud_id: str):
    user_id = get_jwt_identity()
    point_cloud = PointCloud.query.get(point_cloud_id)

    if not point_cloud:
        return jsonify({"error": "Point cloud not found"}), 404

    if str(point_cloud.project.user_id) != user_id:
        return jsonify({"error": "Unauthorized"}), 403

    limit = request.args.get("limit", 100, type=int)
    history = AnnotationHistory.query.filter_by(
        point_cloud_id=point_cloud_id
    ).order_by(AnnotationHistory.created_at.desc()).limit(limit).all()

    return jsonify([h.to_dict() for h in history])


@point_clouds_bp.route("/<point_cloud_id>/history/<history_id>/undo", methods=["POST"])
@jwt_required()
def undo_history(point_cloud_id: str, history_id: str):
    user_id = get_jwt_identity()
    point_cloud = PointCloud.query.get(point_cloud_id)

    if not point_cloud:
        return jsonify({"error": "Point cloud not found"}), 404

    if str(point_cloud.project.user_id) != user_id:
        return jsonify({"error": "Unauthorized"}), 403

    history = AnnotationHistory.query.get(history_id)
    if not history:
        return jsonify({"error": "History entry not found"}), 404

    label_changes = history.label_changes
    undo_changes = []

    for change in label_changes:
        point_index = change["pointIndex"]
        old_label = change["oldLabel"]
        new_label = change["newLabel"]

        PointCloudService.update_labels(
            point_cloud_id,
            [{"pointIndices": [point_index], "labelId": old_label}],
        )

        undo_changes.append({
            "pointIndex": point_index,
            "oldLabel": new_label,
            "newLabel": old_label,
        })

    new_history = AnnotationHistory(
        point_cloud_id=point_cloud_id,
        action="undo",
        label_changes=undo_changes,
    )
    db.session.add(new_history)
    db.session.commit()

    return jsonify({
        "message": "Undo successful",
        "changes_count": len(undo_changes),
    })


@point_clouds_bp.route("/label-definitions", methods=["GET"])
@jwt_required()
def get_label_definitions():
    labels = LabelDefinition.query.order_by(LabelDefinition.id).all()
    return jsonify([l.to_dict() for l in labels])
