from fastapi import FastAPI, File, UploadFile, HTTPException, WebSocket, WebSocketDisconnect, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from pymongo import MongoClient
from pymongo.database import Database
from typing import List, Optional
import os
import aiofiles
import uuid
from datetime import datetime
from dotenv import load_dotenv

from midi_parser import parse_midi_file, midi_to_dict, MidiData
from spectrum import generate_spectrogram, spectrum_to_dict
from websocket_manager import manager
from redis_manager import redis_manager
from midi_preprocessor import preprocess_midi_to_slices, get_visible_slices, sliced_midi_to_dict
from models import (
    AnnotationCreate, AnnotationUpdate, AnnotationResponse,
    MidiFileInfo, MidiDetailResponse, ExportAnnotationsResponse,
    MidiSlicesResponse, VisibleNotesResponse, AnnotationSyncRequest
)

load_dotenv()

app = FastAPI(title="MIDI Visualizer API", version="1.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://localhost:27017")
MONGODB_DB_NAME = os.getenv("MONGODB_DB_NAME", "midi_visualizer")
UPLOAD_DIR = os.getenv("UPLOAD_DIR", "./uploads")
PORT = int(os.getenv("PORT", "8000"))

os.makedirs(UPLOAD_DIR, exist_ok=True)

client = None
db = None
midi_collection = None
annotations_collection = None


@app.on_event("startup")
async def startup_db_client():
    global client, db, midi_collection, annotations_collection
    
    await redis_manager.connect()
    
    client = MongoClient(MONGODB_URL, serverSelectionTimeoutMS=5000)
    db = client[MONGODB_DB_NAME]
    midi_collection = db["midi_files"]
    annotations_collection = db["annotations"]
    
    try:
        client.admin.command('ping')
        midi_collection.create_index("midi_id", unique=True)
        annotations_collection.create_index("id", unique=True)
        annotations_collection.create_index("midi_id")
        annotations_collection.create_index("version")
        print("MongoDB connected successfully")
    except Exception as e:
        print(f"Warning: MongoDB connection failed: {e}")
        print("API will work but database operations will fail")


@app.on_event("shutdown")
async def shutdown_db_client():
    if client:
        client.close()
    await redis_manager.disconnect()


def get_db():
    return db


async def get_next_annotation_version(midi_id: str) -> int:
    if redis_manager.is_connected:
        return await redis_manager.increment_annotation_version(midi_id)
    
    max_ver = annotations_collection.find_one(
        {"midi_id": midi_id},
        sort=[("version", -1)]
    )
    return (max_ver.get("version", 0) if max_ver else 0) + 1


@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "redis_connected": redis_manager.is_connected
    }


@app.post("/api/midi/upload", response_model=MidiFileInfo)
async def upload_midi(file: UploadFile = File(...)):
    if not file.filename.endswith(('.mid', '.midi')):
        raise HTTPException(status_code=400, detail="Only MIDI files are allowed")
    
    file_id = str(uuid.uuid4())
    file_path = os.path.join(UPLOAD_DIR, f"{file_id}_{file.filename}")
    
    async with aiofiles.open(file_path, 'wb') as out_file:
        content = await file.read()
        await out_file.write(content)
    
    try:
        midi_data = parse_midi_file(file_path, file.filename)
        midi_dict = midi_to_dict(midi_data)
        midi_dict["created_at"] = datetime.utcnow()
        midi_dict["file_path"] = file_path
        
        midi_collection.insert_one(midi_dict)
        
        await preprocess_midi_to_slices(midi_data)
        
        return MidiFileInfo(
            midi_id=midi_data.midi_id,
            filename=midi_data.filename,
            total_notes=midi_data.total_notes,
            total_duration=midi_data.total_duration,
            track_count=len(midi_data.tracks),
            created_at=midi_dict["created_at"]
        )
    except Exception as e:
        os.remove(file_path)
        raise HTTPException(status_code=500, detail=f"Error parsing MIDI: {str(e)}")


