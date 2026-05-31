from fastapi import WebSocket, WebSocketDisconnect
from typing import Dict, List, Set, Optional
import json
from datetime import datetime
import uuid


class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, Dict[str, WebSocket]] = {}
        self.user_info: Dict[str, Dict[str, str]] = {}
        self.user_versions: Dict[str, Dict[str, int]] = {}

    async def connect(
        self,
        websocket: WebSocket,
        midi_id: str,
        user_id: str,
        username: str,
        client_version: int = 0
    ):
        await websocket.accept()
        if midi_id not in self.active_connections:
            self.active_connections[midi_id] = {}
            self.user_info[midi_id] = {}
            self.user_versions[midi_id] = {}
        self.active_connections[midi_id][user_id] = websocket
        self.user_info[midi_id][user_id] = username
        self.user_versions[midi_id][user_id] = client_version
        
        await self.broadcast_to_room(midi_id, {
            'type': 'user_joined',
            'data': {
                'user_id': user_id,
                'username': username,
                'timestamp': datetime.utcnow().isoformat()
            },
            'user_id': 'system',
            'timestamp': datetime.utcnow().isoformat()
        })
        
        await self.send_user_list(midi_id)

    def disconnect(self, midi_id: str, user_id: str):
        if midi_id in self.active_connections:
            if user_id in self.active_connections[midi_id]:
                del self.active_connections[midi_id][user_id]
            if user_id in self.user_info.get(midi_id, {}):
                username = self.user_info[midi_id].pop(user_id)
                if user_id in self.user_versions.get(midi_id, {}):
                    del self.user_versions[midi_id][user_id]
                
                import asyncio
                asyncio.create_task(self.broadcast_to_room(midi_id, {
                    'type': 'user_left',
                    'data': {
                        'user_id': user_id,
                        'username': username,
                        'timestamp': datetime.utcnow().isoformat()
                    },
                    'user_id': 'system',
                    'timestamp': datetime.utcnow().isoformat()
                }))
                
                asyncio.create_task(self.send_user_list(midi_id))
            
            if len(self.active_connections[midi_id]) == 0:
                del self.active_connections[midi_id]
                if midi_id in self.user_info:
                    del self.user_info[midi_id]
                if midi_id in self.user_versions:
                    del self.user_versions[midi_id]

    async def broadcast_to_room(
        self,
        midi_id: str,
        message: dict,
        exclude_user: Optional[str] = None
    ):
        if midi_id in self.active_connections:
            for user_id, connection in list(self.active_connections[midi_id].items()):
                if exclude_user and user_id == exclude_user:
                    continue
                try:
                    await connection.send_json(message)
                except:
                    pass

    async def broadcast_annotation_delta(
        self,
        midi_id: str,
        annotation_id: str,
        operation: str,
        data: dict,
        version: int,
        source_user_id: str
    ):
        message = {
            'type': 'annotation_delta',
            'data': {
                'id': annotation_id,
                'operation': operation,
                'version': version,
                'data': data,
                'timestamp': datetime.utcnow().isoformat()
            },
            'user_id': source_user_id,
            'timestamp': datetime.utcnow().isoformat(),
            'version': version
        }
        
        if midi_id in self.active_connections:
            for user_id, connection in list(self.active_connections[midi_id].items()):
                try:
                    if user_id != source_user_id:
                        self.user_versions[midi_id][user_id] = version
                    await connection.send_json(message)
                except:
                    pass

    async def send_sync_response(
        self,
        user_id: str,
        midi_id: str,
        server_version: int,
        deltas: List[dict]
    ):
        message = {
            'type': 'annotation_sync',
            'data': {
                'server_version': server_version,
                'deltas': deltas,
                'has_more': False
            },
            'user_id': 'system',
            'timestamp': datetime.utcnow().isoformat(),
            'version': server_version
        }
        await self.send_personal_message(user_id, midi_id, message)

    async def send_user_list(self, midi_id: str):
        if midi_id in self.user_info:
            users = [
                {'user_id': uid, 'username': uname}
                for uid, uname in self.user_info[midi_id].items()
            ]
            await self.broadcast_to_room(midi_id, {
                'type': 'user_list',
                'data': {'users': users},
                'user_id': 'system',
                'timestamp': datetime.utcnow().isoformat()
            })

    async def send_personal_message(self, user_id: str, midi_id: str, message: dict):
        if midi_id in self.active_connections and user_id in self.active_connections[midi_id]:
            await self.active_connections[midi_id][user_id].send_json(message)

    def get_room_users(self, midi_id: str) -> List[Dict[str, str]]:
        if midi_id in self.user_info:
            return [
                {'user_id': uid, 'username': uname}
                for uid, uname in self.user_info[midi_id].items()
            ]
        return []

    def update_user_version(self, midi_id: str, user_id: str, version: int):
        if midi_id in self.user_versions:
            self.user_versions[midi_id][user_id] = version

    def get_user_version(self, midi_id: str, user_id: str) -> int:
        if midi_id in self.user_versions and user_id in self.user_versions[midi_id]:
            return self.user_versions[midi_id][user_id]
        return 0


manager = ConnectionManager()
