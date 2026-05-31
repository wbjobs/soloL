from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
import uuid

from app.extensions import db
from app.models import Project, PointCloud

projects_bp = Blueprint("projects", __name__)


@projects_bp.route("", methods=["GET"])
@jwt_required()
def get_projects():
    user_id = get_jwt_identity()
    projects = Project.query.filter_by(user_id=user_id).all()
    return jsonify([p.to_dict() for p in projects])


@projects_bp.route("", methods=["POST"])
@jwt_required()
def create_project():
    user_id = get_jwt_identity()
    data = request.get_json()
    name = data.get("name")
    description = data.get("description")

    if not name:
        return jsonify({"error": "Project name is required"}), 400

    project = Project(
        name=name,
        user_id=user_id,
        description=description,
    )
    db.session.add(project)
    db.session.commit()

    return jsonify(project.to_dict()), 201


@projects_bp.route("/<project_id>", methods=["GET"])
@jwt_required()
def get_project(project_id: str):
    user_id = get_jwt_identity()
    project = Project.query.get(project_id)

    if not project:
        return jsonify({"error": "Project not found"}), 404

    if str(project.user_id) != user_id:
        return jsonify({"error": "Unauthorized"}), 403

    return jsonify(project.to_dict(include_point_clouds=True))


@projects_bp.route("/<project_id>", methods=["PUT"])
@jwt_required()
def update_project(project_id: str):
    user_id = get_jwt_identity()
    project = Project.query.get(project_id)

    if not project:
        return jsonify({"error": "Project not found"}), 404

    if str(project.user_id) != user_id:
        return jsonify({"error": "Unauthorized"}), 403

    data = request.get_json()
    if "name" in data:
        project.name = data["name"]
    if "description" in data:
        project.description = data["description"]

    db.session.commit()
    return jsonify(project.to_dict())


@projects_bp.route("/<project_id>", methods=["DELETE"])
@jwt_required()
def delete_project(project_id: str):
    user_id = get_jwt_identity()
    project = Project.query.get(project_id)

    if not project:
        return jsonify({"error": "Project not found"}), 404

    if str(project.user_id) != user_id:
        return jsonify({"error": "Unauthorized"}), 403

    db.session.delete(project)
    db.session.commit()

    return jsonify({"message": "Project deleted successfully"})


@projects_bp.route("/<project_id>/point-clouds", methods=["GET"])
@jwt_required()
def get_project_point_clouds(project_id: str):
    user_id = get_jwt_identity()
    project = Project.query.get(project_id)

    if not project:
        return jsonify({"error": "Project not found"}), 404

    if str(project.user_id) != user_id:
        return jsonify({"error": "Unauthorized"}), 403

    return jsonify([pc.to_dict() for pc in project.point_clouds])