@app.get("/api/midi", response_model=List[MidiFileInfo])
async def list_midi_files():
    files = list(midi_collection.find({}, {
        "midi_id": 1, "filename": 1, "total_notes": 1,
        "total_duration": 1, "tracks": 1, "created_at": 1, "_id": 0
    }).sort("created_at", -1))
    
    return [MidiFileInfo(
        midi_id=f["midi_id"],
        filename=f["filename"],
        total_notes=f["total_notes"],
        total_duration=f["total_duration"],
        track_count=len(f.get("tracks", [])),
        created_at=f["created_at"]
    ) for f in files]


@app.get("/api/midi/{midi_id}", response_model=MidiDetailResponse)
async def get_midi_detail(midi_id: str):
    midi_file = midi_collection.find_one({"midi_id": midi_id}, {"_id": 0})
    if not midi_file:
        raise HTTPException(status_code=404, detail="MIDI file not found")
    
    return MidiDetailResponse(**midi_file)


@app.get("/api/midi/{midi_id}/slices", response_model=MidiSlicesResponse)
async def get_midi_slices_info(midi_id: str):
    midi_file = midi_collection.find_one({"midi_id": midi_id}, {"_id": 0})
    if not midi_file:
        raise HTTPException(status_code=404, detail="MIDI file not found")
    
    if redis_manager.is_connected:
        meta = await redis_manager.get_midi_slices_meta(midi_id)
        if meta:
            return MidiSlicesResponse(**meta)
    
    class TempMidiData:
        def __init__(self, m):
            self.midi_id = m["midi_id"]
            self.total_duration = m["total_duration"]
            self.notes = []
    
    temp = TempMidiData(midi_file)
    temp.notes = midi_file.get("notes", [])
    
    sliced = await preprocess_midi_to_slices(temp)
    meta = sliced_midi_to_dict(sliced)
    
    return MidiSlicesResponse(
        midi_id=meta["midi_id"],
        total_duration=meta["total_duration"],
        slice_duration=meta["slice_duration"],
        total_slices=meta["total_slices"],
        track_summary=meta["track_summary"]
    )


@app.get("/api/midi/{midi_id}/visible-notes", response_model=VisibleNotesResponse)
async def get_visible_notes(
    midi_id: str,
    start_time: float = Query(..., description="Viewport start time in seconds"),
    end_time: float = Query(..., description="Viewport end time in seconds"),
    preload_buffer: int = Query(2, description="Number of slices to preload ahead/behind")
):
    midi_file = midi_collection.find_one({"midi_id": midi_id}, {"_id": 0})
    if not midi_file:
        raise HTTPException(status_code=404, detail="MIDI file not found")
    
    if redis_manager.is_connected:
        result = await get_visible_slices(midi_id, start_time, end_time, preload_buffer=preload_buffer)
        if result and result.get("visible_notes"):
            result["midi_id"] = midi_id
            return VisibleNotesResponse(**result)
    
    notes = midi_file.get("notes", [])
    visible_notes = [
        n for n in notes
        if n["start_time"] < end_time and (n["start_time"] + n["duration"]) > start_time
    ]
    
    return VisibleNotesResponse(
        midi_id=midi_id,
        visible_notes=visible_notes,
        slice_indices=[],
        total_slices=1,
        slice_duration=end_time - start_time,
        viewport_start=start_time,
        viewport_end=end_time
    )


@app.get("/api/midi/{midi_id}/spectrum")
async def get_midi_spectrum(midi_id: str):
    midi_file = midi_collection.find_one({"midi_id": midi_id}, {"notes": 1, "total_duration": 1, "_id": 0})
    if not midi_file:
        raise HTTPException(status_code=404, detail="MIDI file not found")
    
    spec_data = generate_spectrogram(midi_file["notes"], midi_file["total_duration"])
    return spectrum_to_dict(spec_data)


@app.delete("/api/midi/{midi_id}")
async def delete_midi(midi_id: str):
    midi_file = midi_collection.find_one({"midi_id": midi_id}, {"file_path": 1, "_id": 0})
    if not midi_file:
        raise HTTPException(status_code=404, detail="MIDI file not found")
    
    if os.path.exists(midi_file["file_path"]):
        os.remove(midi_file["file_path"])
    
    midi_collection.delete_one({"midi_id": midi_id})
    annotations_collection.delete_many({"midi_id": midi_id})
    
    await redis_manager.clear_midi_cache(midi_id)
    
    return {"status": "success", "message": "MIDI file deleted"}


