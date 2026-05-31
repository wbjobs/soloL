from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from ..ws_manager import manager
from ..redis_client import get_progress
import json

router = APIRouter()


@router.websocket("/{task_id}")
async def websocket_endpoint(websocket: WebSocket, task_id: str):
    await websocket.accept()
    await manager.connect(task_id, websocket)

    try:
        progress_data = await get_progress(task_id)
        if progress_data:
            await websocket.send_json({
                "type": "progress",
                "task_id": task_id,
                "data": progress_data
            })

        while True:
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
                if message.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
            except json.JSONDecodeError:
                pass

    except WebSocketDisconnect:
        manager.disconnect(task_id, websocket)
    except Exception:
        manager.disconnect(task_id, websocket)
