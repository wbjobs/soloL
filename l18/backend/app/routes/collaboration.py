from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from typing import Any

from app.extensions import db
from app.models.user import User, get_role_priority
from app.services.collaboration_service import CollaborationService
from app.models.collaboration import ControversialPoint

collaboration_bp = Blueprint("collaboration", __name__)


@collaboration_bp.route("/<point_cloud_id>/labels", methods=["POST"])
@jwt_required()
def add_labels(point_cloud_id: str) -> Any:
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    data = request.get_json()
    if not data or "pointIndices" not in data or "labelId" not in data:
        return jsonify({"error": "Missing required fields: pointIndices, labelId"}), 400

    point_indices = data["pointIndices"]
    label_id = data["labelId"]

    service = CollaborationService.get_instance(point_cloud_id)
    applied_indices, operations = service.add_labels(
        point_indices=point_indices,
        label_id=label_id,
        user_id=current_user_id,
        user_role=user.role,
    )

    return jsonify({
        "success": True,
        "appliedIndices": applied_indices,
        "operations": [op.to_dict() for op in operations],
        "lamportClock": service.crdt.lamport_clock,
    }), 200


@collaboration_bp.route("/<point_cloud_id>/labels", methods=["DELETE"])
@jwt_required()
def delete_labels(point_cloud_id: str) -> Any:
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    data = request.get_json()
    if not data or "pointIndices" not in data:
        return jsonify({"error": "Missing required field: pointIndices"}), 400

    point_indices = data["pointIndices"]

    service = CollaborationService.get_instance(point_cloud_id)
    operations = service.delete_labels(
        point_indices=point_indices,
        user_id=current_user_id,
        user_role=user.role,
    )

    return jsonify({
        "success": True,
        "operations": [op.to_dict() for op in operations],
        "lamportClock": service.crdt.lamport_clock,
    }), 200


@collaboration_bp.route("/<point_cloud_id>/labels/resolved", methods=["GET"])
@jwt_required()
def get_resolved_labels(point_cloud_id: str) -> Any:
    service = CollaborationService.get_instance(point_cloud_id)
    labels = service.get_all_resolved_labels()
    
    result = {}
    for point_idx, (label_id, user_id, priority) in labels.items():
        result[str(point_idx)] = {
            "labelId": label_id,
            "userId": user_id,
            "rolePriority": priority,
        }
    
    return jsonify({
        "labels": result,
        "totalPoints": len(result),
        "lamportClock": service.crdt.lamport_clock,
    }), 200


@collaboration_bp.route("/<point_cloud_id>/annotations", methods=["GET"])
@jwt_required()
def get_annotations(point_cloud_id: str) -> Any:
    service = CollaborationService.get_instance(point_cloud_id)
    annotations = service.get_all_annotations()
    
    result = {}
    for point_idx, user_labels in annotations.items():
        result[str(point_idx)] = user_labels
    
    return jsonify({
        "annotations": result,
        "annotatedPoints": len(result),
        "lamportClock": service.crdt.lamport_clock,
    }), 200


@collaboration_bp.route("/<point_cloud_id>/annotations/<point_index>", methods=["GET"])
@jwt_required()
def get_point_annotations(point_cloud_id: str, point_index: str) -> Any:
    service = CollaborationService.get_instance(point_cloud_id)
    annotations = service.get_point_annotations(int(point_index))
    
    return jsonify({
        "pointIndex": int(point_index),
        "annotations": annotations,
    }), 200


@collaboration_bp.route("/<point_cloud_id>/sync", methods=["POST"])
@jwt_required()
def sync_operations(point_cloud_id: str) -> Any:
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    data = request.get_json()
    if not data or "operations" not in data:
        return jsonify({"error": "Missing required field: operations"}), 400

    service = CollaborationService.get_instance(point_cloud_id)
    merged = service.merge_remote_operations(data["operations"])

    return jsonify({
        "success": True,
        "mergedOperations": len(merged),
        "lamportClock": service.crdt.lamport_clock,
    }), 200


@collaboration_bp.route("/<point_cloud_id>/sync/<int:since_clock>", methods=["GET"])
@jwt_required()
def get_operations_since(point_cloud_id: str, since_clock: int) -> Any:
    service = CollaborationService.get_instance(point_cloud_id)
    operations = service.get_operations_since(since_clock)
    
    return jsonify({
        "operations": operations,
        "currentClock": service.crdt.lamport_clock,
    }), 200


@collaboration_bp.route("/<point_cloud_id>/quality", methods=["POST"])
@jwt_required()
def assess_quality(point_cloud_id: str) -> Any:
    data = request.get_json() or {}
    alpha_threshold = data.get("alphaThreshold", 0.6)
    entropy_threshold = data.get("entropyThreshold", 0.8)

    service = CollaborationService.get_instance(point_cloud_id)
    quality = service.assess_quality(
        alpha_threshold=alpha_threshold,
        entropy_threshold=entropy_threshold
    )

    return jsonify(quality), 200


@collaboration_bp.route("/<point_cloud_id>/quality", methods=["GET"])
@jwt_required()
def get_quality(point_cloud_id: str) -> Any:
    from app.models.collaboration import QualityAssessment
    
    assessments = QualityAssessment.query.filter_by(
        point_cloud_id=point_cloud_id
    ).order_by(QualityAssessment.assessment_date.desc()).limit(10).all()
    
    return jsonify([a.to_dict() for a in assessments]), 200