@app.post("/api/annotations", response_model=AnnotationResponse)
async def create_annotation(annotation: AnnotationCreate, client_version: int = 0):
    midi_file = midi_collection.find_one({"midi_id": annotation.midi_id})
    if not midi_file:
        raise HTTPException(status_code=404, detail="MIDI file not found")
    
    new_version = await get_next_annotation_version(annotation.midi_id)
    
    annot_dict = annotation.model_dump()
    annot_dict["id"] = str(uuid.uuid4())
    annot_dict["created_at"] = datetime.utcnow()
    annot_dict["version"] = new_version
    annot_dict["updated_at"] = datetime.utcnow()
    annot_dict["deleted"] = False
    
    annotations_collection.insert_one(annot_dict)
    
    if redis_manager.is_connected:
        await redis_manager.add_annotation_update(
            annotation.midi_id,
            annot_dict["id"],
            {
                "operation": "create",
                "version": new_version,
                "data": annot_dict
            }
        )
    
    await manager.broadcast_annotation_delta(
        annotation.midi_id,
        annot_dict["id"],
        "create",
        annot_dict,
        new_version,
        annotation.created_by
    )
    
    return AnnotationResponse(**annot_dict)


@app.get("/api/annotations/{midi_id}", response_model=List[AnnotationResponse])
async def get_annotations(
    midi_id: str,
    since_version: int = Query(0, description="Get annotations since this version")
):
    query = {"midi_id": midi_id, "deleted": False}
    if since_version > 0:
        query["version"] = {"$gt": since_version}
    
    annotations = list(annotations_collection.find(query, {"_id": 0}).sort("created_at", -1))
    return [AnnotationResponse(**a) for a in annotations]


