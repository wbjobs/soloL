from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
import uuid
import numpy as np
from pathlib import Path

from app.extensions import db
from app.models import PointCloud
from app.services.inference_service import InferenceService
from app.ml.preprocess import load_ply

inference_bp = Blueprint("inference", __name__)


@inference_bp.route("/predict", methods=["POST"])
@jwt_required()
def predict():
    user_id = get_jwt_identity()
    data = request.get_json()

    point_cloud_id = data.get("pointCloudId")
    point_indices = data.get("pointIndices", [])
    batch_size = data.get("batchSize", current_app.config.get("INFERENCE_BATCH_SIZE", 1024))

    if not point_cloud_id:
        return jsonify({"error": "Point cloud ID is required"}), 400

    point_cloud = PointCloud.query.get(point_cloud_id)
    if not point_cloud:
        return jsonify({"error": "Point cloud not found"}), 404

    if str(point_cloud.project.user_id) != user_id:
        return jsonify({"error": "Unauthorized"}), 403

    try:
        ply_data = load_ply(point_cloud.file_path)
        points = ply_data["points"]
        colors = ply_data["colors"]

        if point_indices:
            point_indices_arr = np.array(point_indices, dtype=np.int64)
            valid_mask = (point_indices_arr >= 0) & (point_indices_arr < len(points))
            point_indices_arr = point_indices_arr[valid_mask]

            if len(point_indices_arr) == 0:
                return jsonify({"error": "No valid point indices provided"}), 400
        else:
            point_indices_arr = np.arange(len(points))

        result = InferenceService.predict(
            points=points,
            point_indices=point_indices_arr,
            features=colors,
            batch_size=batch_size,
        )

        predictions = []
        for i, idx in enumerate(point_indices_arr):
            predictions.append({
                "pointIndex": int(idx),
                "predictedLabel": int(result["predictions"][i]),
                "confidence": float(result["confidences"][i]),
            })

        return jsonify({
            "predictions": predictions,
            "processingTime": result["processing_time"],
            "totalPoints": len(point_indices_arr),
            "batchSize": batch_size,
        })

    except Exception as e:
        return jsonify({"error": f"Inference failed: {str(e)}"}), 500


@inference_bp.route("/predict-rect", methods=["POST"])
@jwt_required()
def predict_rect():
    user_id = get_jwt_identity()
    data = request.get_json()

    point_cloud_id = data.get("pointCloudId")
    bounds = data.get("bounds")
    batch_size = data.get("batchSize", current_app.config.get("INFERENCE_BATCH_SIZE", 1024))

    if not point_cloud_id or not bounds:
        return jsonify({"error": "Point cloud ID and bounds are required"}), 400

    point_cloud = PointCloud.query.get(point_cloud_id)
    if not point_cloud:
        return jsonify({"error": "Point cloud not found"}), 404

    if str(point_cloud.project.user_id) != user_id:
        return jsonify({"error": "Unauthorized"}), 403

    try:
        ply_data = load_ply(point_cloud.file_path)
        points = ply_data["points"]
        colors = ply_data["colors"]

        min_bounds = np.array(bounds["min"])
        max_bounds = np.array(bounds["max"])

        mask = np.all(points >= min_bounds, axis=1) & np.all(points <= max_bounds, axis=1)
        point_indices_arr = np.where(mask)[0]

        if len(point_indices_arr) == 0:
            return jsonify({
                "predictions": [],
                "processingTime": 0,
                "totalPoints": 0,
            })

        result = InferenceService.predict(
            points=points,
            point_indices=point_indices_arr,
            features=colors,
            batch_size=batch_size,
        )

        predictions = []
        for i, idx in enumerate(point_indices_arr):
            predictions.append({
                "pointIndex": int(idx),
                "predictedLabel": int(result["predictions"][i]),
                "confidence": float(result["confidences"][i]),
            })

        return jsonify({
            "predictions": predictions,
            "processingTime": result["processing_time"],
            "totalPoints": len(point_indices_arr),
            "batchSize": batch_size,
        })

    except Exception as e:
        return jsonify({"error": f"Inference failed: {str(e)}"}), 500


@inference_bp.route("/auto-segment", methods=["POST"])
@jwt_required()
def auto_segment():
    user_id = get_jwt_identity()
    data = request.get_json()

    point_cloud_id = data.get("pointCloudId")
    seed_point_index = data.get("seedPointIndex")
    k = data.get("k", 100)
    batch_size = data.get("batchSize", current_app.config.get("INFERENCE_BATCH_SIZE", 1024))

    if not point_cloud_id or seed_point_index is None:
        return jsonify({"error": "Point cloud ID and seed point index are required"}), 400

    point_cloud = PointCloud.query.get(point_cloud_id)
    if not point_cloud:
        return jsonify({"error": "Point cloud not found"}), 404

    if str(point_cloud.project.user_id) != user_id:
        return jsonify({"error": "Unauthorized"}), 403

    try:
        ply_data = load_ply(point_cloud.file_path)
        points = ply_data["points"]
        colors = ply_data["colors"]

        if seed_point_index < 0 or seed_point_index >= len(points):
            return jsonify({"error": "Invalid seed point index"}), 400

        seed_point = points[seed_point_index]
        distances = np.sqrt(np.sum((points - seed_point) ** 2, axis=1))
        nearest_indices = np.argsort(distances)[:k]

        result = InferenceService.predict(
            points=points,
            point_indices=nearest_indices,
            features=colors,
            batch_size=batch_size,
        )

        predicted_label = np.bincount(result["predictions"]).argmax()

        from app.services.point_cloud_service import PointCloudService
        label_changes = PointCloudService.update_labels(
            point_cloud_id,
            [{"pointIndices": nearest_indices.tolist(), "labelId": int(predicted_label)}],
        )

        from app.models import AnnotationHistory
        history = AnnotationHistory(
            point_cloud_id=point_cloud_id,
            action="auto_segment",
            label_changes=label_changes,
        )
        db.session.add(history)
        db.session.commit()

        predictions = []
        for i, idx in enumerate(nearest_indices):
            predictions.append({
                "pointIndex": int(idx),
                "predictedLabel": int(result["predictions"][i]),
                "confidence": float(result["confidences"][i]),
            })

        return jsonify({
            "predictions": predictions,
            "predictedLabel": int(predicted_label),
            "processingTime": result["processing_time"],
            "totalPoints": len(nearest_indices),
            "historyId": str(history.id),
        })

    except Exception as e:
        return jsonify({"error": f"Auto-segment failed: {str(e)}"}), 500


@inference_bp.route("/model-info", methods=["GET"])
@jwt_required()
def get_model_info():
    try:
        info = InferenceService.get_model_info()
        return jsonify(info)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