@collaboration_bp.route("/<point_cloud_id>/controversial-points", methods=["GET"])
@jwt_required()
def get_controversial_points(point_cloud_id: str) -> Any:
    include_resolved = request.args.get("includeResolved", "false").lower() == "true"
    limit = int(request.args.get("limit", "1000"))

    service = CollaborationService.get_instance(point_cloud_id)
    points = service.get_controversial_points(
        include_resolved=include_resolved,
        limit=limit
    )
    
    return jsonify({
        "controversialPoints": points,
        "totalCount": len(points),
    }), 200


@collaboration_bp.route("/<point_cloud_id>/controversial-points/<int:point_index>/resolve", methods=["POST"])
@jwt_required()
def resolve_controversial_point(point_cloud_id: str, point_index: int) -> Any:
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    data = request.get_json()
    if not data or "finalLabel" not in data:
        return jsonify({"error": "Missing required field: finalLabel"}), 400

    service = CollaborationService.get_instance(point_cloud_id)
    result = service.resolve_controversial_point(
        point_index=point_index,
        final_label=data["finalLabel"],
        user_id=current_user_id,
        user_role=user.role,
    )

    if result and "error" in result:
        return jsonify(result), 403
    
    if result is None:
        return jsonify({"error": "Controversial point not found"}), 404

    return jsonify(result), 200


@collaboration_bp.route("/<point_cloud_id>/statistics", methods=["GET"])
@jwt_required()
def get_statistics(point_cloud_id: str) -> Any:
    service = CollaborationService.get_instance(point_cloud_id)
    stats = service.get_statistics()
    
    return jsonify(stats), 200


@collaboration_bp.route("/<point_cloud_id>/sessions", methods=["POST"])
@jwt_required()
def create_session(point_cloud_id: str) -> Any:
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    data = request.get_json() or {}
    session_name = data.get("sessionName")

    service = CollaborationService.get_instance(point_cloud_id)
    session = service.create_session(
        host_user_id=current_user_id,
        session_name=session_name
    )

    return jsonify(session.to_dict()), 201


@collaboration_bp.route("/<point_cloud_id>/sessions", methods=["GET"])
@jwt_required()
def get_sessions(point_cloud_id: str) -> Any:
    service = CollaborationService.get_instance(point_cloud_id)
    sessions = service.get_active_sessions()
    
    return jsonify(sessions), 200


@collaboration_bp.route("/<point_cloud_id>/sessions/<session_id>/offer", methods=["POST"])
@jwt_required()
def send_offer(point_cloud_id: str, session_id: str) -> Any:
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    data = request.get_json()
    if not data or "offer" not in data:
        return jsonify({"error": "Missing required field: offer"}), 400

    service = CollaborationService.get_instance(point_cloud_id)
    session = service.update_webrtc_offer(
        session_id=session_id,
        offer=data["offer"],
        user_id=current_user_id
    )

    if not session:
        return jsonify({"error": "Session not found"}), 404

    return jsonify(session.to_dict()), 200


@collaboration_bp.route("/<point_cloud_id>/sessions/<session_id>/answer", methods=["POST"])
@jwt_required()
def send_answer(point_cloud_id: str, session_id: str) -> Any:
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    data = request.get_json()
    if not data or "answer" not in data:
        return jsonify({"error": "Missing required field: answer"}), 400

    service = CollaborationService.get_instance(point_cloud_id)
    session = service.update_webrtc_answer(
        session_id=session_id,
        answer=data["answer"],
        user_id=current_user_id
    )

    if not session:
        return jsonify({"error": "Session not found"}), 404

    return jsonify(session.to_dict()), 200


@collaboration_bp.route("/<point_cloud_id>/sessions/<session_id>/ice", methods=["POST"])
@jwt_required()
def send_ice_candidate(point_cloud_id: str, session_id: str) -> Any:
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    data = request.get_json()
    if not data or "candidate" not in data:
        return jsonify({"error": "Missing required field: candidate"}), 400

    service = CollaborationService.get_instance(point_cloud_id)
    session = service.add_ice_candidate(
        session_id=session_id,
        candidate=data["candidate"],
        user_id=current_user_id
    )

    if not session:
        return jsonify({"error": "Session not found"}), 404

    return jsonify(session.to_dict()), 200


@collaboration_bp.route("/<point_cloud_id>/sessions/<session_id>", methods=["GET"])
@jwt_required()
def get_session(point_cloud_id: str, session_id: str) -> Any:
    service = CollaborationService.get_instance(point_cloud_id)
    session = service.get_session(session_id)
    
    if not session:
        return jsonify({"error": "Session not found"}), 404

    return jsonify(session.to_dict()), 200


@collaboration_bp.route("/<point_cloud_id>/sessions/<session_id>", methods=["DELETE"])
@jwt_required()
def end_session(point_cloud_id: str, session_id: str) -> Any:
    current_user_id = get_jwt_identity()

    service = CollaborationService.get_instance(point_cloud_id)
    session = service.end_session(session_id, current_user_id)
    
    if not session:
        return jsonify({"error": "Session not found or unauthorized"}), 404

    return jsonify(session.to_dict()), 200
