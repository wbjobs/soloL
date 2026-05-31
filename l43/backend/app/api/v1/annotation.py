from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException, Query, Depends
from typing import Optional
from app.services.annotation_service import annotation_repository, connection_manager
from app.utils.logger import setup_logger

logger = setup_logger()
router = APIRouter(prefix="/annotation", tags=["协同批注"])


@router.get("/{case_id}", summary="获取案件批注列表")
async def get_annotations(case_id: str):
    annotations = annotation_repository.get_annotations(case_id)
    return {
        "case_id": case_id,
        "total": len(annotations),
        "annotations": annotations
    }


@router.post("/{case_id}", summary="添加批注")
async def add_annotation(
    case_id: str,
    annotation: dict
):
    result = annotation_repository.add_annotation(case_id, annotation)

    await connection_manager.broadcast_to_case(case_id, {
        "type": "annotation_added",
        "annotation": result,
        "timestamp": result["created_at"]
    })

    return result


@router.put("/{case_id}/{annotation_id}", summary="更新批注")
async def update_annotation(
    case_id: str,
    annotation_id: str,
    updates: dict
):
    result = annotation_repository.update_annotation(case_id, annotation_id, updates)
    if not result:
        raise HTTPException(status_code=404, detail="批注不存在")

    await connection_manager.broadcast_to_case(case_id, {
        "type": "annotation_updated",
        "annotation": result,
        "timestamp": result["updated_at"]
    })

    return result


@router.delete("/{case_id}/{annotation_id}", summary="删除批注")
async def delete_annotation(case_id: str, annotation_id: str):
    success = annotation_repository.delete_annotation(case_id, annotation_id)
    if not success:
        raise HTTPException(status_code=404, detail="批注不存在")

    await connection_manager.broadcast_to_case(case_id, {
        "type": "annotation_deleted",
        "annotation_id": annotation_id,
        "timestamp": annotation_repository._get_current_time() if hasattr(annotation_repository, '_get_current_time') else None
    })

    return {"success": True, "message": "批注已删除"}


@router.post("/{case_id}/{annotation_id}/reply", summary="添加批注回复")
async def add_reply(
    case_id: str,
    annotation_id: str,
    reply: dict
):
    result = annotation_repository.add_reply(case_id, annotation_id, reply)
    if not result:
        raise HTTPException(status_code=404, detail="批注不存在")

    await connection_manager.broadcast_to_case(case_id, {
        "type": "reply_added",
        "annotation_id": annotation_id,
        "reply": result,
        "timestamp": result["created_at"]
    })

    return result


@router.patch("/{case_id}/{annotation_id}/resolve", summary="标记批注已解决")
async def resolve_annotation(
    case_id: str,
    annotation_id: str,
    resolved: bool = True
):
    result = annotation_repository.resolve_annotation(case_id, annotation_id, resolved)
    if not result:
        raise HTTPException(status_code=404, detail="批注不存在")

    await connection_manager.broadcast_to_case(case_id, {
        "type": "annotation_resolved",
        "annotation_id": annotation_id,
        "resolved": resolved,
        "annotation": result
    })

    return result


@router.get("/{case_id}/stats", summary="获取批注统计")
async def get_annotation_stats(case_id: str):
    return annotation_repository.get_stats(case_id)


@router.get("/{case_id}/online", summary="获取在线用户")
async def get_online_users(case_id: str):
    users = connection_manager.get_online_users(case_id)
    return {
        "case_id": case_id,
        "online_count": len(users),
        "users": users
    }


@router.websocket("/ws/{case_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    case_id: str,
    user_id: str = Query(..., description="用户ID"),
    user_name: str = Query("匿名用户", description="用户名")
):
    await connection_manager.connect(websocket, case_id, user_id, user_name)
    try:
        while True:
            data = await websocket.receive_json()
            message_type = data.get("type", "")

            if message_type == "ping":
                await connection_manager.send_personal_message(case_id, user_id, {
                    "type": "pong",
                    "timestamp": datetime.now().isoformat()
                })

            elif message_type == "new_annotation":
                annotation = annotation_repository.add_annotation(case_id, data.get("annotation", {}))
                await connection_manager.broadcast_to_case(case_id, {
                    "type": "annotation_added",
                    "annotation": annotation,
                    "author_id": user_id,
                    "author_name": user_name
                })

            elif message_type == "cursor_position":
                await connection_manager.broadcast_to_case(case_id, {
                    "type": "cursor_update",
                    "user_id": user_id,
                    "user_name": user_name,
                    "position": data.get("position", {})
                })

            elif message_type == "selection":
                await connection_manager.broadcast_to_case(case_id, {
                    "type": "selection_update",
                    "user_id": user_id,
                    "user_name": user_name,
                    "selection": data.get("selection", {})
                })

    except WebSocketDisconnect:
        await connection_manager.disconnect(case_id, user_id)
    except Exception as e:
        logger.error(f"WebSocket错误: {e}")
        await connection_manager.disconnect(case_id, user_id)


from datetime import datetime
