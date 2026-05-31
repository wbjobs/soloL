from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple, Any
from datetime import datetime
import json
import hashlib


@dataclass
class LabelOperation:
    id: str
    point_index: int
    label_id: int
    user_id: str
    role: str
    role_priority: int
    timestamp: datetime
    lamport_clock: int
    is_deleted: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "point_index": self.point_index,
            "label_id": self.label_id,
            "user_id": self.user_id,
            "role": self.role,
            "role_priority": self.role_priority,
            "timestamp": self.timestamp.isoformat(),
            "lamport_clock": self.lamport_clock,
            "is_deleted": self.is_deleted,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "LabelOperation":
        return cls(
            id=data["id"],
            point_index=data["point_index"],
            label_id=data["label_id"],
            user_id=data["user_id"],
            role=data["role"],
            role_priority=data.get("role_priority", 0),
            timestamp=datetime.fromisoformat(data["timestamp"]),
            lamport_clock=data.get("lamport_clock", 0),
            is_deleted=data.get("is_deleted", False),
        )

    def compare(self, other: "LabelOperation") -> int:
        if self.role_priority != other.role_priority:
            return 1 if self.role_priority > other.role_priority else -1
        if self.lamport_clock != other.lamport_clock:
            return 1 if self.lamport_clock > other.lamport_clock else -1
        if self.timestamp != other.timestamp:
            return 1 if self.timestamp > other.timestamp else -1
        return 0 if self.id == other.id else (1 if self.id > other.id else -1)


class LabelCRDT:
    def __init__(self):
        self._operations: Dict[str, LabelOperation] = {}
        self._point_operations: Dict[int, Dict[str, LabelOperation]] = {}
        self._lamport_clock: int = 0

    @property
    def lamport_clock(self) -> int:
        return self._lamport_clock

    def increment_clock(self, remote_clock: Optional[int] = None) -> int:
        if remote_clock is not None:
            self._lamport_clock = max(self._lamport_clock, remote_clock)
        self._lamport_clock += 1
        return self._lamport_clock

    def add_operation(self, operation: LabelOperation) -> None:
        if operation.id in self._operations:
            return

        self._operations[operation.id] = operation
        self._lamport_clock = max(self._lamport_clock, operation.lamport_clock)

        point_idx = operation.point_index
        if point_idx not in self._point_operations:
            self._point_operations[point_idx] = {}
        self._point_operations[point_idx][operation.id] = operation

    def batch_add_operations(self, operations: List[LabelOperation]) -> None:
        for op in operations:
            self.add_operation(op)

    def get_point_label(self, point_index: int) -> Optional[Tuple[int, str, int]]:
        if point_index not in self._point_operations:
            return None

        ops = self._point_operations[point_index]
        active_ops = [op for op in ops.values() if not op.is_deleted]

        if not active_ops:
            return None

        winner = max(active_ops, key=lambda op: (op.role_priority, op.lamport_clock, op.timestamp.timestamp(), op.id))
        return (winner.label_id, winner.user_id, winner.role_priority)

    def get_all_labels(self) -> Dict[int, Tuple[int, str, int]]:
        result: Dict[int, Tuple[int, str, int]] = {}
        for point_idx in self._point_operations:
            label_info = self.get_point_label(point_idx)
            if label_info is not None:
                result[point_idx] = label_info
        return result

    def get_point_operations(self, point_index: int) -> List[LabelOperation]:
        if point_index not in self._point_operations:
            return []
        return sorted(
            self._point_operations[point_index].values(),
            key=lambda op: (op.role_priority, op.lamport_clock, op.timestamp.timestamp()),
            reverse=True
        )

    def get_user_annotations(self, user_id: str) -> List[LabelOperation]:
        return [op for op in self._operations.values() if op.user_id == user_id and not op.is_deleted]

    def get_all_operations(self) -> List[LabelOperation]:
        return sorted(
            self._operations.values(),
            key=lambda op: (op.lamport_clock, op.timestamp.timestamp())
        )

    def get_operations_since(self, clock: int) -> List[LabelOperation]:
        return [
            op for op in self._operations.values()
            if op.lamport_clock > clock
        ]

    def get_point_annotations(self, point_index: int) -> Dict[str, int]:
        if point_index not in self._point_operations:
            return {}
        
        result: Dict[str, int] = {}
        for op in self._point_operations[point_index].values():
            if not op.is_deleted:
                result[op.user_id] = op.label_id
        return result

    def get_all_annotations_by_point(self) -> Dict[int, Dict[str, int]]:
        result: Dict[int, Dict[str, int]] = {}
        for point_idx in self._point_operations:
            annotations = self.get_point_annotations(point_idx)
            if annotations:
                result[point_idx] = annotations
        return result

    def merge(self, other: "LabelCRDT") -> List[LabelOperation]:
        new_ops: List[LabelOperation] = []
        for op_id, op in other._operations.items():
            if op_id not in self._operations:
                self.add_operation(op)
                new_ops.append(op)
        return new_ops

    def to_dict(self) -> Dict[str, Any]:
        return {
            "lamport_clock": self._lamport_clock,
            "operations": [op.to_dict() for op in self._operations.values()],
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "LabelCRDT":
        crdt = cls()
        crdt._lamport_clock = data.get("lamport_clock", 0)
        for op_data in data.get("operations", []):
            crdt.add_operation(LabelOperation.from_dict(op_data))
        return crdt

    def get_state_hash(self) -> str:
        state_data = json.dumps(self.to_dict(), sort_keys=True)
        return hashlib.sha256(state_data.encode()).hexdigest()

    def get_statistics(self) -> Dict[str, Any]:
        all_labels = self.get_all_labels()
        annotated_points = len(all_labels)
        
        user_counts: Dict[str, int] = {}
        for op in self._operations.values():
            if not op.is_deleted:
                user_counts[op.user_id] = user_counts.get(op.user_id, 0) + 1

        return {
            "total_operations": len(self._operations),
            "annotated_points": annotated_points,
            "active_operations": sum(1 for op in self._operations.values() if not op.is_deleted),
            "user_contributions": user_counts,
            "lamport_clock": self._lamport_clock,
        }


def create_operation(
    point_index: int,
    label_id: int,
    user_id: str,
    role: str,
    role_priority: int,
    lamport_clock: int,
    operation_id: Optional[str] = None,
) -> LabelOperation:
    import uuid
    return LabelOperation(
        id=operation_id or str(uuid.uuid4()),
        point_index=point_index,
        label_id=label_id,
        user_id=user_id,
        role=role,
        role_priority=role_priority,
        timestamp=datetime.utcnow(),
        lamport_clock=lamport_clock,
        is_deleted=False,
    )


def create_delete_operation(
    point_index: int,
    user_id: str,
    role: str,
    role_priority: int,
    lamport_clock: int,
) -> LabelOperation:
    import uuid
    return LabelOperation(
        id=str(uuid.uuid4()),
        point_index=point_index,
        label_id=0,
        user_id=user_id,
        role=role,
        role_priority=role_priority,
        timestamp=datetime.utcnow(),
        lamport_clock=lamport_clock,
        is_deleted=True,
    )
