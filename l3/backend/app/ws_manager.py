import asyncio
import websockets
import json
from typing import Dict, Set
from .config import settings
from .redis_client import get_progress, RedisManager


class WebSocketManager:
    def __init__(self):
        self.connections: Dict[str, Set[websockets.WebSocketServerProtocol]] = {}

    async def connect(self, task_id: str, websocket: websockets.WebSocketServerProtocol):
        if task_id not in self.connections:
            self.connections[task_id] = set()
        self.connections[task_id].add(websocket)

        progress_data = await get_progress(task_id)
        if progress_data:
            await websocket.send(json.dumps({
                "type": "progress",
                "task_id": task_id,
                "data": progress_data
            }))

    def disconnect(self, task_id: str, websocket: websockets.WebSocketServerProtocol):
        if task_id in self.connections:
            self.connections[task_id].discard(websocket)
            if not self.connections[task_id]:
                del self.connections[task_id]

    async def broadcast(self, task_id: str, message: dict):
        if task_id in self.connections:
            disconnected = set()
            for websocket in self.connections[task_id]:
                try:
                    await websocket.send(json.dumps(message))
                except Exception:
                    disconnected.add(websocket)

            for ws in disconnected:
                self.disconnect(task_id, ws)


manager = WebSocketManager()


async def handle_connection(websocket: websockets.WebSocketServerProtocol, path: str):
    try:
        path_parts = path.strip("/").split("/")
        if len(path_parts) < 2 or path_parts[0] != "ws":
            await websocket.close(code=1008, reason="无效的路径")
            return

        task_id = path_parts[1]

        await manager.connect(task_id, websocket)

        try:
            async for message in websocket:
                try:
                    data = json.loads(message)
                    if data.get("type") == "ping":
                        await websocket.send(json.dumps({"type": "pong"}))
                except json.JSONDecodeError:
                    pass
        finally:
            manager.disconnect(task_id, websocket)

    except websockets.exceptions.ConnectionClosed:
        pass


async def start_ws_server():
    await RedisManager.close_async()
    async with websockets.serve(handle_connection, settings.WS_MANAGER_HOST, settings.WS_MANAGER_PORT):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(start_ws_server())
