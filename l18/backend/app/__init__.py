from flask import Flask
from flask_cors import CORS

from app.config import Config
from app.extensions import db, jwt
from app.routes import auth_bp, projects_bp, point_clouds_bp, inference_bp, collaboration_bp


def create_app(config_class: type[Config] = Config) -> Flask:
    config = config_class()
    app = Flask(__name__)
    app.config.from_object(config)

    CORS(app, resources={r"/api/*": {"origins": "*"}}, supports_credentials=True)

    db.init_app(app)
    jwt.init_app(app)

    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(projects_bp, url_prefix="/api/projects")
    app.register_blueprint(point_clouds_bp, url_prefix="/api/point-clouds")
    app.register_blueprint(inference_bp, url_prefix="/api/inference")
    app.register_blueprint(collaboration_bp, url_prefix="/api/collaboration")

    with app.app_context():
        from app.models import User, Project, PointCloud, LabelDefinition, LabelChunk, AnnotationHistory
        from app.models.collaboration import Annotation, QualityAssessment, ControversialPoint, CollaborativeSession
        db.create_all()
        _init_label_definitions()
        _init_default_user()

    return app


def _init_label_definitions() -> None:
    from app.models import LabelDefinition

    default_labels = [
        (0, "未标注", "#808080", "默认未标注点"),
        (1, "车辆", "#FF0000", "轿车、卡车、公交车等"),
        (2, "行人", "#00FF00", "行人、骑行者"),
        (3, "建筑", "#0000FF", "建筑物、墙壁"),
        (4, "植被", "#00FF7F", "树木、草地"),
        (5, "道路", "#FFFF00", "路面、车道线"),
        (6, "人行道", "#FFA500", "人行道、骑行道"),
        (7, "围栏", "#FF00FF", "护栏、围栏"),
        (8, "杆状物", "#00FFFF", "电线杆、路灯"),
        (9, "交通标志", "#FFC0CB", "标志牌、信号灯"),
    ]

    for label_id, name, color, description in default_labels:
        if not LabelDefinition.query.get(label_id):
            label = LabelDefinition(
                id=label_id,
                name=name,
                color=color,
                description=description
            )
            db.session.add(label)
    db.session.commit()


def _init_default_user() -> None:
    from app.models import User

    default_users = [
        ("admin@example.com", "admin123", "admin", "系统管理员"),
        ("senior@example.com", "senior123", "senior", "资深远"),
        ("annotator@example.com", "annotator123", "annotator", "标注员"),
        ("junior@example.com", "junior123", "junior", "新手"),
    ]

    for email, password, role, name in default_users:
        if not User.query.filter_by(email=email).first():
            user = User(
                email=email,
                password=password,
                role=role,
                name=name
            )
            db.session.add(user)
    
    db.session.commit()
