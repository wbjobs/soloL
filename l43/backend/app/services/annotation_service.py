from typing import Dict, List, Any, Optional
from datetime import datetime
import json
import os
from app.utils.helpers import generate_id, format_time
from app.utils.logger import setup_logger

logger = setup_logger()

ANNOTATIONS_FILE = "data/annotations_store.json"


class AnnotationRepository:
    def __init__(self):
        self._annotations: Dict[str, List[Dict]] = {}
        self._load()

    def _load(self):
        os.makedirs(os.path.dirname(ANNOTATIONS_FILE), exist_ok=True)
        if os.path.exists(ANNOTATIONS_FILE):
            with open(ANNOTATIONS_FILE, "r", encoding="utf-8") as f:
                self._annotations = json.load(f)
        else:
            self._annotations = {}

    def _save(self):
        os.makedirs(os.path.dirname(ANNOTATIONS_FILE), exist_ok=True)
        with open(ANNOTATIONS_FILE, "w", encoding="utf-8") as f:
            json.dump(self._annotations, f, ensure_ascii=False, indent=2, default=str)

    def get_annotations(self, case_id: str) -> List[Dict]:
        return self._annotations.get(case_id, [])

    def add_annotation(self, case_id: str, annotation: Dict) -> Dict:
        if case_id not in self._annotations:
            self._annotations[case_id] = []

        ann_id = generate_id("ann_")
        full_annotation = {
            "id": ann_id,
            "case_id": case_id,
            "content": annotation.get("content", ""),
            "author": annotation.get("author", "匿名用户"),
            "author_id": annotation.get("author_id", "unknown"),
            "position": annotation.get("position", {}),
            "type": annotation.get("type", "comment"),
            "resolved": False,
            "replies": [],
            "created_at": format_time(datetime.now()),
            "updated_at": format_time(datetime.now())
        }

        self._annotations[case_id].append(full_annotation)
        self._save()
        return full_annotation

    def update_annotation(self, case_id: str, annotation_id: str, updates: Dict) -> Optional[Dict]:
        if case_id not in self._annotations:
            return None

        for ann in self._annotations[case_id]:
            if ann["id"] == annotation_id:
                ann.update(updates)
                ann["updated_at"] = format_time(datetime.now())
                self._save()
                return ann
        return None

    def delete_annotation(self, case_id: str, annotation_id: str) -> bool:
        if case_id not in self._annotations:
            return False

        self._annotations[case_id] = [
            ann for ann in self._annotations[case_id]
            if ann["id"] != annotation_id
        ]
        self._save()
        return True

    def add_reply(self, case_id: str, annotation_id: str, reply: Dict) -> Optional[Dict]:
        if case_id not in self._annotations:
            return None

        for ann in self._annotations[case_id]:
            if ann["id"] == annotation_id:
                reply_data = {
                    "id": generate_id("reply_"),
                    "content": reply.get("content", ""),
                    "author": reply.get("author", "匿名用户"),
                    "author_id": reply.get("author_id", "unknown"),
                    "created_at": format_time(datetime.now())
                }
                ann["replies"].append(reply_data)
                ann["updated_at"] = format_time(datetime.now())
                self._save()
                return reply_data
        return None

    def resolve_annotation(self, case_id: str, annotation_id: str, resolved: bool = True) -> Optional[Dict]:
        return self.update_annotation(case_id, annotation_id, {"resolved": resolved})

    def get_stats(self, case_id: str) -> Dict:
        annotations = self._annotations.get(case_id, [])
        total = len(annotations)
        resolved = len([a for a in annotations if a.get("resolved", False)])
        users = set(a.get("author_id") for a in annotations)
        return {
            "case_id": case_id,
            "total": total,
            "resolved": resolved,
            "unresolved": total - resolved,
            "user_count": len(users)
        }


annotation_repository = AnnotationRepository()


class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, Dict[str, Any]] = {}

    async def connect(self, websocket: Any, case_id: str, user_id: str, user_name: str):
        await websocket.accept()
        if case_id not in self.active_connections:
            self.active_connections[case_id] = {}
        self.active_connections[case_id][user_id] = {
            "websocket": websocket,
            "user_name": user_name,
            "connected_at": datetime.now()
        }
        await self.broadcast_to_case(case_id, {
            "type": "user_joined",
            "user_id": user_id,
            "user_name": user_name,
            "online_count": len(self.active_connections[case_id]),
            "timestamp": datetime.now().isoformat()
        })

    async def disconnect(self, case_id: str, user_id: str):
        if case_id in self.active_connections and user_id in self.active_connections[case_id]:
            user_name = self.active_connections[case_id][user_id]["user_name"]
            del self.active_connections[case_id][user_id]
            if len(self.active_connections[case_id]) == 0:
                del self.active_connections[case_id]
            await self.broadcast_to_case(case_id, {
                "type": "user_left",
                "user_id": user_id,
                "user_name": user_name,
                "online_count": len(self.active_connections.get(case_id, {})),
                "timestamp": datetime.now().isoformat()
            })

    async def broadcast_to_case(self, case_id: str, message: Dict):
        if case_id not in self.active_connections:
            return

        for user_id, conn in list(self.active_connections[case_id].items()):
            try:
                await conn["websocket"].send_json(message)
            except Exception as e:
                logger.warning(f"发送消息失败 {user_id}: {e}")

    async def send_personal_message(self, case_id: str, user_id: str, message: Dict):
        if case_id in self.active_connections and user_id in self.active_connections[case_id]:
            try:
                await self.active_connections[case_id][user_id]["websocket"].send_json(message)
            except Exception as e:
                logger.warning(f"发送私信失败 {user_id}: {e}")

    def get_online_users(self, case_id: str) -> List[Dict]:
        if case_id not in self.active_connections:
            return []
        return [
            {
                "user_id": uid,
                "user_name": conn["user_name"],
                "connected_at": conn["connected_at"].isoformat()
            }
            for uid, conn in self.active_connections[case_id].items()
        ]


connection_manager = ConnectionManager()