@app.put("/api/annotations/{annotation_id}", response_model=AnnotationResponse)
async def update_annotation(annotation_id: str, update: AnnotationUpdate):
    existing = annotations_collection.find_one({"id": annotation_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Annotation not found")
    
    new_version = await get_next_annotation_version(existing["midi_id"])
    
    update_data = update.model_dump(exclude_unset=True)
    if update_data:
        update_data["version"] = new_version
        update_data["updated_at"] = datetime.utcnow()
        annotations_collection.update_one(
            {"id": annotation_id},
            {"$set": update_data}
        )
        existing.update(update_data)
    
    if redis_manager.is_connected:
        await redis_manager.add_annotation_update(
            existing["midi_id"],
            annotation_id,
            {
                "operation": "update",
                "version": new_version,
                "data": existing
            }
        )
    
    await manager.broadcast_annotation_delta(
        existing["midi_id"],
        annotation_id,
        "update",
        existing,
        new_version,
        existing.get("created_by", "system")
    )
    
    return AnnotationResponse(**existing)


@app.delete("/api/annotations/{annotation_id}")
async def delete_annotation(annotation_id: str):
    existing = annotations_collection.find_one({"id": annotation_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Annotation not found")
    
    new_version = await get_next_annotation_version(existing["midi_id"])
    
    annotations_collection.update_one(
        {"id": annotation_id},
        {"$set": {"deleted": True, "version": new_version, "updated_at": datetime.utcnow()}}
    )
    
    if redis_manager.is_connected:
        await redis_manager.add_annotation_update(
            existing["midi_id"],
            annotation_id,
            {
                "operation": "delete",
                "version": new_version,
                "data": {"id": annotation_id}
            }
        )
    
    await manager.broadcast_annotation_delta(
        existing["midi_id"],
        annotation_id,
        "delete",
        {"id": annotation_id},
        new_version,
        existing.get("created_by", "system")
    )
    
    return {"status": "success", "message": "Annotation deleted", "version": new_version}


@app.post("/api/annotations/sync")
async def sync_annotations(request: AnnotationSyncRequest):
    server_version = await redis_manager.get_annotation_version(request.midi_id) if redis_manager.is_connected else 0
    
    deltas = []
    if redis_manager.is_connected:
        updates = await redis_manager.get_annotation_since(request.midi_id, request.client_version)
        deltas = list(updates.values()) if updates else []
    
    return {
        "midi_id": request.midi_id,
        "server_version": server_version,
        "deltas": deltas,
        "has_more": False
    }


@app.get("/api/export/{midi_id}", response_model=ExportAnnotationsResponse)
async def export_annotations(midi_id: str):
    midi_file = midi_collection.find_one({"midi_id": midi_id}, {"_id": 0})
    if not midi_file:
        raise HTTPException(status_code=404, detail="MIDI file not found")
    
    annotations = list(annotations_collection.find(
        {"midi_id": midi_id, "deleted": False}, {"_id": 0}
    ).sort("created_at", 1))
    
    return ExportAnnotationsResponse(
        midi_id=midi_id,
        filename=midi_file["filename"],
        exported_at=datetime.utcnow(),
        annotations=[AnnotationResponse(**a) for a in annotations],
        total_annotations=len(annotations)
    )


@app.get("/api/export/{midi_id}/download")
async def download_annotations(midi_id: str):
    midi_file = midi_collection.find_one({"midi_id": midi_id}, {"_id": 0})
    if not midi_file:
        raise HTTPException(status_code=404, detail="MIDI file not found")
    
    annotations = list(annotations_collection.find(
        {"midi_id": midi_id, "deleted": False}, {"_id": 0}
    ).sort("created_at", 1))
    
    export_data = {
        "midi_id": midi_id,
        "filename": midi_file["filename"],
        "exported_at": datetime.utcnow().isoformat(),
        "midi_info": {
            "total_notes": midi_file["total_notes"],
            "total_duration": midi_file["total_duration"],
            "tracks": midi_file["tracks"]
        },
        "annotations": annotations,
        "total_annotations": len(annotations)
    }
    
    file_path = os.path.join(UPLOAD_DIR, f"annotations_{midi_id}.json")
    import json
    with open(file_path, 'w', encoding='utf-8') as f:
        json.dump(export_data, f, ensure_ascii=False, indent=2)
    
    return FileResponse(
        file_path,
        media_type="application/json",
        filename=f"{os.path.splitext(midi_file['filename'])[0]}_annotations.json"
    )


@app.websocket("/ws/{midi_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    midi_id: str,
    user_id: str,
    username: str,
    client_version: int = 0
):
    midi_file = midi_collection.find_one({"midi_id": midi_id})
    if not midi_file:
        await websocket.close(code=4004, reason="MIDI file not found")
        return
    
    await manager.connect(websocket, midi_id, user_id, username, client_version)
    
    try:
        while True:
            data = await websocket.receive_json()
            message_type = data.get("type")
            received_version = data.get("client_version", 0)
            
            if message_type == "cursor_update":
                await manager.broadcast_to_room(midi_id, {
                    "type": "cursor_update",
                    "data": {
                        "user_id": user_id,
                        "username": username,
                        "position": data.get("data", {}).get("position"),
                        "time": data.get("data", {}).get("time")
                    },
                    "user_id": user_id,
                    "timestamp": datetime.utcnow().isoformat()
                })
            elif message_type == "sync_request":
                server_version = await redis_manager.get_annotation_version(midi_id) if redis_manager.is_connected else 0
                deltas = []
                if redis_manager.is_connected:
                    updates = await redis_manager.get_annotation_since(midi_id, received_version)
                    deltas = list(updates.values()) if updates else []
                
                await manager.send_sync_response(user_id, midi_id, server_version, deltas)
            elif message_type == "ping":
                await manager.send_personal_message(user_id, midi_id, {
                    "type": "pong",
                    "data": {"timestamp": datetime.utcnow().isoformat()},
                    "user_id": "system",
                    "timestamp": datetime.utcnow().isoformat()
                })
            
    except WebSocketDisconnect:
        manager.disconnect(midi_id, user_id)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
