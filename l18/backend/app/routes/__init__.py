from app.routes.auth import auth_bp
from app.routes.projects import projects_bp
from app.routes.point_clouds import point_clouds_bp
from app.routes.inference import inference_bp
from app.routes.collaboration import collaboration_bp

__all__ = ["auth_bp", "projects_bp", "point_clouds_bp", "inference_bp", "collaboration_bp"]
