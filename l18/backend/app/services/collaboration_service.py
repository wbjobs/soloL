from typing import Dict, List, Optional, Tuple, Any
from datetime import datetime
import threading

from app.extensions import db
from app.models.user import User, get_role_priority
from app.models.collaboration import (
    Annotation,
    AnnotationHistory,
    QualityAssessment,
    ControversialPoint,
    CollaborativeSession,
)
from app.utils.crdt import LabelCRDT, LabelOperation, create_operation
from app.utils.quality_metrics import (
    calculate_overall_quality,
    find_controversial_points,
    resolve_label_conflict_with_users,
)


class CollaborationService:
    _instances: Dict[str, "CollaborationService"] = {}
    _lock: threading.Lock = threading.Lock()

    def __init__(self, point_cloud_id: str):
        self.point_cloud_id = point_cloud_id
        self.crdt: LabelCRDT = LabelCRDT()
        self._load_from_database()

    @classmethod
    def get_instance(cls, point_cloud_id: str) -> "CollaborationService":
        with cls._lock:
            if point_cloud_id not in cls._instances:
                cls._instances[point_cloud_id] = cls(point_cloud_id)
            return cls._instances[point_cloud_id]

    @classmethod
    def remove_instance(cls, point_cloud_id: str) -> None:
        with cls._lock:
            if point_cloud_id in cls._instances:
                del cls._instances[point_cloud_id]

    def _load_from_database(self) -> None:
        annotations = Annotation.query.filter_by(
            point_cloud_id=self.point_cloud_id,
            is_deleted=False
        ).all()

        for ann in annotations:
            op = LabelOperation(
                id=ann.id,
                point_index=ann.point_index,
                label_id=ann.label_id,
                user_id=ann.user_id,
                role=ann.role,
                role_priority=ann.role_priority,
                timestamp=ann.timestamp or datetime.utcnow(),
                lamport_clock=0,
                is_deleted=ann.is_deleted,
            )
            self.crdt.add_operation(op)

    def add_labels(
        self,
        point_indices: List[int],
        label_id: int,
        user_id: str,
        user_role: str,
    ) -> Tuple[List[int], List[LabelOperation]]:
        role_priority = get_role_priority(user_role)
        new_clock = self.crdt.increment_clock()

        operations: List[LabelOperation] = []
        applied_indices: List[int] = []

        for point_idx in point_indices:
            op = create_operation(
                point_index=point_idx,
                label_id=label_id,
                user_id=user_id,
                role=user_role,
                role_priority=role_priority,
                lamport_clock=new_clock,
            )
            operations.append(op)
            applied_indices.append(point_idx)

            self.crdt.add_operation(op)

            existing_ann = Annotation.query.filter_by(
                point_cloud_id=self.point_cloud_id,
                user_id=user_id,
                point_index=point_idx
            ).first()

            if existing_ann:
                existing_ann.label_id = label_id
                existing_ann.role = user_role
                existing_ann.role_priority = role_priority
                existing_ann.timestamp = datetime.utcnow()
                existing_ann.is_deleted = False
            else:
                ann = Annotation(
                    id=op.id,
                    point_cloud_id=self.point_cloud_id,
                    user_id=user_id,
                    point_index=point_idx,
                    label_id=label_id,
                    role=user_role,
                    role_priority=role_priority,
                )
                db.session.add(ann)

            history = AnnotationHistory(
                point_cloud_id=self.point_cloud_id,
                user_id=user_id,
                operation="add_label",
                data={
                    "point_index": point_idx,
                    "label_id": label_id,
                    "operation_id": op.id,
                },
                lamport_clock=new_clock,
            )
            db.session.add(history)

        db.session.commit()

        return applied_indices, operations

    def delete_labels(
        self,
        point_indices: List[int],
        user_id: str,
        user_role: str,
    ) -> List[LabelOperation]:
        role_priority = get_role_priority(user_role)
        new_clock = self.crdt.increment_clock()

        operations: List[LabelOperation] = []

        for point_idx in point_indices:
            op = LabelOperation(
                id=f"del_{point_idx}_{int(datetime.utcnow().timestamp())}",
                point_index=point_idx,
                label_id=0,
                user_id=user_id,
                role=user_role,
                role_priority=role_priority,
                timestamp=datetime.utcnow(),
                lamport_clock=new_clock,
                is_deleted=True,
            )
            operations.append(op)
            self.crdt.add_operation(op)

            ann = Annotation.query.filter_by(
                point_cloud_id=self.point_cloud_id,
                user_id=user_id,
                point_index=point_idx
            ).first()

            if ann:
                ann.is_deleted = True
                ann.timestamp = datetime.utcnow()

            history = AnnotationHistory(
                point_cloud_id=self.point_cloud_id,
                user_id=user_id,
                operation="delete_label",
                data={
                    "point_index": point_idx,
                    "operation_id": op.id,
                },
                lamport_clock=new_clock,
            )
            db.session.add(history)

        db.session.commit()

        return operations

    def get_resolved_label(self, point_index: int) -> Optional[Tuple[int, str, int]]:
        return self.crdt.get_point_label(point_index)

    def get_all_resolved_labels(self) -> Dict[int, Tuple[int, str, int]]:
        return self.crdt.get_all_labels()

    def get_point_annotations(self, point_index: int) -> Dict[str, int]:
        return self.crdt.get_point_annotations(point_index)

    def get_all_annotations(self) -> Dict[int, Dict[str, int]]:
        return self.crdt.get_all_annotations_by_point()

    def get_user_annotations(self, user_id: str) -> List[Dict[str, Any]]:
        ops = self.crdt.get_user_annotations(user_id)
        return [op.to_dict() for op in ops]

    def get_operations_since(self, clock: int) -> List[Dict[str, Any]]:
        ops = self.crdt.get_operations_since(clock)
        return [op.to_dict() for op in ops]

    def merge_remote_operations(
        self,
        operations: List[Dict[str, Any]],
    ) -> List[LabelOperation]:
        new_ops = [LabelOperation.from_dict(op) for op in operations]
        merged = self.crdt.merge(LabelCRDT.from_dict({"operations": [op.to_dict() for op in new_ops]}))
        
        for op in merged:
            existing_ann = Annotation.query.filter_by(id=op.id).first()
            if not existing_ann:
                ann = Annotation(
                    id=op.id,
                    point_cloud_id=self.point_cloud_id,
                    user_id=op.user_id,
                    point_index=op.point_index,
                    label_id=op.label_id,
                    role=op.role,
                    role_priority=op.role_priority,
                    timestamp=op.timestamp,
                    is_deleted=op.is_deleted,
                )
                db.session.add(ann)
        
        db.session.commit()
        return merged

    def assess_quality(
        self,
        alpha_threshold: float = 0.6,
        entropy_threshold: float = 0.8,
    ) -> Dict[str, Any]:
        annotations = self.get_all_annotations()
        
        quality = calculate_overall_quality(
            annotations,
            alpha_threshold=alpha_threshold,
            entropy_threshold=entropy_threshold
        )

        ControversialPoint.query.filter_by(point_cloud_id=self.point_cloud_id).delete()

        for cp in quality["controversial_points"]:
            existing = ControversialPoint.query.filter_by(
                point_cloud_id=self.point_cloud_id,
                point_index=cp["point_index"]
            ).first()

            if existing:
                existing.entropy = cp["entropy"]
                existing.label_distribution = cp["label_distribution"]
                existing.annotator_count = cp["annotator_count"]
                existing.last_assessed = datetime.utcnow()
                existing.is_resolved = False
            else:
                cont_point = ControversialPoint(
                    point_cloud_id=self.point_cloud_id,
                    point_index=cp["point_index"],
                    entropy=cp["entropy"],
                    label_distribution=cp["label_distribution"],
                    annotator_count=cp["annotator_count"],
                )
                db.session.add(cont_point)

        assessment = QualityAssessment(
            point_cloud_id=self.point_cloud_id,
            krippendorff_alpha=quality["krippendorff_alpha"],
            overall_entropy=quality["overall_entropy"],
            controversial_point_count=quality["controversial_point_count"],
            needs_review=quality["needs_review"],
            details={
                "annotated_point_count": quality["annotated_point_count"],
                "total_annotations": quality["total_annotations"],
                "quality_level": quality["quality_level"],
            },
        )
        db.session.add(assessment)
        db.session.commit()

        return quality

    def get_controversial_points(
        self,
        include_resolved: bool = False,
        limit: int = 1000,
    ) -> List[Dict[str, Any]]:
        query = ControversialPoint.query.filter_by(point_cloud_id=self.point_cloud_id)
        if not include_resolved:
            query = query.filter_by(is_resolved=False)
        
        points = query.order_by(ControversialPoint.entropy.desc()).limit(limit).all()
        return [p.to_dict() for p in points]

    def resolve_controversial_point(
        self,
        point_index: int,
        final_label: int,
        user_id: str,
        user_role: str,
    ) -> Optional[Dict[str, Any]]:
        cp = ControversialPoint.query.filter_by(
            point_cloud_id=self.point_cloud_id,
            point_index=point_index
        ).first()

        if not cp:
            return None

        role_priority = get_role_priority(user_role)
        if role_priority < 2:
            return {"error": "需要资深或管理员权限才能解决争议点"}

        self.add_labels([point_index], final_label, user_id, user_role)
        cp.is_resolved = True
        db.session.commit()

        return {
            "point_index": point_index,
            "final_label": final_label,
            "resolved_by": user_id,
            "is_resolved": True,
        }

    def get_statistics(self) -> Dict[str, Any]:
        crdt_stats = self.crdt.get_statistics()
        
        user_stats = {}
        for user_id, count in crdt_stats["user_contributions"].items():
            user = User.query.get(user_id)
            if user:
                user_stats[user_id] = {
                    "count": count,
                    "role": user.role,
                    "role_label": user.role_label,
                    "name": user.name or user.email,
                }

        return {
            **crdt_stats,
            "user_contributions": user_stats,
        }

    def create_session(
        self,
        host_user_id: str,
        session_name: Optional[str] = None,
    ) -> CollaborativeSession:
        session = CollaborativeSession(
            point_cloud_id=self.point_cloud_id,
            host_user_id=host_user_id,
            session_name=session_name or f"Session-{self.point_cloud_id[:8]}",
            participants=[{"userId": host_user_id, "joinedAt": datetime.utcnow().isoformat()}],
        )
        db.session.add(session)
        db.session.commit()
        return session

    def update_webrtc_offer(
        self,
        session_id: str,
        offer: Dict[str, Any],
        user_id: str,
    ) -> Optional[CollaborativeSession]:
        session = CollaborativeSession.query.get(session_id)
        if not session or session.point_cloud_id != self.point_cloud_id:
            return None

        session.webrtc_offer = {**offer, "userId": user_id, "timestamp": datetime.utcnow().isoformat()}
        db.session.commit()
        return session

    def update_webrtc_answer(
        self,
        session_id: str,
        answer: Dict[str, Any],
        user_id: str,
    ) -> Optional[CollaborativeSession]:
        session = CollaborativeSession.query.get(session_id)
        if not session or session.point_cloud_id != self.point_cloud_id:
            return None

        session.webrtc_answer = {**answer, "userId": user_id, "timestamp": datetime.utcnow().isoformat()}
        db.session.commit()
        return session

    def add_ice_candidate(
        self,
        session_id: str,
        candidate: Dict[str, Any],
        user_id: str,
    ) -> Optional[CollaborativeSession]:
        session = CollaborativeSession.query.get(session_id)
        if not session or session.point_cloud_id != self.point_cloud_id:
            return None

        if not session.ice_candidates:
            session.ice_candidates = []
        
        session.ice_candidates.append({
            **candidate,
            "userId": user_id,
            "timestamp": datetime.utcnow().isoformat(),
        })
        db.session.commit()
        return session

    def get_session(self, session_id: str) -> Optional[CollaborativeSession]:
        return CollaborativeSession.query.get(session_id)

    def get_active_sessions(self) -> List[Dict[str, Any]]:
        sessions = CollaborativeSession.query.filter_by(
            point_cloud_id=self.point_cloud_id,
            is_active=True
        ).all()
        return [s.to_dict() for s in sessions]

    def end_session(self, session_id: str, user_id: str) -> Optional[CollaborativeSession]:
        session = CollaborativeSession.query.get(session_id)
        if not session or session.point_cloud_id != self.point_cloud_id:
            return None
        if session.host_user_id != user_id:
            return None

        session.is_active = False
        session.ended_at = datetime.utcnow()
        db.session.commit()
        return session
